import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMCallOptions, LLMStreamOptions, LLMStreamCallbacks, LLMConfig, TokenUsage } from './types.js';
import { trackUsage } from './usage.js';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private defaultModel: string;

  constructor(config: LLMConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.defaultModel = config.model;
  }

  async call(options: LLMCallOptions): Promise<string> {
    const response = await this.client.messages.create({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      system: [{ type: 'text', text: options.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: options.prompt }],
    });

    const model = options.model || this.defaultModel;
    if (response.usage) {
      const u = response.usage as unknown as Record<string, number>;
      trackUsage(model, {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens,
        cacheWriteTokens: u.cache_creation_input_tokens,
      });
    }

    const block = response.content[0];
    return block.type === 'text' ? block.text : '';
  }

  async listModels(): Promise<string[]> {
    const models: string[] = [];
    const page = await this.client.models.list({ limit: 100 });
    for (const model of page.data) {
      models.push(model.id);
    }
    return models;
  }

  async stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void> {
    const messages = options.messages
      ? [
          ...options.messages.map((msg) => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
          })),
          { role: 'user' as const, content: options.prompt },
        ]
      : [{ role: 'user' as const, content: options.prompt }];

    const stream = this.client.messages.stream({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 10240,
      system: [{ type: 'text' as const, text: options.system, cache_control: { type: 'ephemeral' as const } }],
      messages,
    });

    let stopReason: string | undefined;
    let usage: TokenUsage | undefined;
    const model = options.model || this.defaultModel;

    stream.on('message', (message) => {
      const msg = message as unknown as Record<string, unknown>;
      stopReason = msg.stop_reason as string | undefined;
      const u = msg.usage as Record<string, number> | undefined;
      if (u) {
        usage = {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens,
          cacheWriteTokens: u.cache_creation_input_tokens,
        };
        trackUsage(model, usage);
      }
    });
    stream.on('text', (text) => callbacks.onText(text));
    stream.on('end', () => callbacks.onEnd({ stopReason, usage }));
    stream.on('error', (error) => callbacks.onError(error));
  }
}

import OpenAI from 'openai';
import type { LLMProvider, LLMCallOptions, LLMStreamOptions, LLMStreamCallbacks, LLMConfig, TokenUsage } from './types.js';
import { trackUsage } from './usage.js';

export class OpenAICompatProvider implements LLMProvider {
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl && { baseURL: config.baseUrl }),
    });
    this.defaultModel = config.model;
  }

  async call(options: LLMCallOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 4096,
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.prompt },
      ],
    });

    const model = options.model || this.defaultModel;
    if (response.usage) {
      trackUsage(model, {
        inputTokens: response.usage.prompt_tokens ?? 0,
        outputTokens: response.usage.completion_tokens ?? 0,
      });
    }

    return response.choices[0]?.message?.content || '';
  }

  async listModels(): Promise<string[]> {
    const models: string[] = [];
    for await (const model of this.client.models.list()) {
      models.push(model.id);
    }
    return models;
  }

  async stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: options.system },
    ];

    if (options.messages) {
      for (const msg of options.messages) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    messages.push({ role: 'user', content: options.prompt });

    const stream = await this.client.chat.completions.create({
      model: options.model || this.defaultModel,
      max_tokens: options.maxTokens || 10240,
      messages,
      stream: true,
    });

    try {
      let stopReason: string | undefined;
      let usage: TokenUsage | undefined;
      const model = options.model || this.defaultModel;
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta != null) callbacks.onText(delta);
        const finishReason = chunk.choices[0]?.finish_reason;
        if (finishReason) stopReason = finishReason === 'length' ? 'max_tokens' : finishReason;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunkUsage = (chunk as any).usage;
        if (chunkUsage) {
          usage = {
            inputTokens: chunkUsage.prompt_tokens ?? 0,
            outputTokens: chunkUsage.completion_tokens ?? 0,
          };
          trackUsage(model, usage);
        }
      }
      callbacks.onEnd({ stopReason, usage });
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

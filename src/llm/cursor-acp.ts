import { spawn, execSync, type ChildProcess } from 'node:child_process';
import type { LLMProvider, LLMCallOptions, LLMStreamOptions, LLMStreamCallbacks, LLMConfig } from './types.js';

const AGENT_BIN = 'agent';
const IS_WINDOWS = process.platform === 'win32';

/**
 * Cursor provider using headless --print mode for direct LLM access.
 * Each call spawns `agent --print` which outputs clean text responses
 * without the agent behavior that ACP mode forces.
 * See https://cursor.com/docs/cli/headless
 */
export class CursorAcpProvider implements LLMProvider {
  private defaultModel: string;
  private cursorApiKey?: string;

  constructor(config: LLMConfig) {
    this.defaultModel = config.model || 'sonnet-4.6';
    this.cursorApiKey = process.env.CURSOR_API_KEY ?? process.env.CURSOR_AUTH_TOKEN;
  }

  async call(options: LLMCallOptions): Promise<string> {
    const prompt = this.buildPrompt(options);
    const model = options.model || this.defaultModel;
    return this.runPrint(model, prompt);
  }

  async stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void> {
    const prompt = this.buildPrompt(options);
    const model = options.model || this.defaultModel;
    return this.runPrintStream(model, prompt, callbacks);
  }

  private buildArgs(model: string, streaming: boolean): string[] {
    const args = ['--print', '--trust'];

    if (model && model !== 'auto' && model !== 'default') {
      args.push('--model', model);
    }

    if (streaming) {
      args.push('--output-format', 'stream-json', '--stream-partial-output');
    }

    if (this.cursorApiKey) {
      args.push('--api-key', this.cursorApiKey);
    }

    return args;
  }

  private runPrint(model: string, prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(model, false);
      const child = spawn(AGENT_BIN, args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...(this.cursorApiKey && { CURSOR_API_KEY: this.cursorApiKey }) },
        ...(IS_WINDOWS && { shell: true }),
      });

      const chunks: Buffer[] = [];

      child.stdout!.on('data', (data: Buffer) => {
        chunks.push(data);
      });

      child.on('error', reject);

      child.on('close', (code) => {
        const output = Buffer.concat(chunks).toString('utf-8').trim();
        if (code !== 0 && !output) {
          reject(new Error(`Cursor agent exited with code ${code}`));
        } else {
          resolve(output);
        }
      });

      child.stdin!.write(prompt);
      child.stdin!.end();
    });
  }

  private runPrintStream(model: string, prompt: string, callbacks: LLMStreamCallbacks): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = this.buildArgs(model, true);
      const child = spawn(AGENT_BIN, args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, ...(this.cursorApiKey && { CURSOR_API_KEY: this.cursorApiKey }) },
        ...(IS_WINDOWS && { shell: true }),
      });

      let buffer = '';

      child.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString('utf-8');

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as {
              type?: string;
              content?: string;
              message?: { content?: Array<{ text?: string }> };
              duration_ms?: number;
            };

            if (event.type === 'assistant') {
              const text = event.message?.content?.[0]?.text || event.content;
              if (text) callbacks.onText(text);
            } else if (event.type === 'result') {
              callbacks.onEnd({ stopReason: 'end_turn' });
            }
          } catch {
            // Not JSON — treat as plain text
            callbacks.onText(line);
          }
        }
      });

      child.on('error', (err) => {
        callbacks.onError(err);
        reject(err);
      });

      child.on('close', (code) => {
        // Flush remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer) as { type?: string; content?: string; message?: { content?: Array<{ text?: string }> }; duration_ms?: number };
            if (event.type === 'assistant') {
              const text = event.message?.content?.[0]?.text || event.content;
              if (text) callbacks.onText(text);
            } else if (event.type === 'result') {
              callbacks.onEnd({ stopReason: 'end_turn' });
            }
          } catch {
            callbacks.onText(buffer);
          }
        }

        if (code !== 0 && code !== null) {
          const err = new Error(`Cursor agent exited with code ${code}`);
          callbacks.onError(err);
          reject(err);
        } else {
          resolve();
        }
      });

      child.stdin!.write(prompt);
      child.stdin!.end();
    });
  }

  private buildPrompt(options: LLMCallOptions | LLMStreamOptions): string {
    const streamOpts = options as LLMStreamOptions;
    const hasHistory = streamOpts.messages && streamOpts.messages.length > 0;
    let combined = '';

    combined += '[[System]]\n' + options.system + '\n\n';

    if (hasHistory) {
      for (const msg of streamOpts.messages!) {
        combined += `[[${msg.role === 'user' ? 'User' : 'Assistant'}]]\n${msg.content}\n\n`;
      }
    }

    combined += '[[User]]\n' + options.prompt;
    return combined;
  }
}

/** Check if Cursor agent CLI is available (e.g. user ran `cursor.com/install` and optionally `agent login`). */
export function isCursorAgentAvailable(): boolean {
  try {
    const cmd = process.platform === 'win32' ? `where ${AGENT_BIN}` : `which ${AGENT_BIN}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

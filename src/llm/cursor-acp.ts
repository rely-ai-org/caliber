import { spawn, execSync } from 'node:child_process';
import readline from 'node:readline';
import type { LLMProvider, LLMCallOptions, LLMStreamOptions, LLMStreamCallbacks, LLMConfig } from './types.js';

const ACP_AGENT_BIN = 'agent';
const IS_WINDOWS = process.platform === 'win32';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * Cursor provider that uses the Cursor Agent via ACP (Agent Client Protocol).
 * Uses the user's current Cursor subscription — no API key required if `agent login` was run.
 * See https://cursor.com/docs/cli/acp
 */
export class CursorAcpProvider implements LLMProvider {
  private defaultModel: string;
  private cursorApiKey?: string;

  constructor(config: LLMConfig) {
    this.defaultModel = config.model || 'default';
    this.cursorApiKey = process.env.CURSOR_API_KEY ?? process.env.CURSOR_AUTH_TOKEN;
  }

  async call(options: LLMCallOptions): Promise<string> {
    const chunks: string[] = [];
    await this.runAcpPrompt(options, {
      onText: (text) => chunks.push(text),
      onEnd: () => {},
      onError: () => {},
    });
    return chunks.join('');
  }

  async stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void> {
    await this.runAcpPrompt(options, callbacks);
  }

  private async runAcpPrompt(
    options: LLMCallOptions | LLMStreamOptions,
    callbacks: LLMStreamCallbacks
  ): Promise<void> {
    const combinedPrompt = this.buildCombinedPrompt(options);

    const model = options.model || this.defaultModel;
    const args = ['acp'];
    if (model && model !== 'auto' && model !== 'default') {
      args.unshift('--model', model);
    }
    if (this.cursorApiKey) {
      args.unshift('--api-key', this.cursorApiKey);
    }
    const agent = spawn(ACP_AGENT_BIN, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: process.cwd(),
      env: { ...process.env, ...(this.cursorApiKey && { CURSOR_API_KEY: this.cursorApiKey }) },
      ...(IS_WINDOWS && { shell: true }),
    });

    const pending = new Map<number, PendingCall>();
    let nextId = 1;
    let sessionId: string | null = null;

    const send = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
        agent.stdin!.write(JSON.stringify(msg) + '\n', (err) => {
          if (err) {
            pending.delete(id);
            reject(err);
          }
        });
      });
    };

    const rl = readline.createInterface({ input: agent.stdout!, crlfDelay: Infinity });
    rl.on('line', (line) => {
      let msg: JsonRpcResponse & { method?: string; params?: { update?: { sessionUpdate?: string; content?: { text?: string } }; id?: number } };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        return;
      }

      if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
        const waiter = pending.get(msg.id);
        if (waiter) {
          pending.delete(msg.id);
          if (msg.error) {
            waiter.reject(new Error(msg.error.message || 'ACP error'));
          } else {
            waiter.resolve(msg.result);
          }
        }
        if (msg.result && typeof msg.result === 'object' && 'sessionId' in (msg.result as object)) {
          sessionId = (msg.result as { sessionId: string }).sessionId;
        }
        if (msg.result && typeof msg.result === 'object' && 'stopReason' in (msg.result as object)) {
          callbacks.onEnd({
            stopReason: (msg.result as { stopReason?: string }).stopReason,
          });
        }
        return;
      }

      if (msg.method === 'session/update' && msg.params?.update) {
        const update = msg.params.update;
        if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
          callbacks.onText(update.content.text);
        }
        return;
      }

      if (msg.method === 'session/request_permission' && msg.id != null) {
        const response = JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { outcome: { outcome: 'selected' as const, optionId: 'allow-once' as const } },
        }) + '\n';
        agent.stdin!.write(response);
      }
    });

    agent.on('error', (err) => {
      for (const w of pending.values()) w.reject(err);
      callbacks.onError(err);
    });
    agent.on('close', (code) => {
      if (code !== 0 && code !== null) {
        const err = new Error(`Cursor agent exited with code ${code}`);
        for (const w of pending.values()) w.reject(err);
        callbacks.onError(err);
      }
    });

    try {
      await send('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'caliber', version: '1.0.0' },
      });
      await send('authenticate', { methodId: 'cursor_login' });
      const sessionResult = await send('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      }) as { sessionId: string };
      sessionId = sessionResult.sessionId;

      await send('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: combinedPrompt }],
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      callbacks.onError(error);
      throw error;
    } finally {
      agent.stdin?.end();
      agent.kill('SIGTERM');
    }
  }

  private buildCombinedPrompt(options: LLMCallOptions | LLMStreamOptions): string {
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
    const cmd = process.platform === 'win32' ? `where ${ACP_AGENT_BIN}` : `which ${ACP_AGENT_BIN}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

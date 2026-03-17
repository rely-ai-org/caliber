import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { CursorAcpProvider, isCursorAgentAvailable } from '../cursor-acp.js';
import type { LLMConfig } from '../types.js';

const spawn = vi.fn();
const execSync = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawn(...args),
  execSync: (...args: unknown[]) => execSync(...args),
}));

function mockAcpAgent(chunks?: string[]) {
  const stdout = new Readable({ read: () => {} });
  const stdin = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      const str = chunk.toString();
      for (const line of str.split('\n').filter(Boolean)) {
        try {
          const msg = JSON.parse(line) as { id?: number; method?: string };
          if (msg.id == null) continue;
          if (msg.method === 'initialize') stdout.push(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
          else if (msg.method === 'authenticate') stdout.push(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }) + '\n');
          else if (msg.method === 'session/new') stdout.push(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 's' } }) + '\n');
          else if (msg.method === 'session/prompt') {
            for (const text of (chunks ?? [])) {
              stdout.push(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { text } } } }) + '\n');
            }
            stdout.push(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } }) + '\n');
            stdout.push(null);
          }
        } catch {
          // ignore
        }
      }
      cb();
    },
  });
  spawn.mockReturnValue({ stdin, stdout, stderr: process.stderr, on: vi.fn(), kill: vi.fn() });
}

describe('CursorAcpProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_AUTH_TOKEN;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('call() returns concatenated agent_message_chunk text when mock agent responds', async () => {
    mockAcpAgent(['Hello!', ' World.']);

    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'default' });
    const result = await provider.call({ system: 'You are a helper.', prompt: 'Say hello.' });

    expect(result).toBe('Hello! World.');
    expect(spawn).toHaveBeenCalledWith('agent', ['acp'], expect.any(Object));
  });

  it('includes --api-key in spawn args when CURSOR_API_KEY is set', async () => {
    process.env.CURSOR_API_KEY = 'test-key';
    mockAcpAgent();

    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'default' });
    await provider.call({ system: 'S', prompt: 'P' });

    expect(spawn).toHaveBeenCalledWith('agent', ['--api-key', 'test-key', 'acp'], expect.any(Object));
  });

  it('includes --model before acp when a specific model is set', async () => {
    mockAcpAgent();

    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'opus-4.6' });
    await provider.call({ system: 'S', prompt: 'P' });

    expect(spawn).toHaveBeenCalledWith('agent', ['--model', 'opus-4.6', 'acp'], expect.any(Object));
  });

  it('does not include --model when model is "auto"', async () => {
    mockAcpAgent();

    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'auto' });
    await provider.call({ system: 'S', prompt: 'P' });

    expect(spawn).toHaveBeenCalledWith('agent', ['acp'], expect.any(Object));
  });

  it('per-call model overrides default model', async () => {
    mockAcpAgent();

    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'auto' });
    await provider.call({ system: 'S', prompt: 'P', model: 'sonnet-4.6' });

    expect(spawn).toHaveBeenCalledWith('agent', ['--model', 'sonnet-4.6', 'acp'], expect.any(Object));
  });

  it('uses CURSOR_API_KEY from env when set', () => {
    process.env.CURSOR_API_KEY = 'test-key';
    const config: LLMConfig = { provider: 'cursor', model: 'default' };
    const provider = new CursorAcpProvider(config);
    expect(provider).toBeDefined();
  });
});

describe('isCursorAgentAvailable', () => {
  beforeEach(() => {
    execSync.mockReset();
  });

  it('returns true when agent binary is on PATH', () => {
    execSync.mockReturnValue(undefined);
    expect(isCursorAgentAvailable()).toBe(true);
    const expectedCmd = process.platform === 'win32' ? 'where agent' : 'which agent';
    expect(execSync).toHaveBeenCalledWith(expectedCmd, { stdio: 'ignore' });
  });

  it('returns false when agent binary is not found', () => {
    execSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(isCursorAgentAvailable()).toBe(false);
  });
});

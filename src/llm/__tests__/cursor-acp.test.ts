import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { CursorAcpProvider, isCursorAgentAvailable } from '../cursor-acp.js';
import type { LLMConfig } from '../types.js';

const spawn = vi.fn();
const execSync = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawn(...args),
  execSync: (...args: unknown[]) => execSync(...args),
}));

function mockPrintAgent(output: string, exitCode = 0) {
  const child = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stdin = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  child.kill = vi.fn();

  spawn.mockReturnValue(child);

  // Emit output and close async
  setTimeout(() => {
    child.stdout.emit('data', Buffer.from(output));
    child.emit('close', exitCode);
  }, 0);

  return child;
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

  it('call() returns text output from --print mode', async () => {
    mockPrintAgent('{"languages":["TypeScript"]}');

    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'sonnet-4.6' });
    const result = await provider.call({ system: 'Return JSON.', prompt: 'Detect stack.' });

    expect(result).toBe('{"languages":["TypeScript"]}');
    expect(spawn).toHaveBeenCalledWith(
      'agent',
      ['--print', '--trust', '--model', 'sonnet-4.6'],
      expect.any(Object),
    );
  });

  it('includes --api-key when CURSOR_API_KEY is set', async () => {
    process.env.CURSOR_API_KEY = 'test-key';
    mockPrintAgent('ok');

    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'sonnet-4.6' });
    await provider.call({ system: 'S', prompt: 'P' });

    expect(spawn).toHaveBeenCalledWith(
      'agent',
      ['--print', '--trust', '--model', 'sonnet-4.6', '--api-key', 'test-key'],
      expect.any(Object),
    );
  });

  it('does not include --model when model is "auto"', async () => {
    mockPrintAgent('ok');

    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'auto' });
    await provider.call({ system: 'S', prompt: 'P' });

    expect(spawn).toHaveBeenCalledWith(
      'agent',
      ['--print', '--trust'],
      expect.any(Object),
    );
  });

  it('stream() emits text from stream-json events', async () => {
    const events = [
      JSON.stringify({ type: 'assistant', message: { content: [{ text: 'Hello' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ text: ' World' }] } }),
      JSON.stringify({ type: 'result', duration_ms: 100 }),
    ].join('\n') + '\n';

    mockPrintAgent(events);

    const chunks: string[] = [];
    let ended = false;
    const provider = new CursorAcpProvider({ provider: 'cursor', model: 'sonnet-4.6' });

    await provider.stream(
      { system: 'S', prompt: 'P' },
      {
        onText: (text) => chunks.push(text),
        onEnd: () => { ended = true; },
        onError: () => {},
      },
    );

    expect(chunks).toEqual(['Hello', ' World']);
    expect(ended).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'agent',
      ['--print', '--trust', '--model', 'sonnet-4.6', '--output-format', 'stream-json', '--stream-partial-output'],
      expect.any(Object),
    );
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

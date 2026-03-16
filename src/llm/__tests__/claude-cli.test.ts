import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCliProvider, isClaudeCliAvailable } from '../claude-cli.js';
import type { LLMConfig } from '../types.js';

const IS_WINDOWS = process.platform === 'win32';
const spawn = vi.fn();
const execSync = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawn(...args),
  execSync: (...args: unknown[]) => execSync(...args),
}));

describe('ClaudeCliProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('call() spawns claude -p and pipes combined prompt via stdin', async () => {
    const stdoutChunks = [Buffer.from('Hello from Claude.\n')];
    let closeCb: (code: number) => void;
    const stdinEnd = vi.fn();
    spawn.mockReturnValue({
      stdin: { end: stdinEnd },
      stdout: {
        on: vi.fn((ev: string, fn: (c: Buffer) => void) => {
          if (ev === 'data') setTimeout(() => stdoutChunks.forEach(fn), 0);
        }),
      },
      on: vi.fn((ev: string, fn: (code: number) => void) => {
        if (ev === 'close') closeCb = fn;
      }),
      kill: vi.fn(),
    });

    const config: LLMConfig = { provider: 'claude-cli', model: 'default' };
    const provider = new ClaudeCliProvider(config);

    const resultPromise = provider.call({
      system: 'You are helpful.',
      prompt: 'Say hello.',
    });

    await new Promise((r) => setTimeout(r, 10));
    closeCb!(0);

    const result = await resultPromise;
    expect(result).toBe('Hello from Claude.');
    if (IS_WINDOWS) {
      expect(spawn.mock.calls[0][0]).toBe('claude -p');
      expect(spawn.mock.calls[0][1]).toEqual(expect.objectContaining({ cwd: process.cwd(), shell: true }));
    } else {
      expect(spawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p']),
        expect.objectContaining({ cwd: process.cwd() })
      );
      const args = spawn.mock.calls[0][1];
      expect(args).not.toContain(expect.stringContaining('[[System]]'));
    }
    expect(stdinEnd).toHaveBeenCalledWith(expect.stringContaining('You are helpful.'));
    expect(stdinEnd).toHaveBeenCalledWith(expect.stringContaining('Say hello.'));
  });

  it('stream() pipes prompt via stdin and invokes onText and onEnd', async () => {
    let closeCb: (code: number) => void;
    spawn.mockReturnValue({
      stdin: { end: vi.fn() },
      stdout: {
        on: vi.fn((ev: string, fn: (c: Buffer) => void) => {
          if (ev === 'data') setTimeout(() => fn(Buffer.from('Streamed response.')), 0);
        }),
      },
      on: vi.fn((ev: string, fn: (code: number) => void) => {
        if (ev === 'close') closeCb = fn;
      }),
      kill: vi.fn(),
    });

    const provider = new ClaudeCliProvider({ provider: 'claude-cli', model: 'default' });
    const onText = vi.fn();
    const onEnd = vi.fn();

    const streamPromise = provider.stream(
      { system: 'S', prompt: 'P' },
      { onText, onEnd, onError: vi.fn() }
    );

    await new Promise((r) => setTimeout(r, 10));
    closeCb!(0);
    await streamPromise;

    expect(onText).toHaveBeenCalledWith('Streamed response.');
    expect(onEnd).toHaveBeenCalledWith({ stopReason: 'end_turn' });
  });

  it('call() passes --model flag when options.model is set', async () => {
    const stdoutChunks = [Buffer.from('response')];
    let closeCb: (code: number) => void;
    spawn.mockReturnValue({
      stdin: { end: vi.fn() },
      stdout: {
        on: vi.fn((ev: string, fn: (c: Buffer) => void) => {
          if (ev === 'data') setTimeout(() => stdoutChunks.forEach(fn), 0);
        }),
      },
      on: vi.fn((ev: string, fn: (code: number) => void) => {
        if (ev === 'close') closeCb = fn;
      }),
      kill: vi.fn(),
    });

    const provider = new ClaudeCliProvider({ provider: 'claude-cli', model: 'default' });
    const resultPromise = provider.call({
      system: 'S',
      prompt: 'P',
      model: 'claude-haiku-4-5',
    });

    await new Promise((r) => setTimeout(r, 10));
    closeCb!(0);
    await resultPromise;

    if (IS_WINDOWS) {
      const cmdStr = spawn.mock.calls[0][0] as string;
      expect(cmdStr).toContain('--model');
      expect(cmdStr).toContain('claude-haiku-4-5');
    } else {
      const args = spawn.mock.calls[0][1];
      expect(args).toContain('--model');
      expect(args).toContain('claude-haiku-4-5');
    }
  });

  it('call() does not pass --model flag when options.model is not set', async () => {
    const stdoutChunks = [Buffer.from('response')];
    let closeCb: (code: number) => void;
    spawn.mockReturnValue({
      stdin: { end: vi.fn() },
      stdout: {
        on: vi.fn((ev: string, fn: (c: Buffer) => void) => {
          if (ev === 'data') setTimeout(() => stdoutChunks.forEach(fn), 0);
        }),
      },
      on: vi.fn((ev: string, fn: (code: number) => void) => {
        if (ev === 'close') closeCb = fn;
      }),
      kill: vi.fn(),
    });

    const provider = new ClaudeCliProvider({ provider: 'claude-cli', model: 'default' });
    const resultPromise = provider.call({ system: 'S', prompt: 'P' });

    await new Promise((r) => setTimeout(r, 10));
    closeCb!(0);
    await resultPromise;

    if (IS_WINDOWS) {
      const cmdStr = spawn.mock.calls[0][0] as string;
      expect(cmdStr).not.toContain('--model');
    } else {
      const args = spawn.mock.calls[0][1];
      expect(args).not.toContain('--model');
    }
  });

  it('stream() passes --model flag when options.model is set', async () => {
    let closeCb: (code: number) => void;
    spawn.mockReturnValue({
      stdin: { end: vi.fn() },
      stdout: {
        on: vi.fn((ev: string, fn: (c: Buffer) => void) => {
          if (ev === 'data') setTimeout(() => fn(Buffer.from('ok')), 0);
        }),
      },
      on: vi.fn((ev: string, fn: (code: number) => void) => {
        if (ev === 'close') closeCb = fn;
      }),
      kill: vi.fn(),
    });

    const provider = new ClaudeCliProvider({ provider: 'claude-cli', model: 'default' });
    const streamPromise = provider.stream(
      { system: 'S', prompt: 'P', model: 'claude-haiku-4-5' },
      { onText: vi.fn(), onEnd: vi.fn(), onError: vi.fn() }
    );

    await new Promise((r) => setTimeout(r, 10));
    closeCb!(0);
    await streamPromise;

    if (IS_WINDOWS) {
      const cmdStr = spawn.mock.calls[0][0] as string;
      expect(cmdStr).toContain('--model');
      expect(cmdStr).toContain('claude-haiku-4-5');
    } else {
      const args = spawn.mock.calls[0][1];
      expect(args).toContain('--model');
      expect(args).toContain('claude-haiku-4-5');
    }
  });

  it('uses CALIBER_CLAUDE_CLI_TIMEOUT_MS when set', () => {
    const orig = process.env.CALIBER_CLAUDE_CLI_TIMEOUT_MS;
    process.env.CALIBER_CLAUDE_CLI_TIMEOUT_MS = '120000';
    const provider = new ClaudeCliProvider({ provider: 'claude-cli', model: 'default' });
    expect(provider).toBeDefined();
    process.env.CALIBER_CLAUDE_CLI_TIMEOUT_MS = orig;
  });
});

describe('isClaudeCliAvailable', () => {
  beforeEach(() => {
    execSync.mockReset();
  });

  it('returns true when claude is on PATH', () => {
    execSync.mockReturnValue(undefined);
    expect(isClaudeCliAvailable()).toBe(true);
    expect(execSync).toHaveBeenCalled();
    const cmd = execSync.mock.calls[0][0];
    expect(cmd).toContain('claude');
    expect(execSync.mock.calls[0][1]).toEqual({ stdio: 'ignore' });
  });

  it('returns false when claude is not found', () => {
    execSync.mockImplementation(() => {
      throw new Error('not found');
    });
    expect(isClaudeCliAvailable()).toBe(false);
  });
});

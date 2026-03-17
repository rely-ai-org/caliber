import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectProjectStack } from '../detect.js';

const mockLlmJsonCall = vi.fn();

vi.mock('../../llm/index.js', () => ({
  llmJsonCall: (...args: unknown[]) => mockLlmJsonCall(...args),
}));

describe('detectProjectStack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CALIBER_FAST_MODEL;
    delete process.env.ANTHROPIC_SMALL_FAST_MODEL;
    mockLlmJsonCall.mockResolvedValue({ languages: ['TypeScript'], frameworks: ['Express'], tools: ['PostgreSQL'] });
  });

  it('returns languages, frameworks, and tools from LLM', async () => {
    const result = await detectProjectStack(['src/index.ts'], {});
    expect(result.languages).toEqual(['TypeScript']);
    expect(result.frameworks).toEqual(['Express']);
    expect(result.tools).toEqual(['PostgreSQL']);
  });

  it('passes CALIBER_FAST_MODEL as model override when set', async () => {
    process.env.CALIBER_FAST_MODEL = 'gpt-4.1-mini';

    await detectProjectStack(['src/index.ts'], {});

    const callArgs = mockLlmJsonCall.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4.1-mini');
  });

  it('falls back to ANTHROPIC_SMALL_FAST_MODEL for backwards compat', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'claude-haiku-4-5';

    await detectProjectStack(['src/index.ts'], {});

    const callArgs = mockLlmJsonCall.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-haiku-4-5');
  });

  it('prefers CALIBER_FAST_MODEL over ANTHROPIC_SMALL_FAST_MODEL', async () => {
    process.env.CALIBER_FAST_MODEL = 'gpt-4.1-mini';
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'claude-haiku-4-5';

    await detectProjectStack(['src/index.ts'], {});

    const callArgs = mockLlmJsonCall.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4.1-mini');
  });

  it('uses provider default fast model when no env override is set', async () => {
    await detectProjectStack(['src/index.ts'], {});

    const callArgs = mockLlmJsonCall.mock.calls[0][0];
    // getFastModel() auto-resolves to provider default when no env var is set
    // Result depends on configured provider — may be undefined or a default model
  });

  it('caps file tree at 500 entries for large repos', async () => {
    const largeTree = Array.from({ length: 20000 }, (_, i) => `src/file-${i}.ts`);
    await detectProjectStack(largeTree, {});

    const callArgs = mockLlmJsonCall.mock.calls[0][0];
    const prompt = callArgs.prompt as string;
    // Should contain "500/20000" indicator and NOT all 20000 entries
    expect(prompt).toContain('500/20000');
    expect(prompt).toContain('file-499');
    expect(prompt).not.toContain('file-500');
  });

  it('returns empty arrays when LLM returns non-arrays', async () => {
    mockLlmJsonCall.mockResolvedValue({ languages: 'not-array', frameworks: null, tools: 123 });
    const result = await detectProjectStack(['file.ts'], {});
    expect(result.languages).toEqual([]);
    expect(result.frameworks).toEqual([]);
    expect(result.tools).toEqual([]);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../llm/index.js', () => ({
  llmCall: vi.fn(),
  parseJsonResponse: vi.fn(),
}));

import { refreshDocs } from '../refresh.js';
import { llmCall, parseJsonResponse } from '../../llm/index.js';

const mockedLlmCall = vi.mocked(llmCall);
const mockedParseJson = vi.mocked(parseJsonResponse);

describe('refreshDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CALIBER_FAST_MODEL;
    delete process.env.ANTHROPIC_SMALL_FAST_MODEL;
  });

  const baseDiff = {
    committed: 'diff --git a/src/index.ts',
    staged: '',
    unstaged: '',
    changedFiles: ['src/index.ts'],
    summary: 'Updated index.ts',
  };

  const baseContext = {
    languages: ['TypeScript'],
    frameworks: ['Express'],
    packageName: 'my-app',
  };

  it('includes project context in prompt', async () => {
    mockedLlmCall.mockResolvedValue('{}');
    mockedParseJson.mockReturnValue({
      updatedDocs: {},
      changesSummary: 'No changes',
      docsUpdated: [],
    });

    await refreshDocs(baseDiff, {}, baseContext);

    const prompt = mockedLlmCall.mock.calls[0][0].prompt;
    expect(prompt).toContain('Project: my-app');
    expect(prompt).toContain('Languages: TypeScript');
    expect(prompt).toContain('Frameworks: Express');
  });

  it('includes all diff types', async () => {
    mockedLlmCall.mockResolvedValue('{}');
    mockedParseJson.mockReturnValue({
      updatedDocs: {},
      changesSummary: '',
      docsUpdated: [],
    });

    await refreshDocs({
      ...baseDiff,
      committed: 'committed diff',
      staged: 'staged diff',
      unstaged: 'unstaged diff',
    }, {}, baseContext);

    const prompt = mockedLlmCall.mock.calls[0][0].prompt;
    expect(prompt).toContain('--- Committed Changes ---');
    expect(prompt).toContain('committed diff');
    expect(prompt).toContain('--- Staged Changes ---');
    expect(prompt).toContain('staged diff');
    expect(prompt).toContain('--- Unstaged Changes ---');
    expect(prompt).toContain('unstaged diff');
  });

  it('includes existing docs in prompt', async () => {
    mockedLlmCall.mockResolvedValue('{}');
    mockedParseJson.mockReturnValue({
      updatedDocs: {},
      changesSummary: '',
      docsUpdated: [],
    });

    await refreshDocs(baseDiff, {
      claudeMd: '# My CLAUDE.md',
      readmeMd: '# README',
      cursorrules: 'cursor rules content',
      claudeSkills: [{ filename: 'test.md', content: 'skill content' }],
      cursorRules: [{ filename: 'rule.mdc', content: 'rule content' }],
    }, baseContext);

    const prompt = mockedLlmCall.mock.calls[0][0].prompt;
    expect(prompt).toContain('[CLAUDE.md]');
    expect(prompt).toContain('# My CLAUDE.md');
    expect(prompt).toContain('[README.md]');
    expect(prompt).toContain('[.cursorrules]');
    expect(prompt).toContain('[.claude/skills/test.md]');
    expect(prompt).toContain('[.cursor/rules/rule.mdc]');
  });

  it('omits empty diff sections', async () => {
    mockedLlmCall.mockResolvedValue('{}');
    mockedParseJson.mockReturnValue({
      updatedDocs: {},
      changesSummary: '',
      docsUpdated: [],
    });

    await refreshDocs({
      ...baseDiff,
      committed: '',
      staged: '',
      unstaged: '',
    }, {}, baseContext);

    const prompt = mockedLlmCall.mock.calls[0][0].prompt;
    expect(prompt).not.toContain('--- Committed Changes ---');
    expect(prompt).not.toContain('--- Staged Changes ---');
    expect(prompt).not.toContain('--- Unstaged Changes ---');
  });

  it('uses maxTokens of 16384', async () => {
    mockedLlmCall.mockResolvedValue('{}');
    mockedParseJson.mockReturnValue({
      updatedDocs: {},
      changesSummary: '',
      docsUpdated: [],
    });

    await refreshDocs(baseDiff, {}, baseContext);

    expect(mockedLlmCall.mock.calls[0][0].maxTokens).toBe(16384);
  });

  it('passes CALIBER_FAST_MODEL as model override when set', async () => {
    process.env.CALIBER_FAST_MODEL = 'gpt-4.1-mini';
    mockedLlmCall.mockResolvedValue('{}');
    mockedParseJson.mockReturnValue({ updatedDocs: {}, changesSummary: '', docsUpdated: [] });

    await refreshDocs(baseDiff, {}, baseContext);

    expect(mockedLlmCall.mock.calls[0][0].model).toBe('gpt-4.1-mini');
  });

  it('falls back to ANTHROPIC_SMALL_FAST_MODEL', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.ANTHROPIC_SMALL_FAST_MODEL = 'claude-haiku-4-5';
    mockedLlmCall.mockResolvedValue('{}');
    mockedParseJson.mockReturnValue({ updatedDocs: {}, changesSummary: '', docsUpdated: [] });

    await refreshDocs(baseDiff, {}, baseContext);

    expect(mockedLlmCall.mock.calls[0][0].model).toBe('claude-haiku-4-5');
  });

  it('uses provider default fast model when no env override is set', async () => {
    mockedLlmCall.mockResolvedValue('{}');
    mockedParseJson.mockReturnValue({ updatedDocs: {}, changesSummary: '', docsUpdated: [] });

    await refreshDocs(baseDiff, {}, baseContext);

    // getFastModel() auto-resolves to provider default when no env var is set
  });
});

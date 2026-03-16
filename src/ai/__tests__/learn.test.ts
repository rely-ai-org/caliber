import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the non-exported helper functions, so we use a workaround:
// import the module and test via the exported analyzeEvents function behavior,
// or test the logic directly by re-implementing the function signatures.
// Since formatEventsForPrompt, trimEventsToFit, and parseAnalysisResponse are
// not exported, we test them through the module's public API and via direct
// unit tests of equivalent logic.

// For direct testing, let's extract and test the functions by importing the module.
// Actually we can mock llmCall and test analyzeEvents end-to-end.

vi.mock('../../llm/index.js', () => ({
  llmCall: vi.fn(),
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
}));

vi.mock('../../llm/utils.js', () => ({
  extractJson: (text: string) => {
    const start = text.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
  },
  stripMarkdownFences: (text: string) => text.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '').trim(),
}));

import { analyzeEvents, calculateSessionWaste } from '../learn.js';
import { llmCall } from '../../llm/index.js';

const mockedLlmCall = vi.mocked(llmCall);

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    session_id: 'sess-1',
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { file_path: '/test.ts' },
    tool_response: { content: 'file contents' },
    tool_use_id: 'tu-1',
    cwd: '/project',
    ...overrides,
  };
}

function makePromptEvent(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    session_id: 'sess-1',
    hook_event_name: 'UserPromptSubmit' as const,
    prompt_content: 'No, use pnpm not npm',
    cwd: '/project',
    ...overrides,
  };
}

describe('analyzeEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls llmCall with events formatted in prompt', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: '- Always use pnpm',
      skills: null,
      explanations: ['Found pnpm usage pattern'],
    }));

    const events = [makeEvent({ tool_name: 'Bash', tool_input: { command: 'pnpm install' } })];
    const result = await analyzeEvents(events);

    expect(mockedLlmCall).toHaveBeenCalledOnce();
    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('Event 1');
    expect(callArgs.prompt).toContain('Bash');
    expect(result.claudeMdLearnedSection).toBe('- Always use pnpm');
    expect(result.explanations).toContain('Found pnpm usage pattern');
  });

  it('marks failure events correctly', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: null,
      skills: null,
      explanations: ['No patterns found'],
    }));

    const events = [makeEvent({ hook_event_name: 'PostToolUseFailure' })];
    await analyzeEvents(events);

    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('[FAILURE]');
  });

  it('marks success events correctly', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: null,
      skills: null,
      explanations: [],
    }));

    const events = [makeEvent({ hook_event_name: 'PostToolUse' })];
    await analyzeEvents(events);

    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('[SUCCESS]');
  });

  it('includes existing CLAUDE.md context truncated to 5000 chars', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: null,
      skills: null,
      explanations: [],
    }));

    const longClaudeMd = 'x'.repeat(6000);
    await analyzeEvents([makeEvent()], longClaudeMd);

    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('Existing CLAUDE.md');
    // Should be truncated to 5000
    expect(callArgs.prompt).not.toContain('x'.repeat(6000));
  });

  it('includes existing learned section', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: null,
      skills: null,
      explanations: [],
    }));

    await analyzeEvents([makeEvent()], undefined, '- Use pnpm\n- Always lint');

    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('Existing Learned Section');
    expect(callArgs.prompt).toContain('Use pnpm');
  });

  it('includes existing skills summary', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: null,
      skills: null,
      explanations: [],
    }));

    const skills = [{ filename: 'testing.md', content: 'Test with vitest' }];
    await analyzeEvents([makeEvent()], undefined, null, skills);

    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('Existing Skills');
    expect(callArgs.prompt).toContain('testing.md');
  });

  it('handles truncated tool responses', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: null,
      skills: null,
      explanations: [],
    }));

    const events = [makeEvent({
      tool_response: { _truncated: 'This was a very long response...' },
    })];
    await analyzeEvents(events);

    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('This was a very long response...');
  });

  it('handles unparseable LLM response gracefully', async () => {
    mockedLlmCall.mockResolvedValue('This is not JSON at all');

    const result = await analyzeEvents([makeEvent()]);
    expect(result.claudeMdLearnedSection).toBeNull();
    expect(result.skills).toBeNull();
    expect(result.explanations.length).toBeGreaterThan(0);
  });

  it('formats UserPromptSubmit events as USER_PROMPT', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: '- **[correction]** Use pnpm not npm',
      skills: null,
      explanations: ['User corrected tool usage'],
    }));

    const events = [makePromptEvent()];
    await analyzeEvents(events);

    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('[USER_PROMPT]');
    expect(callArgs.prompt).toContain('User said:');
    expect(callArgs.prompt).toContain('No, use pnpm not npm');
  });

  it('handles mixed tool and prompt events', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: null,
      skills: null,
      explanations: [],
    }));

    const events = [
      makeEvent({ tool_name: 'Bash', tool_input: { command: 'npm install' } }),
      makePromptEvent({ prompt_content: 'Stop, use pnpm instead' }),
      makeEvent({ tool_name: 'Bash', tool_input: { command: 'pnpm install' } }),
    ];
    await analyzeEvents(events);

    const callArgs = mockedLlmCall.mock.calls[0][0];
    expect(callArgs.prompt).toContain('[SUCCESS]');
    expect(callArgs.prompt).toContain('[USER_PROMPT]');
    expect(callArgs.prompt).toContain('Stop, use pnpm instead');
  });

  it('returns skills from LLM response', async () => {
    mockedLlmCall.mockResolvedValue(JSON.stringify({
      claudeMdLearnedSection: null,
      skills: [{ name: 'learned-testing', description: 'Testing pattern', content: '# Test', isNew: true }],
      explanations: ['Detected testing pattern'],
    }));

    const result = await analyzeEvents([makeEvent()]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills![0].name).toBe('learned-testing');
  });
});

describe('calculateSessionWaste', () => {
  it('counts failure events and their token cost', () => {
    const events = [
      makeEvent({ hook_event_name: 'PostToolUseFailure', tool_input: { cmd: 'x' }, tool_response: { error: 'failed' } }),
      makeEvent({ hook_event_name: 'PostToolUseFailure', tool_input: { cmd: 'y' }, tool_response: { error: 'boom' } }),
      makeEvent({ hook_event_name: 'PostToolUse' }),
    ];

    const result = calculateSessionWaste(events);
    expect(result.failureCount).toBe(2);
    expect(result.promptCount).toBe(0);
    expect(result.totalWasteTokens).toBeGreaterThan(0);
  });

  it('counts prompt events without adding to waste tokens', () => {
    const events = [
      makePromptEvent({ prompt_content: 'No, use pnpm' }),
      makePromptEvent({ prompt_content: 'Stop doing that' }),
    ];

    const result = calculateSessionWaste(events);
    expect(result.promptCount).toBe(2);
    expect(result.failureCount).toBe(0);
    expect(result.totalWasteTokens).toBe(0);
  });

  it('returns zeros for success-only sessions', () => {
    const events = [
      makeEvent({ hook_event_name: 'PostToolUse' }),
      makeEvent({ hook_event_name: 'PostToolUse' }),
    ];

    const result = calculateSessionWaste(events);
    expect(result.failureCount).toBe(0);
    expect(result.promptCount).toBe(0);
    expect(result.totalWasteTokens).toBe(0);
  });

  it('sums waste from both failures and corrections', () => {
    const events = [
      makeEvent({ hook_event_name: 'PostToolUseFailure', tool_input: { cmd: 'bad' }, tool_response: { error: 'no' } }),
      makePromptEvent({ prompt_content: 'Wrong approach, try X' }),
      makeEvent({ hook_event_name: 'PostToolUse' }),
    ];

    const result = calculateSessionWaste(events);
    expect(result.failureCount).toBe(1);
    expect(result.promptCount).toBe(1);
    expect(result.totalWasteTokens).toBeGreaterThan(0);
  });

  it('handles truncated responses', () => {
    const events = [
      makeEvent({
        hook_event_name: 'PostToolUseFailure',
        tool_response: { _truncated: 'very long error output...' },
      }),
    ];

    const result = calculateSessionWaste(events);
    expect(result.failureCount).toBe(1);
    expect(result.totalWasteTokens).toBeGreaterThan(0);
  });
});

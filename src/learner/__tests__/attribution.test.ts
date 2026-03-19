import { describe, it, expect } from 'vitest';
import {
  matchLearningsToFailures,
  updateActivations,
  findStaleLearnings,
} from '../attribution.js';
import type { LearningCostEntry, ROIStats, SessionROISummary } from '../roi.js';
import type { ToolEvent } from '../storage.js';

function makeLearning(overrides: Partial<LearningCostEntry> = {}): LearningCostEntry {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    observationType: 'gotcha',
    summary: 'tsup swallows type errors',
    wasteTokens: 500,
    sourceEventCount: 50,
    ...overrides,
  };
}

function makeFailureEvent(response: string, tool = 'Bash'): ToolEvent {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    session_id: 'test',
    hook_event_name: 'PostToolUseFailure',
    tool_name: tool,
    tool_input: { command: 'test' },
    tool_response: { error: response },
    tool_use_id: 'tu-1',
    cwd: '/test',
  };
}

function makeSession(overrides: Partial<SessionROISummary> = {}): SessionROISummary {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    sessionId: 'sess-1',
    eventCount: 50,
    failureCount: 3,
    promptCount: 1,
    wasteSeconds: 0,
    hadLearningsAvailable: false,
    learningsCount: 0,
    newLearningsProduced: 0,
    ...overrides,
  };
}

describe('matchLearningsToFailures', () => {
  it('matches learnings to failure events by substring similarity', () => {
    const learnings = [
      makeLearning({ summary: 'tsup swallows type errors' }),
      makeLearning({ summary: 'always run npm ci before deploy' }),
      makeLearning({ summary: 'use pnpm not npm' }),
    ];
    const failures = [
      makeFailureEvent('Error: tsup swallows type errors and shows nothing useful'),
      makeFailureEvent('Error: cannot find module express'),
    ];

    const result = matchLearningsToFailures(learnings, failures);

    expect(result.matchedIndices).toContain(0);
    expect(result.unmatchedFailures).toBe(1);
  });

  it('returns empty when no learnings', () => {
    const result = matchLearningsToFailures([], [makeFailureEvent('error')]);
    expect(result.matchedIndices).toEqual([]);
    expect(result.unmatchedFailures).toBe(1);
  });

  it('returns empty when no failures', () => {
    const result = matchLearningsToFailures([makeLearning()], []);
    expect(result.matchedIndices).toEqual([]);
    expect(result.unmatchedFailures).toBe(0);
  });

  it('does not match dissimilar learnings', () => {
    const learnings = [makeLearning({ summary: 'use pnpm not npm' })];
    const failures = [makeFailureEvent('Error: database connection timeout')];

    const result = matchLearningsToFailures(learnings, failures);
    expect(result.matchedIndices).toEqual([]);
    expect(result.unmatchedFailures).toBe(1);
  });

  it('matches all when all failures relate to learnings', () => {
    const learnings = [
      makeLearning({ summary: 'tsup swallows type errors' }),
    ];
    const failures = [
      makeFailureEvent('tsup swallows type errors during build'),
      makeFailureEvent('again tsup swallows type errors silently'),
    ];

    const result = matchLearningsToFailures(learnings, failures);
    expect(result.matchedIndices).toContain(0);
    expect(result.unmatchedFailures).toBe(0);
  });
});

describe('updateActivations', () => {
  it('increments activation counts for matched learnings', () => {
    const stats: ROIStats = {
      learnings: [
        makeLearning({ activationCount: 0 }),
        makeLearning({ summary: 'other learning', activationCount: 3 }),
      ],
      sessions: [],
      totals: {
        totalWasteTokens: 0, totalWasteSeconds: 0,
        totalSessionsWithLearnings: 0, totalSessionsWithoutLearnings: 0,
        totalFailuresWithLearnings: 0, totalFailuresWithoutLearnings: 0,
        estimatedSavingsTokens: 0, estimatedSavingsSeconds: 0,
        firstSessionTimestamp: '', lastSessionTimestamp: '',
      },
    };

    updateActivations(stats, [0, 1]);

    expect(stats.learnings[0].activationCount).toBe(1);
    expect(stats.learnings[1].activationCount).toBe(4);
    expect(stats.learnings[0].lastActivationTimestamp).toBeTruthy();
    expect(stats.learnings[1].lastActivationTimestamp).toBeTruthy();
  });

  it('handles undefined activationCount gracefully', () => {
    const stats: ROIStats = {
      learnings: [makeLearning()], // no activationCount field
      sessions: [],
      totals: {
        totalWasteTokens: 0, totalWasteSeconds: 0,
        totalSessionsWithLearnings: 0, totalSessionsWithoutLearnings: 0,
        totalFailuresWithLearnings: 0, totalFailuresWithoutLearnings: 0,
        estimatedSavingsTokens: 0, estimatedSavingsSeconds: 0,
        firstSessionTimestamp: '', lastSessionTimestamp: '',
      },
    };

    updateActivations(stats, [0]);
    expect(stats.learnings[0].activationCount).toBe(1);
  });

  it('skips out-of-bounds indices', () => {
    const stats: ROIStats = {
      learnings: [makeLearning()],
      sessions: [],
      totals: {
        totalWasteTokens: 0, totalWasteSeconds: 0,
        totalSessionsWithLearnings: 0, totalSessionsWithoutLearnings: 0,
        totalFailuresWithLearnings: 0, totalFailuresWithoutLearnings: 0,
        estimatedSavingsTokens: 0, estimatedSavingsSeconds: 0,
        firstSessionTimestamp: '', lastSessionTimestamp: '',
      },
    };

    updateActivations(stats, [0, 5, 10]);
    expect(stats.learnings[0].activationCount).toBe(1);
  });
});

describe('findStaleLearnings', () => {
  it('flags learnings with zero activations after enough sessions', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => makeSession({
      sessionId: `s${i}`,
      timestamp: `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));

    const stats: ROIStats = {
      learnings: [
        makeLearning({ activationCount: 0, timestamp: '2026-01-01T00:00:00Z' }),
        makeLearning({ summary: 'active one', activationCount: 5, timestamp: '2026-01-01T00:00:00Z' }),
        makeLearning({ summary: 'new one', activationCount: 0, timestamp: '2026-02-10T00:00:00Z' }),
      ],
      sessions,
      totals: {
        totalWasteTokens: 0, totalWasteSeconds: 0,
        totalSessionsWithLearnings: 0, totalSessionsWithoutLearnings: 0,
        totalFailuresWithLearnings: 0, totalFailuresWithoutLearnings: 0,
        estimatedSavingsTokens: 0, estimatedSavingsSeconds: 0,
        firstSessionTimestamp: '', lastSessionTimestamp: '',
      },
    };

    const stale = findStaleLearnings(stats);

    expect(stale).toHaveLength(1);
    expect(stale[0].summary).toBe('tsup swallows type errors');
  });

  it('returns empty when not enough sessions', () => {
    const stats: ROIStats = {
      learnings: [makeLearning({ activationCount: 0 })],
      sessions: [makeSession()],
      totals: {
        totalWasteTokens: 0, totalWasteSeconds: 0,
        totalSessionsWithLearnings: 0, totalSessionsWithoutLearnings: 0,
        totalFailuresWithLearnings: 0, totalFailuresWithoutLearnings: 0,
        estimatedSavingsTokens: 0, estimatedSavingsSeconds: 0,
        firstSessionTimestamp: '', lastSessionTimestamp: '',
      },
    };

    expect(findStaleLearnings(stats)).toEqual([]);
  });

  it('returns empty when all learnings have activations', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => makeSession({
      sessionId: `s${i}`,
      timestamp: `2026-02-0${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));

    const stats: ROIStats = {
      learnings: [
        makeLearning({ activationCount: 3, timestamp: '2026-01-01T00:00:00Z' }),
        makeLearning({ summary: 'other', activationCount: 1, timestamp: '2026-01-01T00:00:00Z' }),
      ],
      sessions,
      totals: {
        totalWasteTokens: 0, totalWasteSeconds: 0,
        totalSessionsWithLearnings: 0, totalSessionsWithoutLearnings: 0,
        totalFailuresWithLearnings: 0, totalFailuresWithoutLearnings: 0,
        estimatedSavingsTokens: 0, estimatedSavingsSeconds: 0,
        firstSessionTimestamp: '', lastSessionTimestamp: '',
      },
    };

    expect(findStaleLearnings(stats)).toEqual([]);
  });
});

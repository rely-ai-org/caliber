import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  readROIStats,
  writeROIStats,
  recordSession,
  formatROISummary,
} from '../roi.js';
import type { ROIStats, SessionROISummary, LearningCostEntry } from '../roi.js';

const LEARNING_DIR = '.caliber/learning';
const ROI_FILE = path.join(LEARNING_DIR, 'roi-stats.json');

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

function makeLearningEntry(overrides: Partial<LearningCostEntry> = {}): LearningCostEntry {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    observationType: 'gotcha',
    summary: 'tsup swallows type errors',
    wasteTokens: 500,
    sourceEventCount: 50,
    ...overrides,
  };
}

describe('ROI stats', () => {
  beforeEach(() => {
    if (fs.existsSync(ROI_FILE)) fs.unlinkSync(ROI_FILE);
  });

  afterEach(() => {
    if (fs.existsSync(ROI_FILE)) fs.unlinkSync(ROI_FILE);
  });

  it('returns defaults when file does not exist', () => {
    const stats = readROIStats();
    expect(stats.learnings).toEqual([]);
    expect(stats.sessions).toEqual([]);
    expect(stats.totals.totalWasteTokens).toBe(0);
    expect(stats.totals.estimatedSavingsTokens).toBe(0);
  });

  it('round-trips stats through write and read', () => {
    const stats: ROIStats = {
      learnings: [makeLearningEntry()],
      sessions: [makeSession()],
      totals: {
        totalWasteTokens: 500,
        totalWasteSeconds: 0,
        totalSessionsWithLearnings: 0,
        totalSessionsWithoutLearnings: 1,
        totalFailuresWithLearnings: 0,
        totalFailuresWithoutLearnings: 3,
        estimatedSavingsTokens: 0,
        estimatedSavingsSeconds: 0,
        firstSessionTimestamp: '2026-01-01T00:00:00Z',
        lastSessionTimestamp: '2026-01-01T00:00:00Z',
      },
    };

    writeROIStats(stats);
    const read = readROIStats();
    expect(read.learnings).toHaveLength(1);
    expect(read.sessions).toHaveLength(1);
    expect(read.totals.totalWasteTokens).toBe(500);
  });

  it('recordSession appends and recalculates totals', () => {
    recordSession(makeSession({ failureCount: 5, hadLearningsAvailable: false }));
    recordSession(makeSession({ sessionId: 'sess-2', failureCount: 2, hadLearningsAvailable: true, learningsCount: 3 }));

    const stats = readROIStats();
    expect(stats.sessions).toHaveLength(2);
    expect(stats.totals.totalSessionsWithoutLearnings).toBe(1);
    expect(stats.totals.totalSessionsWithLearnings).toBe(1);
    expect(stats.totals.totalFailuresWithoutLearnings).toBe(5);
    expect(stats.totals.totalFailuresWithLearnings).toBe(2);
  });

  it('recordSession with learnings appends both and updates waste total', () => {
    const learnings = [
      makeLearningEntry({ wasteTokens: 300, summary: 'tsup swallows type errors' }),
      makeLearningEntry({ wasteTokens: 200, observationType: 'fix', summary: 'always run npm ci before deploy' }),
    ];
    recordSession(makeSession(), learnings);

    const stats = readROIStats();
    expect(stats.learnings).toHaveLength(2);
    expect(stats.sessions).toHaveLength(1);
    expect(stats.totals.totalWasteTokens).toBe(500);
  });

  it('recordSession without learnings does not add learning entries', () => {
    recordSession(makeSession());
    const stats = readROIStats();
    expect(stats.learnings).toHaveLength(0);
    expect(stats.sessions).toHaveLength(1);
  });

  it('calculates savings as wasteTokens * sessions with learnings', () => {
    const learnings = [makeLearningEntry({ wasteTokens: 1000 })];
    // Session that produced the learning (no learnings available yet)
    recordSession(makeSession({ hadLearningsAvailable: false, newLearningsProduced: 1 }), learnings);
    // 3 sessions that benefited from it
    recordSession(makeSession({ sessionId: 's2', hadLearningsAvailable: true }));
    recordSession(makeSession({ sessionId: 's3', hadLearningsAvailable: true }));
    recordSession(makeSession({ sessionId: 's4', hadLearningsAvailable: true }));

    const stats = readROIStats();
    // 3 sessions with learnings available → savings = 1000 * 3
    expect(stats.totals.estimatedSavingsTokens).toBe(1000 * 3);
  });

  it('includes learning-producing sessions with learnings in savings', () => {
    const learnings = [makeLearningEntry({ wasteTokens: 500 })];
    recordSession(makeSession({ hadLearningsAvailable: false }), learnings);
    // Session that had learnings AND produced new ones — still benefited from existing
    recordSession(makeSession({ sessionId: 's2', hadLearningsAvailable: true, newLearningsProduced: 2 }));
    // Session that only consumed
    recordSession(makeSession({ sessionId: 's3', hadLearningsAvailable: true }));

    const stats = readROIStats();
    // 2 sessions with learnings → savings = 500 * 2
    expect(stats.totals.estimatedSavingsTokens).toBe(500 * 2);
  });

  it('tracks first and last session timestamps', () => {
    recordSession(makeSession({ timestamp: '2026-01-01T00:00:00Z' }));
    recordSession(makeSession({ sessionId: 's2', timestamp: '2026-03-15T00:00:00Z' }));

    const stats = readROIStats();
    expect(stats.totals.firstSessionTimestamp).toBe('2026-01-01T00:00:00Z');
    expect(stats.totals.lastSessionTimestamp).toBe('2026-03-15T00:00:00Z');
  });
});

describe('formatROISummary', () => {
  it('returns empty string when no sessions', () => {
    const stats = readROIStats();
    expect(formatROISummary(stats)).toBe('');
  });

  it('shows session counts and failure rates', () => {
    const stats: ROIStats = {
      learnings: [makeLearningEntry({ wasteTokens: 2000 })],
      sessions: [
        makeSession({ hadLearningsAvailable: false, failureCount: 5 }),
        makeSession({ sessionId: 's2', hadLearningsAvailable: true, failureCount: 1, learningsCount: 3 }),
        makeSession({ sessionId: 's3', hadLearningsAvailable: true, failureCount: 2, learningsCount: 3 }),
      ],
      totals: {
        totalWasteTokens: 2000,
        totalWasteSeconds: 30,
        totalSessionsWithLearnings: 2,
        totalSessionsWithoutLearnings: 1,
        totalFailuresWithLearnings: 3,
        totalFailuresWithoutLearnings: 5,
        estimatedSavingsTokens: 4000,
        estimatedSavingsSeconds: 60,
        firstSessionTimestamp: '2026-01-01T00:00:00Z',
        lastSessionTimestamp: '2026-03-15T00:00:00Z',
      },
    };

    const output = formatROISummary(stats);
    expect(output).toContain('ROI Summary');
    expect(output).toContain('Sessions tracked:              3');
    expect(output).toContain('Sessions with learnings:       2');
    expect(output).toContain('Failure rate (no learnings):   5.0/session');
    expect(output).toContain('Failure rate (with learnings): 1.5/session');
    expect(output).toContain('2,000 tokens');
    expect(output).toContain('4,000 tokens');
    expect(output).toContain('at least 1m');
    expect(output).toContain('not counting human frustration');
  });

  it('omits failure rate section when no sessions of that type', () => {
    const stats: ROIStats = {
      learnings: [],
      sessions: [makeSession({ hadLearningsAvailable: true, failureCount: 2, learningsCount: 5 })],
      totals: {
        totalWasteTokens: 0,
        totalWasteSeconds: 0,
        totalSessionsWithLearnings: 1,
        totalSessionsWithoutLearnings: 0,
        totalFailuresWithLearnings: 2,
        totalFailuresWithoutLearnings: 0,
        estimatedSavingsTokens: 0,
        estimatedSavingsSeconds: 0,
        firstSessionTimestamp: '2026-01-01T00:00:00Z',
        lastSessionTimestamp: '2026-01-01T00:00:00Z',
      },
    };

    const output = formatROISummary(stats);
    expect(output).not.toContain('Failure rate (no learnings)');
    expect(output).toContain('Failure rate (with learnings): 2.0/session');
  });
});

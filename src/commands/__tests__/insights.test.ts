vi.mock('../../learner/roi.js', async () => {
  const actual = await vi.importActual<typeof import('../../learner/roi.js')>('../../learner/roi.js');
  return {
    ...actual,
    readROIStats: vi.fn(),
  };
});
vi.mock('../../scoring/index.js', () => ({
  computeLocalScore: vi.fn(() => ({ score: 85, grade: 'A', checks: [] })),
}));
vi.mock('../../lib/state.js', () => ({
  readState: vi.fn(() => null),
}));
vi.mock('../../telemetry/events.js', () => ({
  trackInsightsViewed: vi.fn(),
}));
vi.mock('../../lib/learning-hooks.js', () => ({
  areLearningHooksInstalled: vi.fn(() => false),
  areCursorLearningHooksInstalled: vi.fn(() => false),
}));

import { insightsCommand } from '../insights.js';
import { readROIStats } from '../../learner/roi.js';
import { areLearningHooksInstalled } from '../../lib/learning-hooks.js';
import type { ROIStats, ROITotals } from '../../learner/roi.js';

const mockReadROIStats = readROIStats as ReturnType<typeof vi.fn>;
const mockHooksInstalled = areLearningHooksInstalled as ReturnType<typeof vi.fn>;

function makeEmptyTotals(): ROITotals {
  return {
    totalWasteTokens: 0,
    totalWasteSeconds: 0,
    totalSessionsWithLearnings: 0,
    totalSessionsWithoutLearnings: 0,
    totalFailuresWithLearnings: 0,
    totalFailuresWithoutLearnings: 0,
    estimatedSavingsTokens: 0,
    estimatedSavingsSeconds: 0,
    firstSessionTimestamp: '',
    lastSessionTimestamp: '',
  };
}

function makeStats(sessionCount: number, opts?: { withTasks?: boolean; withLearnings?: number }): ROIStats {
  const sessions = Array.from({ length: sessionCount }, (_, i) => ({
    timestamp: `2026-01-0${i + 1}T00:00:00Z`,
    sessionId: `s${i}`,
    eventCount: 50,
    failureCount: i % 3 === 0 ? 3 : 1,
    promptCount: 2,
    wasteSeconds: 30,
    hadLearningsAvailable: i > 0,
    learningsCount: i > 0 ? 5 : 0,
    newLearningsProduced: i === 0 ? 3 : 0,
    ...(opts?.withTasks ? {
      taskCount: 5,
      taskSuccessCount: 3,
      taskCorrectionCount: 1,
      taskFailureCount: 1,
    } : {}),
  }));

  const learningCount = opts?.withLearnings ?? (sessionCount > 0 ? 5 : 0);
  const learnings = Array.from({ length: learningCount }, (_, i) => ({
    timestamp: '2026-01-01T00:00:00Z',
    observationType: 'pattern',
    summary: `learning ${i}`,
    wasteTokens: 100,
    sourceEventCount: 50,
    occurrences: i + 1,
  }));

  const withLearnings = sessions.filter(s => s.hadLearningsAvailable).length;
  const withoutLearnings = sessions.filter(s => !s.hadLearningsAvailable).length;

  return {
    sessions,
    learnings,
    totals: {
      ...makeEmptyTotals(),
      totalSessionsWithLearnings: withLearnings,
      totalSessionsWithoutLearnings: withoutLearnings,
      totalFailuresWithLearnings: sessions.filter(s => s.hadLearningsAvailable).reduce((sum, s) => sum + s.failureCount, 0),
      totalFailuresWithoutLearnings: sessions.filter(s => !s.hadLearningsAvailable).reduce((sum, s) => sum + s.failureCount, 0),
      totalWasteTokens: learningCount * 100,
      totalWasteSeconds: sessionCount * 30,
      estimatedSavingsTokens: learningCount * 100 * withLearnings,
      estimatedSavingsSeconds: sessionCount * 30 * withLearnings,
    },
  };
}

describe('insights command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('shows install message when no hooks and no data', async () => {
    mockReadROIStats.mockReturnValue(makeStats(0, { withLearnings: 0 }));
    mockHooksInstalled.mockReturnValue(false);

    await insightsCommand({});

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('No learning hooks installed');
    expect(output).toContain('caliber learn install');
  });

  it('shows "no data yet" when hooks installed but no sessions', async () => {
    mockReadROIStats.mockReturnValue(makeStats(0, { withLearnings: 0 }));
    mockHooksInstalled.mockReturnValue(true);

    await insightsCommand({});

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('No session data yet');
  });

  it('shows early data caveat for <20 sessions', async () => {
    mockReadROIStats.mockReturnValue(makeStats(10));

    await insightsCommand({});

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('early data');
    expect(output).toContain('Sessions tracked');
  });

  it('shows full insights for 20+ sessions', async () => {
    mockReadROIStats.mockReturnValue(makeStats(25, { withTasks: true }));

    await insightsCommand({});

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('Agent Health');
    expect(output).toContain('Learning Impact');
    expect(output).toContain('Task success rate');
  });

  it('JSON output includes tier field', async () => {
    mockReadROIStats.mockReturnValue(makeStats(5));

    await insightsCommand({ json: true });

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.tier).toBe('early');
    expect(parsed.totalSessions).toBe(5);
    expect(parsed.configScore).toBe(85);
  });

  it('JSON output shows cold-start tier for 0 sessions', async () => {
    mockReadROIStats.mockReturnValue(makeStats(0, { withLearnings: 0 }));

    await insightsCommand({ json: true });

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.tier).toBe('cold-start');
  });

  it('shows task metrics when available in full mode', async () => {
    mockReadROIStats.mockReturnValue(makeStats(25, { withTasks: true }));

    await insightsCommand({});

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('60%'); // 3/5 = 60% success rate
    expect(output).toContain('Corrections needed');
  });
});

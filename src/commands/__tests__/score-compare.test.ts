import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

vi.mock('../../scoring/index.js', () => ({
  computeLocalScore: vi.fn(),
}));
vi.mock('../../scoring/display.js', () => ({
  displayScore: vi.fn(),
}));
vi.mock('../../lib/state.js', () => ({
  readState: vi.fn(() => null),
}));
vi.mock('../../telemetry/events.js', () => ({
  trackScoreComputed: vi.fn(),
}));

import { scoreCommand } from '../score.js';
import { computeLocalScore } from '../../scoring/index.js';

const mockComputeLocalScore = computeLocalScore as ReturnType<typeof vi.fn>;
const mockExecFileSync = execFileSync as unknown as ReturnType<typeof vi.fn>;

describe('score --compare', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();

    // Default: current score
    mockComputeLocalScore.mockReturnValue({
      score: 87,
      grade: 'A',
      checks: [],
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('shows regression delta in quiet mode', async () => {
    // First call = current score, second call = base score
    mockComputeLocalScore
      .mockReturnValueOnce({ score: 87, grade: 'A', checks: [] })
      .mockReturnValueOnce({ score: 92, grade: 'A', checks: [] });

    // Mock git show to return file content
    mockExecFileSync.mockReturnValue('# CLAUDE.md content');

    await scoreCommand({ quiet: true, compare: 'main' });

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('87/100');
    expect(output).toContain('-5');
    expect(output).toContain('main');
  });

  it('shows improvement delta', async () => {
    mockComputeLocalScore
      .mockReturnValueOnce({ score: 85, grade: 'A', checks: [] })
      .mockReturnValueOnce({ score: 70, grade: 'B', checks: [] });

    mockExecFileSync.mockReturnValue('# content');

    await scoreCommand({ quiet: true, compare: 'main' });

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('+15');
  });

  it('shows no change', async () => {
    mockComputeLocalScore
      .mockReturnValueOnce({ score: 85, grade: 'A', checks: [] })
      .mockReturnValueOnce({ score: 85, grade: 'A', checks: [] });

    mockExecFileSync.mockReturnValue('# content');

    await scoreCommand({ quiet: true, compare: 'main' });

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('85/100');
    // No +/- prefix for zero delta
    expect(output).toContain('0');
  });

  it('shows error when base ref not found', async () => {
    // Current score works, but base scoring throws (simulating scoreBaseRef returning null)
    mockComputeLocalScore
      .mockReturnValueOnce({ score: 87, grade: 'A', checks: [] })
      .mockImplementationOnce(() => { throw new Error('scoring failed'); });
    mockExecFileSync.mockImplementation(() => { throw new Error('fatal: not a valid ref'); });

    await scoreCommand({ compare: 'nonexistent-branch' });

    expect(errorSpy).toHaveBeenCalled();
    const errorOutput = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(errorOutput).toContain('nonexistent-branch');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined as unknown as number;
  });

  it('returns JSON with both scores', async () => {
    mockComputeLocalScore
      .mockReturnValueOnce({ score: 87, grade: 'A', checks: [] })
      .mockReturnValueOnce({ score: 92, grade: 'A', checks: [] });

    mockExecFileSync.mockReturnValue('# content');

    await scoreCommand({ json: true, compare: 'main' });

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed.current.score).toBe(87);
    expect(parsed.base.score).toBe(92);
    expect(parsed.delta).toBe(-5);
  });

  it('handles base with no config files (base scores from empty dir)', async () => {
    // Current score = 87, base score = 0 (empty config dir)
    mockComputeLocalScore
      .mockReturnValueOnce({ score: 87, grade: 'A', checks: [] })
      .mockReturnValueOnce({ score: 0, grade: 'F', checks: [] });

    // git show/ls-tree throw for all files (none exist in base)
    mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });

    await scoreCommand({ quiet: true, compare: 'main' });

    // scoreBaseRef still runs computeLocalScore on empty temp dir → returns 0
    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(output).toContain('87/100');
    expect(output).toContain('+87');
  });
});

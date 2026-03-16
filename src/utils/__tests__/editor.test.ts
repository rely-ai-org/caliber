import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync, spawn } from 'child_process';

vi.mock('child_process');

import { detectAvailableEditors, openDiffsInEditor } from '../editor.js';

const IS_WINDOWS = process.platform === 'win32';
const whichCmd = IS_WINDOWS ? 'where' : 'which';

describe('detectAvailableEditors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });
  });

  it('returns cursor and terminal when cursor is available', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (String(cmd) === `${whichCmd} cursor`) return Buffer.from('/usr/local/bin/cursor');
      throw new Error('not found');
    });

    expect(detectAvailableEditors()).toEqual(['cursor', 'terminal']);
  });

  it('returns vscode and terminal when code is available', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (String(cmd) === `${whichCmd} code`) return Buffer.from('/usr/local/bin/code');
      throw new Error('not found');
    });

    expect(detectAvailableEditors()).toEqual(['vscode', 'terminal']);
  });

  it('returns all three when both editors are available', () => {
    vi.mocked(execSync).mockImplementation((cmd) => {
      const s = String(cmd);
      if (s === `${whichCmd} cursor`) return Buffer.from('/usr/local/bin/cursor');
      if (s === `${whichCmd} code`) return Buffer.from('/usr/local/bin/code');
      throw new Error('not found');
    });

    expect(detectAvailableEditors()).toEqual(['cursor', 'vscode', 'terminal']);
  });

  it('returns only terminal when no editors are available', () => {
    expect(detectAvailableEditors()).toEqual(['terminal']);
  });
});

describe('openDiffsInEditor', () => {
  const mockUnref = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReturnValue({ unref: mockUnref } as unknown as ReturnType<typeof spawn>);
  });

  it('opens diff for modified files using --diff with original path', () => {
    openDiffsInEditor('cursor', [
      { originalPath: '/project/CLAUDE.md', proposedPath: '/tmp/proposed/CLAUDE.md' },
    ]);

    if (IS_WINDOWS) {
      expect(spawn).toHaveBeenCalledWith(
        'cursor --diff "/project/CLAUDE.md" "/tmp/proposed/CLAUDE.md"',
        { shell: true, stdio: 'ignore', detached: true }
      );
    } else {
      expect(spawn).toHaveBeenCalledWith(
        'cursor',
        ['--diff', '/project/CLAUDE.md', '/tmp/proposed/CLAUDE.md'],
        { stdio: 'ignore', detached: true }
      );
    }
    expect(mockUnref).toHaveBeenCalled();
  });

  it('opens new files directly without --diff', () => {
    openDiffsInEditor('vscode', [
      { proposedPath: '/tmp/proposed/new.md' },
    ]);

    if (IS_WINDOWS) {
      expect(spawn).toHaveBeenCalledWith(
        'code "/tmp/proposed/new.md"',
        { shell: true, stdio: 'ignore', detached: true }
      );
    } else {
      expect(spawn).toHaveBeenCalledWith(
        'code',
        ['/tmp/proposed/new.md'],
        { stdio: 'ignore', detached: true }
      );
    }
  });

  it('continues on error for individual files', () => {
    vi.mocked(spawn)
      .mockImplementationOnce(() => { throw new Error('failed'); })
      .mockReturnValueOnce({ unref: mockUnref } as unknown as ReturnType<typeof spawn>);

    openDiffsInEditor('cursor', [
      { proposedPath: '/tmp/proposed/a.md' },
      { proposedPath: '/tmp/proposed/b.md' },
    ]);

    expect(spawn).toHaveBeenCalledTimes(2);
  });
});

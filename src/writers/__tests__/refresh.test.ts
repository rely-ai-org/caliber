import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');

import { writeRefreshDocs } from '../refresh.js';

describe('writeRefreshDocs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('writes CLAUDE.md directly', () => {
    const written = writeRefreshDocs({
      claudeMd: '# Project\n\nUpdated content.\n',
    });

    expect(written).toContain('CLAUDE.md');
    const content = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(content).toBe('# Project\n\nUpdated content.\n');
  });

  it('writes other doc types normally', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const written = writeRefreshDocs({
      readmeMd: '# README',
      cursorRules: [{ filename: 'test.mdc', content: 'rule content' }],
    });

    expect(written).toContain('README.md');
    expect(written).toContain('.cursor/rules/test.mdc');
  });

  it('returns empty array when no docs need updating', () => {
    const written = writeRefreshDocs({});
    expect(written).toEqual([]);
  });
});

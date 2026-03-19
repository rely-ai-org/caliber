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
    const rulePath = written.find(p => p.includes('test.mdc'));
    expect(rulePath).toBeDefined();
  });

  it('returns empty array when no docs need updating', () => {
    const written = writeRefreshDocs({});
    expect(written).toEqual([]);
  });

  it('writes copilot instructions when provided', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const written = writeRefreshDocs({
      copilotInstructions: '# Updated Copilot Instructions',
    });

    expect(written).toContain('.github/copilot-instructions.md');
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith('.github', { recursive: true });
  });

  it('writes copilot instruction files when provided', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const written = writeRefreshDocs({
      copilotInstructionFiles: [
        { filename: 'ts.instructions.md', content: '---\napplyTo: "**/*.ts"\n---\n\nUse strict.' },
      ],
    });

    const instrPath = written.find(p => p.includes('ts.instructions.md'));
    expect(instrPath).toBeDefined();
    expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalledWith(
      expect.stringContaining('instructions'),
      { recursive: true },
    );
  });

  it('skips copilot when null', () => {
    const written = writeRefreshDocs({
      copilotInstructions: null,
      copilotInstructionFiles: null,
    });
    expect(written).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeGithubCopilotConfig } from '../index.js';

describe('writeGithubCopilotConfig', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-writer-'));
    origCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes copilot-instructions.md to .github/', () => {
    const written = writeGithubCopilotConfig({
      instructions: '# Project\n\nBuild with `npm run build`.',
    });

    expect(written).toEqual(['.github/copilot-instructions.md']);
    expect(fs.readFileSync('.github/copilot-instructions.md', 'utf-8')).toBe(
      '# Project\n\nBuild with `npm run build`.',
    );
  });

  it('skips writing when instructions is empty', () => {
    const written = writeGithubCopilotConfig({ instructions: '' });

    expect(written).toEqual([]);
    expect(fs.existsSync('.github/copilot-instructions.md')).toBe(false);
  });

  it('writes instruction files to .github/instructions/', () => {
    const written = writeGithubCopilotConfig({
      instructions: '# Main instructions',
      instructionFiles: [
        {
          filename: 'typescript.instructions.md',
          content: '---\napplyTo: "**/*.ts,**/*.tsx"\n---\n\nUse strict TypeScript.',
        },
        {
          filename: 'testing.instructions.md',
          content: '---\napplyTo: "**/*.test.*"\n---\n\nUse vitest.',
        },
      ],
    });

    expect(written).toHaveLength(3);
    expect(written).toContain('.github/copilot-instructions.md');
    expect(written).toContain('.github/instructions/typescript.instructions.md');
    expect(written).toContain('.github/instructions/testing.instructions.md');

    const tsContent = fs.readFileSync('.github/instructions/typescript.instructions.md', 'utf-8');
    expect(tsContent).toContain('applyTo: "**/*.ts,**/*.tsx"');
  });

  it('does not clobber existing .github/ directory contents', () => {
    fs.mkdirSync('.github/workflows', { recursive: true });
    fs.writeFileSync('.github/workflows/ci.yml', 'name: CI');

    writeGithubCopilotConfig({
      instructions: '# Instructions',
    });

    expect(fs.readFileSync('.github/workflows/ci.yml', 'utf-8')).toBe('name: CI');
    expect(fs.existsSync('.github/copilot-instructions.md')).toBe(true);
  });

  it('writes only instruction files when instructions is empty', () => {
    const written = writeGithubCopilotConfig({
      instructions: '',
      instructionFiles: [
        { filename: 'style.instructions.md', content: '---\napplyTo: "**/*.css"\n---\n\nUse CSS modules.' },
      ],
    });

    expect(written).toEqual(['.github/instructions/style.instructions.md']);
    expect(fs.existsSync('.github/copilot-instructions.md')).toBe(false);
  });

  it('handles missing instructionFiles gracefully', () => {
    const written = writeGithubCopilotConfig({
      instructions: '# Just the main file',
    });

    expect(written).toEqual(['.github/copilot-instructions.md']);
    expect(fs.existsSync('.github/instructions')).toBe(false);
  });
});

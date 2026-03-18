import fs from 'fs';
import path from 'path';
import os from 'os';
import { isFirstRun, summarizeSetup, derivePermissions } from '../init-helpers.js';
import { detectAgents } from '../init-prompts.js';
import { formatProjectPreview, formatWhatChanged } from '../init-display.js';
import type { Fingerprint } from '../../fingerprint/index.js';

describe('isFirstRun', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caliber-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns true when .caliber/ does not exist', () => {
    expect(isFirstRun(tmpDir)).toBe(true);
  });

  it('returns false when .caliber/ directory exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.caliber'));
    expect(isFirstRun(tmpDir)).toBe(false);
  });

  it('returns true when .caliber is a file not a directory', () => {
    fs.writeFileSync(path.join(tmpDir, '.caliber'), 'not a dir');
    expect(isFirstRun(tmpDir)).toBe(true);
  });
});

describe('detectAgents', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caliber-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no agent dirs exist', () => {
    expect(detectAgents(tmpDir)).toEqual([]);
  });

  it('detects claude from .claude/ directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'));
    expect(detectAgents(tmpDir)).toEqual(['claude']);
  });

  it('detects cursor from .cursor/ directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'));
    expect(detectAgents(tmpDir)).toEqual(['cursor']);
  });

  it('detects codex from AGENTS.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Agents');
    expect(detectAgents(tmpDir)).toEqual(['codex']);
  });

  it('detects codex from .agents/ directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.agents'));
    expect(detectAgents(tmpDir)).toEqual(['codex']);
  });

  it('detects multiple agents', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'));
    fs.mkdirSync(path.join(tmpDir, '.cursor'));
    expect(detectAgents(tmpDir)).toEqual(['claude', 'cursor']);
  });
});

describe('formatProjectPreview', () => {
  it('formats a full fingerprint', () => {
    const fp = {
      languages: ['TypeScript', 'JavaScript'],
      frameworks: ['React', 'Vitest'],
      fileTree: new Array(847).fill('file.ts'),
    } as unknown as Fingerprint;

    const result = formatProjectPreview(fp);
    expect(result).toContain('TypeScript');
    expect(result).toContain('React');
    expect(result).toContain('847');
  });

  it('handles empty fingerprint', () => {
    const fp = {
      languages: [],
      frameworks: [],
      fileTree: [],
    } as unknown as Fingerprint;

    const result = formatProjectPreview(fp);
    expect(result).toContain('empty project');
  });

  it('handles languages only (no frameworks)', () => {
    const fp = {
      languages: ['Python'],
      frameworks: [],
      fileTree: new Array(100).fill('file.py'),
    } as unknown as Fingerprint;

    const result = formatProjectPreview(fp);
    expect(result).toContain('Python');
    expect(result).toContain('100');
  });
});

describe('formatWhatChanged', () => {
  it('shows created CLAUDE.md for new project', () => {
    const setup = {
      claude: { claudeMd: '# Test' },
    };

    const lines = formatWhatChanged(setup);
    expect(lines.some(l => l.includes('CLAUDE.md'))).toBe(true);
  });

  it('shows skills count', () => {
    const setup = {
      claude: {
        claudeMd: '# Test',
        skills: [
          { name: 'testing', content: '...' },
          { name: 'api-routes', content: '...' },
          { name: 'database', content: '...' },
        ],
      },
    };

    const lines = formatWhatChanged(setup);
    const skillLine = lines.find(l => l.includes('skill'));
    expect(skillLine).toContain('3');
    expect(skillLine).toContain('testing');
  });

  it('shows cursor rules', () => {
    const setup = {
      cursor: {
        rules: [
          { filename: 'code-style.mdc', content: '...' },
          { filename: 'imports.mdc', content: '...' },
        ],
      },
    };

    const lines = formatWhatChanged(setup);
    const ruleLine = lines.find(l => l.includes('cursor rule'));
    expect(ruleLine).toContain('2');
    expect(ruleLine).toContain('code-style');
  });

  it('shows deletions', () => {
    const setup = {
      deletions: [{ filePath: '.cursorrules' }],
    };

    const lines = formatWhatChanged(setup);
    expect(lines.some(l => l.includes('Removing'))).toBe(true);
  });

  it('returns empty array for empty setup', () => {
    expect(formatWhatChanged({})).toEqual([]);
  });

  it('truncates long skill lists', () => {
    const setup = {
      claude: {
        skills: Array.from({ length: 8 }, (_, i) => ({ name: `skill-${i}`, content: '...' })),
      },
    };

    const lines = formatWhatChanged(setup);
    const skillLine = lines.find(l => l.includes('skill'));
    expect(skillLine).toContain('+5 more');
  });
});

describe('summarizeSetup', () => {
  it('summarizes with file descriptions', () => {
    const setup = {
      fileDescriptions: {
        'CLAUDE.md': 'generated config',
        '.claude/skills/test/SKILL.md': 'testing skill',
      },
    };

    const result = summarizeSetup('Initial generation', setup);
    expect(result).toContain('Initial generation');
    expect(result).toContain('CLAUDE.md');
  });

  it('falls back to keys without descriptions', () => {
    const setup = { claude: {}, cursor: {}, targetAgent: ['claude'] };

    const result = summarizeSetup('Test', setup);
    expect(result).toContain('claude');
    expect(result).toContain('cursor');
    expect(result).not.toContain('targetAgent');
  });
});

describe('derivePermissions', () => {
  it('includes git for all projects', () => {
    const perms = derivePermissions({ languages: [], tools: [], fileTree: [] });
    expect(perms).toContain('Bash(git *)');
  });

  it('includes npm for TypeScript projects', () => {
    const perms = derivePermissions({ languages: ['TypeScript'], tools: [], fileTree: [] });
    expect(perms).toContain('Bash(npm run *)');
    expect(perms).toContain('Bash(npx *)');
  });

  it('includes python for Python projects', () => {
    const perms = derivePermissions({ languages: ['Python'], tools: [], fileTree: [] });
    expect(perms).toContain('Bash(python *)');
  });

  it('includes terraform from tools', () => {
    const perms = derivePermissions({ languages: [], tools: ['Terraform'], fileTree: [] });
    expect(perms).toContain('Bash(terraform *)');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { scanLocalState } from '../../scanner/index.js';

vi.mock('fs');
vi.mock('../../scanner/index.js', () => ({
  scanLocalState: vi.fn().mockReturnValue([]),
}));

type Platform = 'claude' | 'cursor' | 'codex';

// Replicate private helpers from recommend.ts for unit testing

function getSkillDir(platform: Platform): string {
  if (platform === 'cursor') return path.join(process.cwd(), '.cursor', 'skills');
  if (platform === 'codex') return path.join(process.cwd(), '.agents', 'skills');
  return path.join(process.cwd(), '.claude', 'skills');
}

function getInstalledSkills(platforms: Platform[]): Set<string> {
  const installed = new Set<string>();
  const dirs = platforms.map(getSkillDir);

  for (const dir of dirs) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          installed.add(entry.name.toLowerCase());
        }
      }
    } catch { /* dir doesn't exist */ }
  }

  return installed;
}

function getSkillPath(platform: Platform, slug: string): string {
  if (platform === 'cursor') return path.join('.cursor', 'skills', slug, 'SKILL.md');
  if (platform === 'codex') return path.join('.agents', 'skills', slug, 'SKILL.md');
  return path.join('.claude', 'skills', slug, 'SKILL.md');
}

function detectLocalPlatforms(): Platform[] {
  const items = scanLocalState(process.cwd());
  const platforms = new Set<Platform>();
  for (const item of items) {
    platforms.add(item.platform as Platform);
  }
  return platforms.size > 0 ? Array.from(platforms) : ['claude'];
}

describe('getSkillDir', () => {
  it('returns .claude/skills for claude', () => {
    expect(getSkillDir('claude')).toBe(path.join(process.cwd(), '.claude', 'skills'));
  });

  it('returns .cursor/skills for cursor', () => {
    expect(getSkillDir('cursor')).toBe(path.join(process.cwd(), '.cursor', 'skills'));
  });

  it('returns .agents/skills for codex', () => {
    expect(getSkillDir('codex')).toBe(path.join(process.cwd(), '.agents', 'skills'));
  });
});

describe('getSkillPath', () => {
  it('builds correct path per platform', () => {
    expect(getSkillPath('claude', 'my-skill')).toBe(path.join('.claude', 'skills', 'my-skill', 'SKILL.md'));
    expect(getSkillPath('cursor', 'my-skill')).toBe(path.join('.cursor', 'skills', 'my-skill', 'SKILL.md'));
    expect(getSkillPath('codex', 'my-skill')).toBe(path.join('.agents', 'skills', 'my-skill', 'SKILL.md'));
  });
});

describe('getInstalledSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only checks directories for the specified platforms', () => {
    const mockDirent = (name: string) => ({ name, isDirectory: () => true } as fs.Dirent);

    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const d = dir.toString();
      if (d.includes('.claude')) return [mockDirent('skill-a')] as unknown as fs.Dirent[];
      if (d.includes('.cursor')) return [mockDirent('skill-b')] as unknown as fs.Dirent[];
      if (d.includes('.agents')) return [mockDirent('skill-c')] as unknown as fs.Dirent[];
      return [] as unknown as fs.Dirent[];
    });

    const claudeOnly = getInstalledSkills(['claude']);
    expect(claudeOnly).toEqual(new Set(['skill-a']));
    expect(claudeOnly.has('skill-b')).toBe(false);
    expect(claudeOnly.has('skill-c')).toBe(false);
  });

  it('checks multiple platform directories when multiple are specified', () => {
    const mockDirent = (name: string) => ({ name, isDirectory: () => true } as fs.Dirent);

    vi.mocked(fs.readdirSync).mockImplementation((dir) => {
      const d = dir.toString();
      if (d.includes('.claude')) return [mockDirent('skill-a')] as unknown as fs.Dirent[];
      if (d.includes('.cursor')) return [mockDirent('skill-b')] as unknown as fs.Dirent[];
      return [] as unknown as fs.Dirent[];
    });

    const both = getInstalledSkills(['claude', 'cursor']);
    expect(both).toEqual(new Set(['skill-a', 'skill-b']));
  });

  it('handles missing directories gracefully', () => {
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = getInstalledSkills(['claude', 'cursor', 'codex']);
    expect(result).toEqual(new Set());
  });

  it('ignores non-directory entries', () => {
    const mockFile = { name: 'README.md', isDirectory: () => false } as fs.Dirent;
    const mockDir = { name: 'real-skill', isDirectory: () => true } as fs.Dirent;

    vi.mocked(fs.readdirSync).mockReturnValue([mockFile, mockDir] as unknown as fs.Dirent[]);

    const result = getInstalledSkills(['claude']);
    expect(result).toEqual(new Set(['real-skill']));
  });
});

describe('platform resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detectLocalPlatforms defaults to claude when no platforms found', () => {
    vi.mocked(scanLocalState).mockReturnValue([]);

    const platforms = detectLocalPlatforms();
    expect(platforms).toEqual(['claude']);
  });

  it('detectLocalPlatforms returns only detected platforms', () => {
    vi.mocked(scanLocalState).mockReturnValue([
      { platform: 'claude' },
      { platform: 'claude' },
      { platform: 'cursor' },
    ] as ReturnType<typeof scanLocalState>);

    const platforms = detectLocalPlatforms();
    expect(platforms).toContain('claude');
    expect(platforms).toContain('cursor');
    expect(platforms).not.toContain('codex');
  });

  it('targetPlatforms from state takes precedence over detection', () => {
    // This tests the resolution logic: targetPlatforms ?? detectLocalPlatforms()
    const targetPlatforms: Platform[] = ['claude'];

    vi.mocked(scanLocalState).mockReturnValue([
      { platform: 'claude' },
      { platform: 'cursor' },
      { platform: 'codex' },
    ] as ReturnType<typeof scanLocalState>);

    // When targetPlatforms is provided, it should be used directly
    const platforms = targetPlatforms ?? detectLocalPlatforms();
    expect(platforms).toEqual(['claude']);
  });

  it('falls back to detectLocalPlatforms when no targetPlatforms', () => {
    const targetPlatforms: Platform[] | undefined = undefined;

    vi.mocked(scanLocalState).mockReturnValue([
      { platform: 'cursor' },
    ] as ReturnType<typeof scanLocalState>);

    const platforms = targetPlatforms ?? detectLocalPlatforms();
    expect(platforms).toEqual(['cursor']);
  });
});

describe('skill installation scoping', () => {
  it('getSkillPath generates paths only for requested platforms', () => {
    const platforms: Platform[] = ['claude'];
    const slug = 'test-skill';

    const paths = platforms.map(p => getSkillPath(p, slug));
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain('.claude');
    expect(paths.some(p => p.includes('.cursor'))).toBe(false);
    expect(paths.some(p => p.includes('.agents'))).toBe(false);
  });

  it('generates paths for all specified platforms', () => {
    const platforms: Platform[] = ['claude', 'cursor', 'codex'];
    const slug = 'test-skill';

    const paths = platforms.map(p => getSkillPath(p, slug));
    expect(paths).toHaveLength(3);
    expect(paths[0]).toContain('.claude');
    expect(paths[1]).toContain('.cursor');
    expect(paths[2]).toContain('.agents');
  });
});

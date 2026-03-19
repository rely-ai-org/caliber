import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadSourcesConfig,
  writeSourcesConfig,
  resolveAllSources,
  formatSourcesForPrompt,
  computeSourceHashes,
  type SourceSummary,
} from '../sources.js';

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'caliber-sources-test-'));
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('loadSourcesConfig', () => {
  let dir: string;

  beforeEach(() => { dir = mkTempDir(); });
  afterEach(() => cleanup(dir));

  it('returns empty array when no config exists', () => {
    expect(loadSourcesConfig(dir)).toEqual([]);
  });

  it('loads valid sources.json', () => {
    fs.mkdirSync(path.join(dir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.caliber', 'sources.json'),
      JSON.stringify({
        sources: [
          { type: 'repo', path: '../sibling', role: 'shared-library' },
          { type: 'file', path: '../docs/guide.md', role: 'reference' },
        ],
      }),
    );
    const result = loadSourcesConfig(dir);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('repo');
    expect(result[1].type).toBe('file');
  });

  it('returns empty array for malformed JSON', () => {
    fs.mkdirSync(path.join(dir, '.caliber'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.caliber', 'sources.json'), 'not json');
    expect(loadSourcesConfig(dir)).toEqual([]);
  });

  it('returns empty array for missing sources array', () => {
    fs.mkdirSync(path.join(dir, '.caliber'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.caliber', 'sources.json'), '{"foo": 1}');
    expect(loadSourcesConfig(dir)).toEqual([]);
  });

  it('filters out entries without type or path', () => {
    fs.mkdirSync(path.join(dir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.caliber', 'sources.json'),
      JSON.stringify({
        sources: [
          { type: 'repo', path: '../valid' },
          { path: '../no-type' },
          { type: 'repo' },
        ],
      }),
    );
    expect(loadSourcesConfig(dir)).toHaveLength(1);
  });
});

describe('writeSourcesConfig', () => {
  let dir: string;

  beforeEach(() => { dir = mkTempDir(); });
  afterEach(() => cleanup(dir));

  it('creates .caliber dir and writes sources.json', () => {
    writeSourcesConfig(dir, [{ type: 'repo', path: '../sibling' }]);
    const content = JSON.parse(fs.readFileSync(path.join(dir, '.caliber', 'sources.json'), 'utf-8'));
    expect(content.sources).toHaveLength(1);
    expect(content.sources[0].path).toBe('../sibling');
  });
});

describe('resolveAllSources', () => {
  let projectDir: string;
  let siblingDir: string;
  let fileSource: string;

  beforeEach(() => {
    const base = mkTempDir();
    projectDir = path.join(base, 'project');
    siblingDir = path.join(base, 'sibling');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(path.join(siblingDir, 'package.json'), '{"name": "@org/sibling"}');
    fileSource = path.join(base, 'docs.md');
    fs.writeFileSync(fileSource, '# Org Docs\nSome standards');
  });

  afterEach(() => {
    cleanup(path.dirname(projectDir));
  });

  it('resolves CLI sources', () => {
    const relativeSibling = path.relative(projectDir, siblingDir);
    const result = resolveAllSources(projectDir, [relativeSibling], []);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('@org/sibling');
    expect(result[0].origin).toBe('cli');
  });

  it('resolves file sources from CLI', () => {
    const relativeFile = path.relative(projectDir, fileSource);
    const result = resolveAllSources(projectDir, [relativeFile], []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('file');
    expect(result[0].name).toBe('docs.md');
  });

  it('resolves config sources', () => {
    const relativeSibling = path.relative(projectDir, siblingDir);
    fs.mkdirSync(path.join(projectDir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.caliber', 'sources.json'),
      JSON.stringify({ sources: [{ type: 'repo', path: relativeSibling, role: 'shared-lib' }] }),
    );
    const result = resolveAllSources(projectDir, [], []);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('shared-lib');
    expect(result[0].origin).toBe('config');
  });

  it('resolves workspace sources within project root', () => {
    const wsDir = path.join(projectDir, 'packages', 'shared');
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, 'package.json'), '{"name": "@org/shared"}');
    const result = resolveAllSources(projectDir, [], ['packages/shared']);
    expect(result).toHaveLength(1);
    expect(result[0].origin).toBe('workspace');
    expect(result[0].name).toBe('@org/shared');
  });

  it('filters workspace sources outside project root', () => {
    const result = resolveAllSources(projectDir, [], ['../../outside']);
    expect(result).toHaveLength(0);
  });

  it('deduplicates by absolute path', () => {
    const relativeSibling = path.relative(projectDir, siblingDir);
    fs.mkdirSync(path.join(projectDir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.caliber', 'sources.json'),
      JSON.stringify({ sources: [{ type: 'repo', path: relativeSibling }] }),
    );
    const result = resolveAllSources(projectDir, [relativeSibling], []);
    expect(result).toHaveLength(1);
    expect(result[0].origin).toBe('cli'); // CLI wins priority
  });

  it('skips non-existent sources with warning', () => {
    const result = resolveAllSources(projectDir, ['../nonexistent'], []);
    expect(result).toHaveLength(0);
  });

  it('caps at MAX_SOURCES_IN_PROMPT (5)', () => {
    const base = path.dirname(projectDir);
    for (let i = 0; i < 8; i++) {
      const d = path.join(base, `repo-${i}`);
      fs.mkdirSync(d, { recursive: true });
    }
    const paths = Array.from({ length: 8 }, (_, i) => `../repo-${i}`);
    const result = resolveAllSources(projectDir, paths, []);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('reads published summary.json when present', () => {
    fs.mkdirSync(path.join(siblingDir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(siblingDir, '.caliber', 'summary.json'),
      JSON.stringify({ name: '@org/published', description: 'Published lib', topLevelDirs: ['src'] }),
    );
    const relativeSibling = path.relative(projectDir, siblingDir);
    const result = resolveAllSources(projectDir, [relativeSibling], []);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('@org/published');
    expect(result[0].topLevelDirs).toEqual(['src']);
  });
});

describe('formatSourcesForPrompt', () => {
  it('returns empty string for no sources', () => {
    expect(formatSourcesForPrompt([])).toBe('');
  });

  it('formats sources with delimiter sections', () => {
    const sources: SourceSummary[] = [
      {
        name: '@org/shared',
        type: 'repo',
        role: 'shared-library',
        description: 'Shared component library',
        origin: 'config',
        topLevelDirs: ['src', 'tests'],
      },
    ];
    const result = formatSourcesForPrompt(sources);
    expect(result).toContain('--- Related Sources ---');
    expect(result).toContain('--- End Related Sources ---');
    expect(result).toContain('[@org/shared]');
    expect(result).toContain('shared-library');
    expect(result).toContain('Key dirs: src, tests');
  });
});

describe('computeSourceHashes', () => {
  it('produces deterministic hashes', () => {
    const sources: SourceSummary[] = [
      { name: 'test', type: 'repo', role: 'lib', description: '', origin: 'config' },
    ];
    const h1 = computeSourceHashes(sources);
    const h2 = computeSourceHashes(sources);
    expect(h1).toEqual(h2);
  });

  it('produces different hashes for different sources', () => {
    const s1: SourceSummary[] = [
      { name: 'a', type: 'repo', role: 'lib', description: '', origin: 'config' },
    ];
    const s2: SourceSummary[] = [
      { name: 'b', type: 'repo', role: 'lib', description: '', origin: 'config' },
    ];
    expect(computeSourceHashes(s1).a).not.toBe(computeSourceHashes(s2).b);
  });
});

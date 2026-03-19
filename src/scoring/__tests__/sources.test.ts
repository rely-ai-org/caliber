import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { checkSources } from '../checks/sources.js';

function mkTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'caliber-score-sources-'));
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('checkSources', () => {
  let dir: string;

  beforeEach(() => { dir = mkTempDir(); });
  afterEach(() => cleanup(dir));

  it('returns sources_configured with maxPoints 0 when no sources exist', () => {
    const checks = checkSources(dir);
    const configured = checks.find(c => c.id === 'sources_configured');
    expect(configured).toBeDefined();
    expect(configured!.maxPoints).toBe(0);
    expect(configured!.earnedPoints).toBe(0);
    expect(configured!.passed).toBe(false);
  });

  it('does not include sources_referenced when no sources configured', () => {
    const checks = checkSources(dir);
    const referenced = checks.find(c => c.id === 'sources_referenced');
    expect(referenced).toBeUndefined();
  });

  it('passes sources_configured when sources.json exists', () => {
    fs.mkdirSync(path.join(dir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.caliber', 'sources.json'),
      JSON.stringify({ sources: [{ type: 'repo', path: '../sibling' }] }),
    );
    const checks = checkSources(dir);
    const configured = checks.find(c => c.id === 'sources_configured');
    expect(configured!.passed).toBe(true);
    expect(configured!.maxPoints).toBe(3);
    expect(configured!.earnedPoints).toBe(3);
  });

  it('checks sources_referenced when sources are configured', () => {
    fs.mkdirSync(path.join(dir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.caliber', 'sources.json'),
      JSON.stringify({ sources: [{ type: 'repo', path: '../shared-components' }] }),
    );
    // No CLAUDE.md yet — should fail
    const checks = checkSources(dir);
    const referenced = checks.find(c => c.id === 'sources_referenced');
    expect(referenced).toBeDefined();
    expect(referenced!.passed).toBe(false);
  });

  it('passes sources_referenced when CLAUDE.md mentions the source', () => {
    fs.mkdirSync(path.join(dir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.caliber', 'sources.json'),
      JSON.stringify({ sources: [{ type: 'repo', path: '../shared-components' }] }),
    );
    fs.writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      '# Project\n\nThis project uses the shared-components library for UI.\n',
    );
    const checks = checkSources(dir);
    const referenced = checks.find(c => c.id === 'sources_referenced');
    expect(referenced!.passed).toBe(true);
    expect(referenced!.earnedPoints).toBe(3);
  });

  it('fails sources_referenced when CLAUDE.md does not mention the source', () => {
    fs.mkdirSync(path.join(dir, '.caliber'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.caliber', 'sources.json'),
      JSON.stringify({ sources: [{ type: 'repo', path: '../shared-components' }] }),
    );
    fs.writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      '# Project\n\nA totally unrelated description.\n',
    );
    const checks = checkSources(dir);
    const referenced = checks.find(c => c.id === 'sources_referenced');
    expect(referenced!.passed).toBe(false);
  });
});

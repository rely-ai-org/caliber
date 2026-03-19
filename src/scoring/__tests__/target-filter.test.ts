import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeLocalScore, detectTargetAgent } from '../index.js';

describe('detectTargetAgent', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'caliber-detect-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [claude] when only CLAUDE.md exists', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Config');
    expect(detectTargetAgent(dir)).toEqual(['claude']);
  });

  it('returns [cursor] when only .cursorrules exists', () => {
    writeFileSync(join(dir, '.cursorrules'), 'rules');
    expect(detectTargetAgent(dir)).toEqual(['cursor']);
  });

  it('returns [claude, cursor] when CLAUDE.md and .cursorrules exist', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Config');
    writeFileSync(join(dir, '.cursorrules'), 'rules');
    expect(detectTargetAgent(dir)).toEqual(['claude', 'cursor']);
  });

  it('returns [claude, cursor] when .claude/skills and .cursor/rules exist', () => {
    mkdirSync(join(dir, '.claude', 'skills'), { recursive: true });
    mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
    expect(detectTargetAgent(dir)).toEqual(['claude', 'cursor']);
  });

  it('defaults to [claude] when no config files found', () => {
    expect(detectTargetAgent(dir)).toEqual(['claude']);
  });

  it('returns [codex] when only .codex exists', () => {
    mkdirSync(join(dir, '.codex'), { recursive: true });
    expect(detectTargetAgent(dir)).toEqual(['codex']);
  });

  it('returns [github-copilot] when only .github/copilot-instructions.md exists', () => {
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '# Instructions');
    expect(detectTargetAgent(dir)).toEqual(['github-copilot']);
  });

  it('returns [claude, github-copilot] when CLAUDE.md and copilot-instructions.md exist', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Config');
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '# Instructions');
    expect(detectTargetAgent(dir)).toEqual(['claude', 'github-copilot']);
  });

  it('returns [claude, codex] when CLAUDE.md and .codex exist', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Config');
    mkdirSync(join(dir, '.codex'), { recursive: true });
    expect(detectTargetAgent(dir)).toEqual(['claude', 'codex']);
  });

  it('returns all three when all config types exist', () => {
    writeFileSync(join(dir, 'CLAUDE.md'), '# Config');
    writeFileSync(join(dir, '.cursorrules'), 'rules');
    mkdirSync(join(dir, '.codex'), { recursive: true });
    expect(detectTargetAgent(dir)).toEqual(['claude', 'cursor', 'codex']);
  });
});

describe('computeLocalScore target filtering', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'caliber-score-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('excludes cursor-only checks when target is [claude]', () => {
    const result = computeLocalScore(dir, ['claude']);
    const checkIds = result.checks.map((c) => c.id);

    expect(checkIds).not.toContain('cursor_rules_exist');
    expect(checkIds).not.toContain('cursor_mdc_rules');
    expect(checkIds).not.toContain('cross_platform_parity');
    expect(checkIds).not.toContain('no_duplicate_content');
  });

  it('excludes claude-only checks when target is [cursor]', () => {
    const result = computeLocalScore(dir, ['cursor']);
    const checkIds = result.checks.map((c) => c.id);

    expect(checkIds).not.toContain('claude_md_exists');
    expect(checkIds).not.toContain('claude_md_freshness');
    expect(checkIds).not.toContain('cross_platform_parity');
    expect(checkIds).not.toContain('no_duplicate_content');
  });

  it('includes all checks when target is [claude, cursor]', () => {
    const result = computeLocalScore(dir, ['claude', 'cursor']);
    const checkIds = result.checks.map((c) => c.id);

    expect(checkIds).toContain('claude_md_exists');
    expect(checkIds).toContain('cursor_rules_exist');
    expect(checkIds).toContain('cross_platform_parity');
  });

  it('normalizes score to 0-100 range', () => {
    const result = computeLocalScore(dir, ['claude']);

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.maxScore).toBe(100);
  });

  it('includes targetAgent in result', () => {
    const result = computeLocalScore(dir, ['cursor']);
    expect(result.targetAgent).toEqual(['cursor']);
  });

  it('includes grade in result', () => {
    const result = computeLocalScore(dir, ['claude']);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
  });

  it('includes category summaries', () => {
    const result = computeLocalScore(dir, ['claude', 'cursor']);

    expect(result.categories.existence).toBeDefined();
    expect(result.categories.quality).toBeDefined();
    expect(result.categories.grounding).toBeDefined();
    expect(result.categories.accuracy).toBeDefined();
    expect(result.categories.freshness).toBeDefined();
    expect(result.categories.bonus).toBeDefined();
  });

  it('scores higher when CLAUDE.md exists for claude target', () => {
    const before = computeLocalScore(dir, ['claude']);
    writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n\n## Commands\n\n```bash\nnpm run build\nnpm test\n```\n');
    const after = computeLocalScore(dir, ['claude']);

    expect(after.score).toBeGreaterThan(before.score);
  });

  it('scores higher when .cursorrules exists for cursor target', () => {
    const before = computeLocalScore(dir, ['cursor']);
    writeFileSync(join(dir, '.cursorrules'), 'Use TypeScript strict mode.\nRun npm test before committing.\n');
    const after = computeLocalScore(dir, ['cursor']);

    expect(after.score).toBeGreaterThan(before.score);
  });

  it('excludes claude and cursor checks when target is [codex]', () => {
    const result = computeLocalScore(dir, ['codex']);
    const checkIds = result.checks.map((c) => c.id);

    expect(checkIds).not.toContain('claude_md_exists');
    expect(checkIds).not.toContain('claude_md_freshness');
    expect(checkIds).not.toContain('cursor_rules_exist');
    expect(checkIds).not.toContain('cursor_mdc_rules');
    expect(checkIds).not.toContain('cross_platform_parity');
    expect(checkIds).not.toContain('no_duplicate_content');
    expect(checkIds).toContain('codex_agents_md_exists');
  });

  it('excludes codex checks when target is [claude]', () => {
    const result = computeLocalScore(dir, ['claude']);
    const checkIds = result.checks.map((c) => c.id);

    expect(checkIds).not.toContain('codex_agents_md_exists');
    expect(checkIds).toContain('claude_md_exists');
  });

  it('scores higher when AGENTS.md exists for codex target', () => {
    const before = computeLocalScore(dir, ['codex']);
    writeFileSync(join(dir, 'AGENTS.md'), '# Project\n\n## Commands\n\n```bash\nnpm run build\nnpm test\n```\n');
    const after = computeLocalScore(dir, ['codex']);

    expect(after.score).toBeGreaterThan(before.score);
  });

  it('includes claude and codex checks when target is [claude, codex]', () => {
    const result = computeLocalScore(dir, ['claude', 'codex']);
    const checkIds = result.checks.map((c) => c.id);

    expect(checkIds).toContain('claude_md_exists');
    expect(checkIds).toContain('codex_agents_md_exists');
    expect(checkIds).not.toContain('cursor_rules_exist');
    expect(checkIds).not.toContain('cross_platform_parity');
  });

  it('excludes copilot checks when target is [claude]', () => {
    const result = computeLocalScore(dir, ['claude']);
    const checkIds = result.checks.map((c) => c.id);

    expect(checkIds).not.toContain('copilot_instructions_exists');
  });

  it('includes copilot checks when target is [github-copilot]', () => {
    const result = computeLocalScore(dir, ['github-copilot']);
    const checkIds = result.checks.map((c) => c.id);

    expect(checkIds).toContain('copilot_instructions_exists');
    expect(checkIds).not.toContain('claude_md_exists');
    expect(checkIds).not.toContain('cursor_rules_exist');
    expect(checkIds).not.toContain('codex_agents_md_exists');
  });

  it('scores higher when copilot-instructions.md exists for github-copilot target', () => {
    const before = computeLocalScore(dir, ['github-copilot']);
    mkdirSync(join(dir, '.github'), { recursive: true });
    writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '# Project\n\n## Commands\n\n```bash\nnpm run build\nnpm test\n```\n');
    const after = computeLocalScore(dir, ['github-copilot']);

    expect(after.score).toBeGreaterThan(before.score);
  });
});

import { existsSync } from 'fs';
import { join } from 'path';
import { checkExistence } from './checks/existence.js';
import { checkQuality } from './checks/quality.js';
import { checkGrounding } from './checks/grounding.js';
import { checkAccuracy } from './checks/accuracy.js';
import { checkFreshness } from './checks/freshness.js';
import { checkBonus } from './checks/bonus.js';
import { checkSources } from './checks/sources.js';
import { computeGrade, CURSOR_ONLY_CHECKS, CLAUDE_ONLY_CHECKS, CODEX_ONLY_CHECKS, COPILOT_ONLY_CHECKS, BOTH_ONLY_CHECKS, NON_CODEX_CHECKS } from './constants.js';
import { getDismissedIds } from './dismissed.js';

export type TargetAgent = ('claude' | 'cursor' | 'codex' | 'github-copilot')[];
export type CheckCategory = 'existence' | 'quality' | 'grounding' | 'accuracy' | 'freshness' | 'bonus';

export interface CheckFix {
  readonly action: string;
  readonly data: Record<string, unknown>;
  readonly instruction: string;
}

export interface Check {
  readonly id: string;
  readonly name: string;
  readonly category: CheckCategory;
  readonly maxPoints: number;
  readonly earnedPoints: number;
  readonly passed: boolean;
  readonly detail: string;
  readonly suggestion?: string;
  readonly fix?: CheckFix;
}

export interface CategorySummary {
  readonly earned: number;
  readonly max: number;
}

export interface ScoreResult {
  readonly score: number;
  readonly maxScore: number;
  readonly grade: string;
  readonly checks: readonly Check[];
  readonly categories: {
    readonly existence: CategorySummary;
    readonly quality: CategorySummary;
    readonly grounding: CategorySummary;
    readonly accuracy: CategorySummary;
    readonly freshness: CategorySummary;
    readonly bonus: CategorySummary;
  };
  readonly targetAgent: TargetAgent;
  readonly timestamp: string;
}

function sumCategory(checks: readonly Check[], category: CheckCategory): CategorySummary {
  const categoryChecks = checks.filter((c) => c.category === category);
  return {
    earned: categoryChecks.reduce((s, c) => s + c.earnedPoints, 0),
    max: categoryChecks.reduce((s, c) => s + c.maxPoints, 0),
  };
}

function filterChecksForTarget(checks: Check[], target: TargetAgent): Check[] {
  return checks.filter((c) => {
    if (CLAUDE_ONLY_CHECKS.has(c.id)) return target.includes('claude');
    if (CURSOR_ONLY_CHECKS.has(c.id)) return target.includes('cursor');
    if (CODEX_ONLY_CHECKS.has(c.id)) return target.includes('codex');
    if (COPILOT_ONLY_CHECKS.has(c.id)) return target.includes('github-copilot');
    if (BOTH_ONLY_CHECKS.has(c.id)) return target.includes('claude') && target.includes('cursor');
    if (NON_CODEX_CHECKS.has(c.id)) return !target.includes('codex');
    return true;
  });
}

/** Auto-detect target agent from existing config files on disk. */
export function detectTargetAgent(dir: string): TargetAgent {
  const agents: ('claude' | 'cursor' | 'codex' | 'github-copilot')[] = [];

  if (existsSync(join(dir, 'CLAUDE.md')) || existsSync(join(dir, '.claude', 'skills'))) agents.push('claude');
  if (existsSync(join(dir, '.cursorrules')) || existsSync(join(dir, '.cursor', 'rules'))) agents.push('cursor');
  if (existsSync(join(dir, '.codex')) || existsSync(join(dir, '.agents', 'skills'))) agents.push('codex');
  if (existsSync(join(dir, '.github', 'copilot-instructions.md'))) agents.push('github-copilot');

  return agents.length > 0 ? agents : ['claude'];
}

/**
 * Compute a fully deterministic local score for the agent config in `dir`.
 * No network calls, no LLM — pure filesystem checks.
 *
 * When `targetAgent` is provided, only checks relevant to that platform
 * are included and the score is normalized to 0-100.
 */
export function computeLocalScore(dir: string, targetAgent?: TargetAgent): ScoreResult {
  const target = targetAgent ?? detectTargetAgent(dir);

  const allChecks: Check[] = [
    ...checkExistence(dir),
    ...checkQuality(dir),
    ...checkGrounding(dir),
    ...checkAccuracy(dir),
    ...checkFreshness(dir),
    ...checkBonus(dir),
    ...checkSources(dir),
  ];

  const dismissed = getDismissedIds();
  const checks = filterChecksForTarget(allChecks, target)
    .filter(c => !dismissed.has(c.id));
  const maxPossible = checks.reduce((s, c) => s + c.maxPoints, 0);
  const earned = checks.reduce((s, c) => s + c.earnedPoints, 0);

  const score = maxPossible > 0
    ? Math.min(100, Math.max(0, Math.round((earned / maxPossible) * 100)))
    : 0;

  return {
    score,
    maxScore: 100,
    grade: computeGrade(score),
    checks,
    categories: {
      existence: sumCategory(checks, 'existence'),
      quality: sumCategory(checks, 'quality'),
      grounding: sumCategory(checks, 'grounding'),
      accuracy: sumCategory(checks, 'accuracy'),
      freshness: sumCategory(checks, 'freshness'),
      bonus: sumCategory(checks, 'bonus'),
    },
    targetAgent: target,
    timestamp: new Date().toISOString(),
  };
}

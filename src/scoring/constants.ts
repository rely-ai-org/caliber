/**
 * Scoring constants — universal, tech-stack-agnostic weights and thresholds.
 *
 * Every check measures the relationship between the config and the project,
 * or structural properties of the config itself. Nothing is specific to any
 * language, framework, or package manager.
 */

// ── Category maximums ──────────────────────────────────────────────────
export const CATEGORY_MAX = {
  existence: 25,
  quality: 25,
  grounding: 20,
  accuracy: 15,
  freshness: 10,
  bonus: 7,
} as const;

// ── Existence checks (25 pts) ─────────────────────────────────────────
export const POINTS_CLAUDE_MD_EXISTS = 6;
export const POINTS_CURSOR_RULES_EXIST = 3;
export const POINTS_SKILLS_EXIST = 6;
export const POINTS_SKILLS_BONUS_PER_EXTRA = 1;
export const POINTS_SKILLS_BONUS_CAP = 2;
export const POINTS_CURSOR_MDC_RULES = 3;
export const POINTS_MCP_SERVERS = 3;
export const POINTS_CROSS_PLATFORM_PARITY = 2;

// ── Quality checks (25 pts) ──────────────────────────────────────────
/** Does the config have code blocks with executable content? */
export const POINTS_EXECUTABLE_CONTENT = 8;
/** Is total config size within a reasonable token budget? */
export const POINTS_CONCISE_CONFIG = 6;
/** Are instructions concrete (referencing specific things) vs abstract prose? */
export const POINTS_CONCRETENESS = 4;
/** No large directory tree listings? */
export const POINTS_NO_DIR_TREE = 3;
/** No duplicate content across config files? */
export const POINTS_NO_DUPLICATES = 2;
/** Does the config have structured markdown (headings, sections)? */
export const POINTS_HAS_STRUCTURE = 2;

// ── Grounding checks (20 pts) ────────────────────────────────────────
/** Does the config reference the project's actual directories and files? */
export const POINTS_PROJECT_GROUNDING = 12;
/** How many specific references (backticks, paths) does the config have? */
export const POINTS_REFERENCE_DENSITY = 8;

// ── Accuracy checks (15 pts) ─────────────────────────────────────────
/** Do referenced paths in config actually exist on disk? */
export const POINTS_REFERENCES_VALID = 8;
/** Has the code changed without a corresponding config update? (git-based) */
export const POINTS_CONFIG_DRIFT = 7;

// ── Freshness & safety checks (10 pts) ───────────────────────────────
export const POINTS_FRESHNESS = 4;
export const POINTS_NO_SECRETS = 4;
export const POINTS_PERMISSIONS = 2;

// ── Bonus checks (5 pts + conditional source pts) ───────────────────
export const POINTS_HOOKS = 2;
export const POINTS_AGENTS_MD = 1;
export const POINTS_OPEN_SKILLS_FORMAT = 2;
export const POINTS_LEARNED_CONTENT = 2;

// ── Source checks (conditional — only counted when sources are configured) ──
export const POINTS_SOURCES_CONFIGURED = 3;
export const POINTS_SOURCES_REFERENCED = 3;

// ── Thresholds ─────────────────────────────────────────────────────────

/** Token budget thresholds for total config size (all files combined). */
export const TOKEN_BUDGET_THRESHOLDS = [
  { maxTokens: 2000, points: 6 },
  { maxTokens: 3500, points: 5 },
  { maxTokens: 5000, points: 4 },
  { maxTokens: 8000, points: 2 },
  { maxTokens: 12000, points: 1 },
] as const;

/** Code block count thresholds for executable content (graduated). */
export const CODE_BLOCK_THRESHOLDS = [
  { minBlocks: 3, points: 8 },
  { minBlocks: 2, points: 6 },
  { minBlocks: 1, points: 3 },
] as const;

/** Freshness thresholds based on git commits since last config update. */
export const FRESHNESS_COMMIT_THRESHOLDS = [
  { maxCommits: 5, points: 4 },
  { maxCommits: 15, points: 3 },
  { maxCommits: 30, points: 2 },
  { maxCommits: 60, points: 1 },
] as const;

/** Concreteness ratio thresholds. */
export const CONCRETENESS_THRESHOLDS = [
  { minRatio: 0.7, points: 4 },
  { minRatio: 0.5, points: 3 },
  { minRatio: 0.3, points: 2 },
  { minRatio: 0.15, points: 1 },
] as const;

/** Grounding coverage thresholds. */
export const GROUNDING_THRESHOLDS = [
  { minRatio: 0.5, points: 12 },
  { minRatio: 0.35, points: 9 },
  { minRatio: 0.2, points: 6 },
  { minRatio: 0.1, points: 3 },
] as const;

/** Patterns that indicate secret/credential leaks. */
export const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /AKIA[A-Z0-9]{16}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /ghu_[a-zA-Z0-9]{36}/,
  /glpat-[a-zA-Z0-9\-_]{20,}/,
  /xox[bpors]-[a-zA-Z0-9\-]{10,}/,
  /(?:password|secret|token|api_key)\s*[:=]\s*["'][^"']{8,}["']/i,
] as const;

/** Patterns that indicate placeholder values (not real secrets). */
export const SECRET_PLACEHOLDER_PATTERNS = [
  /your[_-]/i,
  /xxx/i,
  /example/i,
  /placeholder/i,
  /TODO/i,
  /CHANGE[_-]?ME/i,
  /<[^>]+>/,
] as const;

// ── Platform-specific check IDs ───────────────────────────────────────
export const CURSOR_ONLY_CHECKS = new Set([
  'cursor_rules_exist',
  'cursor_mdc_rules',
]);

export const CLAUDE_ONLY_CHECKS = new Set([
  'claude_md_exists',
  'claude_md_freshness',
]);

export const BOTH_ONLY_CHECKS = new Set([
  'cross_platform_parity',
  'no_duplicate_content',
]);

export const CODEX_ONLY_CHECKS = new Set([
  'codex_agents_md_exists',
]);

export const COPILOT_ONLY_CHECKS = new Set([
  'copilot_instructions_exists',
]);

/** Checks that should NOT appear for codex targets (avoid double-counting). */
export const NON_CODEX_CHECKS = new Set([
  'agents_md_exists',
]);

// ── Grading ────────────────────────────────────────────────────────────
export const GRADE_THRESHOLDS = [
  { minScore: 85, grade: 'A' },
  { minScore: 70, grade: 'B' },
  { minScore: 55, grade: 'C' },
  { minScore: 40, grade: 'D' },
  { minScore: 0, grade: 'F' },
] as const;

export function computeGrade(score: number): string {
  for (const { minScore, grade } of GRADE_THRESHOLDS) {
    if (score >= minScore) return grade;
  }
  return 'F';
}

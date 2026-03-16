import chalk from 'chalk';
import ora from 'ora';
import select from '@inquirer/select';
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { collectFingerprint, Fingerprint } from '../fingerprint/index.js';
import { scanLocalState } from '../scanner/index.js';
import { llmJsonCall } from '../llm/index.js';
import { loadConfig, getFastModel } from '../llm/config.js';
import { trackSkillsInstalled } from '../telemetry/events.js';
import { readState } from '../lib/state.js';

type Platform = 'claude' | 'cursor' | 'codex';

interface SkillResult {
  name: string;
  slug: string;
  source_url: string;
  score: number;
  reason: string;
  detected_technology: string;
  item_type?: string;
}

interface ScoredCandidate {
  index: number;
  score: number;
  reason: string;
}

function detectLocalPlatforms(): Platform[] {
  const items = scanLocalState(process.cwd());
  const platforms = new Set<Platform>();
  for (const item of items) {
    platforms.add(item.platform);
  }
  return platforms.size > 0 ? Array.from(platforms) : ['claude'];
}

function getSkillPath(platform: Platform, slug: string): string {
  if (platform === 'cursor') {
    return join('.cursor', 'skills', slug, 'SKILL.md');
  }
  if (platform === 'codex') {
    return join('.agents', 'skills', slug, 'SKILL.md');
  }
  return join('.claude', 'skills', slug, 'SKILL.md');
}

function getSkillDir(platform: Platform): string {
  if (platform === 'cursor') return join(process.cwd(), '.cursor', 'skills');
  if (platform === 'codex') return join(process.cwd(), '.agents', 'skills');
  return join(process.cwd(), '.claude', 'skills');
}

function getInstalledSkills(platforms: Platform[]): Set<string> {
  const installed = new Set<string>();
  const dirs = platforms.map(getSkillDir);

  for (const dir of dirs) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          installed.add(entry.name.toLowerCase());
        }
      }
    } catch { /* dir doesn't exist */ }
  }

  return installed;
}

// --- Search providers ---

async function searchSkillsSh(technologies: string[]): Promise<SkillResult[]> {
  // Track best result per skillId (prefer highest installs)
  const bestBySlug = new Map<string, SkillResult & { installs: number }>();

  for (const tech of technologies) {
    try {
      const resp = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(tech)}&limit=10`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) continue;
      const data = await resp.json() as {
        skills?: Array<{ skillId: string; name: string; source: string; installs?: number; description?: string }>;
      };
      if (!data.skills?.length) continue;

      for (const skill of data.skills) {
        const existing = bestBySlug.get(skill.skillId);
        if (existing && existing.installs >= (skill.installs ?? 0)) continue;

        bestBySlug.set(skill.skillId, {
          name: skill.name,
          slug: skill.skillId,
          source_url: skill.source ? `https://github.com/${skill.source}` : '',
          score: 0,
          reason: skill.description || '',
          detected_technology: tech,
          item_type: 'skill',
          installs: skill.installs ?? 0,
        });
      }
    } catch {
      continue;
    }
  }

  return Array.from(bestBySlug.values());
}

const AWESOME_CLAUDE_CODE_URL = 'https://raw.githubusercontent.com/hesreallyhim/awesome-claude-code/main/README.md';

async function searchAwesomeClaudeCode(technologies: string[]): Promise<SkillResult[]> {
  try {
    const resp = await fetch(AWESOME_CLAUDE_CODE_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const markdown = await resp.text();

    const items: SkillResult[] = [];
    const itemPattern = /^[-*]\s+\[([^\]]+)\]\(([^)]+)\)(?:\s+by\s+\[[^\]]*\]\([^)]*\))?\s*[-–—:]\s*(.*)/gm;
    let match: RegExpExecArray | null;

    while ((match = itemPattern.exec(markdown)) !== null) {
      const [, name, url, description] = match;
      if (url.startsWith('#')) continue;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      items.push({
        name: name.trim(),
        slug,
        source_url: url.trim(),
        score: 0,
        reason: description.trim().slice(0, 150),
        detected_technology: 'claude-code',
        item_type: 'skill',
      });
    }

    const techLower = technologies.map(t => t.toLowerCase());
    return items.filter(item => {
      const text = `${item.name} ${item.reason}`.toLowerCase();
      return techLower.some(t => text.includes(t));
    });
  } catch {
    return [];
  }
}

async function searchAllProviders(technologies: string[], platform?: string): Promise<SkillResult[]> {
  const searches: Promise<SkillResult[]>[] = [
    searchSkillsSh(technologies),
  ];

  if (platform === 'claude' || !platform) {
    searches.push(searchAwesomeClaudeCode(technologies));
  }

  const results = await Promise.all(searches);

  const seen = new Set<string>();
  const combined: SkillResult[] = [];
  for (const batch of results) {
    for (const result of batch) {
      // Normalize for dedup: strip hyphens/underscores so "zod-4" and "zod4" merge
      const key = result.name.toLowerCase().replace(/[-_]/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(result);
    }
  }
  return combined;
}

// --- LLM scoring ---

async function scoreWithLLM(
  candidates: SkillResult[],
  projectContext: string,
  technologies: string[],
): Promise<SkillResult[]> {
  const candidateList = candidates
    .map((c, i) => `${i}. "${c.name}" — ${c.reason || 'no description'}`)
    .join('\n');

  const fastModel = getFastModel();
  const scored = await llmJsonCall<ScoredCandidate[]>({
    system: `You evaluate whether AI agent skills and tools are relevant to a specific software project.
Given a project context and a list of candidates, score each one's relevance from 0-100 and provide a brief reason (max 80 chars).

Return a JSON array where each element has:
- "index": the candidate's index number
- "score": relevance score 0-100
- "reason": one-liner explaining why it fits or doesn't

Scoring guidelines:
- 90-100: Directly matches a core technology or workflow in the project
- 70-89: Relevant to the project's stack, patterns, or development workflow
- 50-69: Tangentially related or generic but useful
- 0-49: Not relevant to this project

Be selective. Prefer specific, high-quality matches over generic ones.
A skill for "React testing" is only relevant if the project uses React.
A generic "TypeScript best practices" skill is less valuable than one targeting the project's actual framework.
Return ONLY the JSON array.`,
    prompt: `PROJECT CONTEXT:\n${projectContext}\n\nDETECTED TECHNOLOGIES:\n${technologies.join(', ')}\n\nCANDIDATES:\n${candidateList}`,
    maxTokens: 8000,
    ...(fastModel ? { model: fastModel } : {}),
  });

  if (!Array.isArray(scored)) return [];

  return scored
    .filter(s => s.score >= 60 && s.index >= 0 && s.index < candidates.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(s => ({
      ...candidates[s.index],
      score: s.score,
      reason: s.reason || candidates[s.index].reason,
    }));
}

function buildProjectContext(fingerprint: Fingerprint, platforms: Platform[]): string {
  const parts: string[] = [];

  if (fingerprint.packageName) parts.push(`Package: ${fingerprint.packageName}`);
  if (fingerprint.languages.length > 0) parts.push(`Languages: ${fingerprint.languages.join(', ')}`);
  if (fingerprint.frameworks.length > 0) parts.push(`Frameworks: ${fingerprint.frameworks.join(', ')}`);
  if (fingerprint.description) parts.push(`Description: ${fingerprint.description}`);

  // Include top-level file tree (truncated)
  if (fingerprint.fileTree.length > 0) {
    parts.push(`\nFile tree (${fingerprint.fileTree.length} files):\n${fingerprint.fileTree.slice(0, 50).join('\n')}`);
  }

  // Include existing CLAUDE.md summary
  if (fingerprint.existingConfigs.claudeMd) {
    parts.push(`\nExisting CLAUDE.md (first 500 chars):\n${fingerprint.existingConfigs.claudeMd.slice(0, 500)}`);
  }

  // Include dependency names
  const deps = extractTopDeps();
  if (deps.length > 0) {
    parts.push(`\nDependencies: ${deps.slice(0, 30).join(', ')}`);
  }

  // Include existing skill names
  const installed = getInstalledSkills(platforms);
  if (installed.size > 0) {
    parts.push(`\nAlready installed skills: ${Array.from(installed).join(', ')}`);
  }

  return parts.join('\n');
}

// --- Helpers ---

function extractTopDeps(): string[] {
  const pkgPath = join(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = Object.keys(pkg.dependencies ?? {});

    // Exclude utility/tooling packages that produce noisy search results
    const trivial = new Set([
      'typescript', 'tslib', 'ts-node', 'tsx',
      'prettier', 'eslint', '@eslint/js',
      'rimraf', 'cross-env', 'dotenv', 'nodemon',
      'husky', 'lint-staged', 'commitlint',
      'chalk', 'ora', 'commander', 'yargs', 'meow',
      'inquirer', '@inquirer/confirm', '@inquirer/select', '@inquirer/prompts',
      'glob', 'minimatch', 'micromatch',
      'diff', 'semver', 'uuid', 'nanoid',
      'debug', 'ms', 'lodash', 'underscore',
      'tsup', 'esbuild', 'rollup', 'webpack', 'vite',
      'vitest', 'jest', 'mocha', 'chai', 'ava',
      'fs-extra', 'mkdirp', 'del', 'rimraf',
      'path-to-regexp', 'strip-ansi', 'ansi-colors',
    ]);

    const trivialPatterns = [
      /^@types\//,
      /^@rely-ai\//,
      /^@caliber-ai\//,
      /^eslint-/,
      /^@eslint\//,
      /^prettier-/,
      /^@typescript-eslint\//,
      /^@commitlint\//,
    ];

    return deps.filter(d =>
      !trivial.has(d) && !trivialPatterns.some(p => p.test(d))
    );
  } catch {
    return [];
  }
}

// --- Main command ---

export async function recommendCommand() {
  const proceed = await select({
    message: 'Search public repos for relevant skills to add to this project?',
    choices: [
      { name: 'Yes, find skills for my project', value: true },
      { name: 'No, cancel', value: false },
    ],
  });

  if (!proceed) {
    console.log(chalk.dim('  Cancelled.\n'));
    return;
  }

  const state = readState();
  const platforms = state?.targetAgent ?? undefined;
  await searchAndInstallSkills(platforms);
}

export async function searchAndInstallSkills(targetPlatforms?: Platform[]): Promise<void> {
  const fingerprint = await collectFingerprint(process.cwd());
  const platforms = targetPlatforms ?? detectLocalPlatforms();
  const installedSkills = getInstalledSkills(platforms);

  const technologies = [...new Set([
    ...fingerprint.languages,
    ...fingerprint.frameworks,
    ...extractTopDeps(),
  ].filter(Boolean))];

  if (technologies.length === 0) {
    console.log(chalk.yellow('Could not detect any languages or dependencies. Try running from a project root.'));
    throw new Error('__exit__');
  }

  const primaryPlatform = platforms.includes('claude') ? 'claude' : platforms[0];

  // Step 1: Search all providers
  const searchSpinner = ora('Searching skill registries...').start();
  const allCandidates = await searchAllProviders(technologies, primaryPlatform);

  if (!allCandidates.length) {
    searchSpinner.succeed('No skills found matching your tech stack.');
    return;
  }

  // Step 2: Filter out already-installed skills
  const newCandidates = allCandidates.filter(c => !installedSkills.has(c.slug.toLowerCase()));
  const filteredCount = allCandidates.length - newCandidates.length;

  if (!newCandidates.length) {
    searchSpinner.succeed(`Found ${allCandidates.length} skills — all already installed.`);
    return;
  }

  searchSpinner.succeed(
    `Found ${allCandidates.length} skills` +
    (filteredCount > 0 ? chalk.dim(` (${filteredCount} already installed)`) : '')
  );

  // Step 3: LLM relevance scoring (if provider configured)
  let results: SkillResult[];
  const config = loadConfig();

  if (config) {
    const scoreSpinner = ora('Scoring relevance for your project...').start();
    try {
      const projectContext = buildProjectContext(fingerprint, platforms);
      results = await scoreWithLLM(newCandidates, projectContext, technologies);
      if (results.length === 0) {
        scoreSpinner.succeed('No highly relevant skills found for your specific project.');
        return;
      }
      scoreSpinner.succeed(`${results.length} relevant skill${results.length > 1 ? 's' : ''} for your project`);
    } catch {
      scoreSpinner.warn('Could not score relevance — showing top results');
      results = newCandidates.slice(0, 20);
    }
  } else {
    results = newCandidates.slice(0, 20);
  }

  // Step 4: Pre-fetch content — only show skills that are actually installable
  const fetchSpinner = ora('Verifying skill availability...').start();
  const contentMap = new Map<string, string>();
  await Promise.all(results.map(async (rec) => {
    const content = await fetchSkillContent(rec);
    if (content) contentMap.set(rec.slug, content);
  }));

  const available = results.filter(r => contentMap.has(r.slug));
  if (!available.length) {
    fetchSpinner.fail('No installable skills found — content could not be fetched.');
    return;
  }
  const unavailableCount = results.length - available.length;
  fetchSpinner.succeed(
    `${available.length} installable skill${available.length > 1 ? 's' : ''}` +
    (unavailableCount > 0 ? chalk.dim(` (${unavailableCount} unavailable)`) : '')
  );

  const selected = await interactiveSelect(available);
  if (selected?.length) {
    await installSkills(selected, platforms, contentMap);
  }
}

// --- Interactive UI ---

async function interactiveSelect(recs: SkillResult[]): Promise<SkillResult[] | null> {
  if (!process.stdin.isTTY) {
    printSkills(recs);
    return null;
  }

  const selected = new Set<number>();
  let cursor = 0;
  const { stdin, stdout } = process;
  let lineCount = 0;
  const hasScores = recs.some(r => r.score > 0);

  function render(): string {
    const lines: string[] = [];
    const cols = process.stdout.columns || 80;
    const nameWidth = Math.max(...recs.map(r => r.name.length), 4) + 2;
    // prefix: "  > [x] " = 8 chars; score col: "100   " = 6 chars
    const prefixWidth = 8;
    const scoreWidth = 6;

    lines.push(chalk.bold('  Skills'));
    lines.push('');

    if (hasScores) {
      const header = ' '.repeat(prefixWidth) + chalk.dim('Score'.padEnd(scoreWidth)) + chalk.dim('Name'.padEnd(nameWidth)) + chalk.dim('Why');
      lines.push(header);
    } else {
      const header = ' '.repeat(prefixWidth) + chalk.dim('Name'.padEnd(nameWidth)) + chalk.dim('Technology'.padEnd(18)) + chalk.dim('Source');
      lines.push(header);
    }
    lines.push(chalk.dim('  ' + '─'.repeat(Math.min(cols - 4, 90))));

    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const check = selected.has(i) ? chalk.green('[x]') : '[ ]';
      const ptr = i === cursor ? chalk.cyan('>') : ' ';

      if (hasScores) {
        const scoreColor = rec.score >= 90 ? chalk.green : rec.score >= 70 ? chalk.yellow : chalk.dim;
        const reasonMax = Math.max(cols - prefixWidth - scoreWidth - nameWidth - 2, 20);
        lines.push(`  ${ptr} ${check} ${scoreColor(String(rec.score).padStart(3))}   ${rec.name.padEnd(nameWidth)}${chalk.dim(rec.reason.slice(0, reasonMax))}`);
      } else {
        lines.push(`  ${ptr} ${check} ${rec.name.padEnd(nameWidth)}${rec.detected_technology.padEnd(16)} ${chalk.dim(rec.source_url || '')}`);
      }
    }

    lines.push('');
    lines.push(chalk.dim('  ↑↓ navigate  ⎵ toggle  a all  n none  ⏎ install  q cancel'));
    return lines.join('\n');
  }

  function draw(initial: boolean) {
    if (!initial && lineCount > 0) {
      stdout.write(`\x1b[${lineCount}A`);
    }
    stdout.write('\x1b[0J');
    const output = render();
    stdout.write(output + '\n');
    lineCount = output.split('\n').length;
  }

  return new Promise((resolve) => {
    console.log('');
    draw(true);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function onData(key: string) {
      switch (key) {
        case '\x1b[A':
          cursor = (cursor - 1 + recs.length) % recs.length;
          draw(false);
          break;
        case '\x1b[B':
          cursor = (cursor + 1) % recs.length;
          draw(false);
          break;
        case ' ':
          selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor);
          draw(false);
          break;
        case 'a':
          recs.forEach((_, i) => selected.add(i));
          draw(false);
          break;
        case 'n':
          selected.clear();
          draw(false);
          break;
        case '\r':
        case '\n':
          cleanup();
          if (selected.size === 0) {
            console.log(chalk.dim('\n  No skills selected.\n'));
            resolve(null);
          } else {
            resolve(Array.from(selected).sort().map(i => recs[i]));
          }
          break;
        case 'q':
        case '\x1b':
        case '\x03':
          cleanup();
          console.log(chalk.dim('\n  Cancelled.\n'));
          resolve(null);
          break;
      }
    }

    stdin.on('data', onData);
  });
}

// --- Content fetching & install ---

async function fetchSkillContent(rec: SkillResult): Promise<string | null> {
  if (!rec.source_url) return null;

  const repoPath = rec.source_url.replace('https://github.com/', '');

  // Try common skill file locations in the source repo
  const candidates = [
    `https://raw.githubusercontent.com/${repoPath}/HEAD/skills/${rec.slug}/SKILL.md`,
    `https://raw.githubusercontent.com/${repoPath}/HEAD/${rec.slug}/SKILL.md`,
    `https://raw.githubusercontent.com/${repoPath}/HEAD/.claude/skills/${rec.slug}/SKILL.md`,
    `https://raw.githubusercontent.com/${repoPath}/HEAD/.agents/skills/${rec.slug}/SKILL.md`,
  ];

  for (const url of candidates) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (resp.ok) {
        const text = await resp.text();
        if (text.length > 20) return text;
      }
    } catch {}
  }

  // Fallback: search the repo tree for the SKILL.md file via GitHub API
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${repoPath}/git/trees/HEAD?recursive=1`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (resp.ok) {
      const tree = await resp.json() as { tree?: Array<{ path: string }> };
      const needle = `${rec.slug}/SKILL.md`;
      const match = tree.tree?.find(f => f.path.endsWith(needle));
      if (match) {
        const rawUrl = `https://raw.githubusercontent.com/${repoPath}/HEAD/${match.path}`;
        const contentResp = await fetch(rawUrl, { signal: AbortSignal.timeout(10_000) });
        if (contentResp.ok) return await contentResp.text();
      }
    }
  } catch {}

  return null;
}

async function installSkills(recs: SkillResult[], platforms: Platform[], contentMap: Map<string, string>): Promise<void> {
  const spinner = ora(`Installing ${recs.length} skill${recs.length > 1 ? 's' : ''}...`).start();
  const installed: string[] = [];

  for (const rec of recs) {
    const content = contentMap.get(rec.slug);
    if (!content) continue;

    for (const platform of platforms) {
      const skillPath = getSkillPath(platform, rec.slug);
      const fullPath = join(process.cwd(), skillPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf-8');
      installed.push(`[${platform}] ${skillPath}`);
    }
  }

  if (installed.length > 0) {
    trackSkillsInstalled(installed.length);
    spinner.succeed(`Installed ${installed.length} file${installed.length > 1 ? 's' : ''}`);
    for (const p of installed) {
      console.log(chalk.green(`  ✓ ${p}`));
    }
  } else {
    spinner.fail('No skills were installed');
  }

  console.log('');
}

function printSkills(recs: SkillResult[]) {
  const hasScores = recs.some(r => r.score > 0);
  const cols = process.stdout.columns || 80;
  const nameWidth = Math.max(...recs.map(r => r.name.length), 4) + 2;
  const scoreWidth = 6;
  const prefixWidth = 2;

  console.log(chalk.bold('\n  Skills\n'));

  if (hasScores) {
    console.log(' '.repeat(prefixWidth) + chalk.dim('Score'.padEnd(scoreWidth)) + chalk.dim('Name'.padEnd(nameWidth)) + chalk.dim('Why'));
  } else {
    console.log(' '.repeat(prefixWidth) + chalk.dim('Name'.padEnd(nameWidth)) + chalk.dim('Technology'.padEnd(18)) + chalk.dim('Source'));
  }
  console.log(chalk.dim('  ' + '─'.repeat(Math.min(cols - 4, 90))));

  for (const rec of recs) {
    if (hasScores) {
      const reasonMax = Math.max(cols - prefixWidth - scoreWidth - nameWidth - 2, 20);
      console.log(`  ${String(rec.score).padStart(3)}   ${rec.name.padEnd(nameWidth)}${chalk.dim(rec.reason.slice(0, reasonMax))}`);
    } else {
      console.log(`  ${rec.name.padEnd(nameWidth)}${rec.detected_technology.padEnd(16)} ${chalk.dim(rec.source_url || '')}`);
    }
  }
  console.log('');
}

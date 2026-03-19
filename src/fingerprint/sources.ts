import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getGitRemoteUrl } from './git.js';
import { readPackageName } from './index.js';
import { readFileOrNull } from '../scoring/utils.js';

// Source Resolution Pipeline
//
// .caliber/sources.json ──┐
// --source CLI flags ──────┤──▶ merge (CLI > config > auto)
// workspaces[] (from LLM) ─┘         │
//                              dedup by abs path
//                                     │
//                              validate (exists? dir/file? not inside cwd?)
//                                     │
//                              sort by priority + cap at MAX_SOURCES
//                                     │
//                              collectSourceSummary() per source
//                                     │
//                              SourceSummary[]

export interface SourceConfig {
  type: 'repo' | 'file' | 'url';
  path?: string;
  url?: string;
  role?: string;
  description?: string;
}

interface SourcesFile {
  sources: SourceConfig[];
}

export interface SourceSummary {
  name: string;
  type: 'repo' | 'file' | 'url';
  role: string;
  description: string;
  origin: 'config' | 'cli' | 'workspace';
  gitRemoteUrl?: string;
  topLevelDirs?: string[];
  keyFiles?: string[];
  existingClaudeMd?: string;
  readmeExcerpt?: string;
  packageName?: string;
}

const MAX_SOURCES_IN_PROMPT = 5;
const SOURCE_CONTENT_LIMIT = 2000;
const README_CONTENT_LIMIT = 1000;

const ORIGIN_PRIORITY: Record<string, number> = { cli: 0, config: 1, workspace: 2 };

export function loadSourcesConfig(dir: string): SourceConfig[] {
  const configPath = path.join(dir, '.caliber', 'sources.json');
  const content = readFileOrNull(configPath);
  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as SourcesFile;
    if (!Array.isArray(parsed.sources)) {
      console.warn('Warning: .caliber/sources.json is malformed (missing sources array), skipping sources');
      return [];
    }
    return parsed.sources.filter(
      (s) => s.type && (s.path || s.url),
    );
  } catch {
    console.warn('Warning: .caliber/sources.json is malformed, skipping sources');
    return [];
  }
}

export function writeSourcesConfig(dir: string, sources: SourceConfig[]): void {
  const configDir = path.join(dir, '.caliber');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const configPath = path.join(configDir, 'sources.json');
  fs.writeFileSync(configPath, JSON.stringify({ sources }, null, 2) + '\n', 'utf-8');
}

interface ResolvedSource {
  absPath: string;
  config: SourceConfig;
  origin: 'config' | 'cli' | 'workspace';
}

export function detectSourceType(absPath: string): 'repo' | 'file' {
  try {
    return fs.statSync(absPath).isDirectory() ? 'repo' : 'file';
  } catch {
    return 'file';
  }
}

export function isInsideDir(childPath: string, parentDir: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function resolveAllSources(
  dir: string,
  cliSources: string[],
  workspaces: string[],
): SourceSummary[] {
  const seen = new Map<string, ResolvedSource>();
  const projectRoot = path.resolve(dir);

  // CLI sources (highest priority)
  for (const src of cliSources) {
    const absPath = path.resolve(dir, src);
    if (seen.has(absPath)) continue;
    const type = detectSourceType(absPath);
    seen.set(absPath, {
      absPath,
      config: { type, path: src },
      origin: 'cli',
    });
  }

  // Config sources
  const configSources = loadSourcesConfig(dir);
  for (const cfg of configSources) {
    if (cfg.type === 'url') continue; // Phase 2
    if (!cfg.path) continue;
    const absPath = path.resolve(dir, cfg.path);
    if (seen.has(absPath)) continue;
    seen.set(absPath, { absPath, config: cfg, origin: 'config' });
  }

  // Workspace sources (lowest priority)
  for (const ws of workspaces) {
    const absPath = path.resolve(dir, ws);
    if (seen.has(absPath)) continue;
    // Workspaces must be within the project root
    if (!isInsideDir(absPath, projectRoot)) continue;
    seen.set(absPath, {
      absPath,
      config: { type: 'repo', path: ws, role: 'workspace-sibling' },
      origin: 'workspace',
    });
  }

  // Filter: must exist, must not be inside cwd (circular), validate type
  const valid: ResolvedSource[] = [];
  for (const [absPath, resolved] of seen) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      console.warn(`Source ${resolved.config.path || absPath} not found, skipping`);
      continue;
    }

    // Circular check: non-workspace sources must not resolve inside cwd
    if (isInsideDir(absPath, projectRoot) && resolved.origin !== 'workspace') {
      if (absPath !== projectRoot) {
        console.warn(`Skipping ${resolved.config.path || absPath}: inside current project`);
      }
      continue;
    }

    if (resolved.config.type === 'file' && !stat.isFile()) continue;
    if (resolved.config.type === 'repo' && !stat.isDirectory()) continue;

    valid.push(resolved);
  }

  // Sort by priority (cli > config > workspace), then proximity
  valid.sort((a, b) => {
    const pA = ORIGIN_PRIORITY[a.origin] ?? 2;
    const pB = ORIGIN_PRIORITY[b.origin] ?? 2;
    if (pA !== pB) return pA - pB;
    return a.absPath.length - b.absPath.length;
  });

  // Collect summaries, cap at MAX
  const capped = valid.slice(0, MAX_SOURCES_IN_PROMPT);
  return capped.map((r) => collectSourceSummary(r, dir));
}

function collectSourceSummary(resolved: ResolvedSource, projectDir: string): SourceSummary {
  const { config, origin, absPath } = resolved;

  if (config.type === 'file') {
    return collectFileSummary(resolved, projectDir);
  }

  // Check for published summary.json
  const summaryPath = path.join(absPath, '.caliber', 'summary.json');
  const summaryContent = readFileOrNull(summaryPath);
  if (summaryContent) {
    try {
      const published = JSON.parse(summaryContent) as Record<string, unknown>;
      return {
        name: (published.name as string) || path.basename(absPath),
        type: 'repo',
        role: config.role || (published.role as string) || 'related-repo',
        description: config.description || (published.description as string) || '',
        origin,
        topLevelDirs: Array.isArray(published.topLevelDirs) ? published.topLevelDirs as string[] : undefined,
        existingClaudeMd: typeof published.conventions === 'string' ? published.conventions : undefined,
        packageName: typeof published.name === 'string' ? published.name : undefined,
      };
    } catch {
      // Malformed summary.json — fall through to scan
    }
  }

  return collectRepoSummary(resolved, projectDir);
}

function collectRepoSummary(resolved: ResolvedSource, projectDir: string): SourceSummary {
  const { config, origin, absPath } = resolved;

  const packageName = readPackageName(absPath);

  let topLevelDirs: string[] | undefined;
  let keyFiles: string[] | undefined;
  try {
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    topLevelDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name)
      .slice(0, 20);
    keyFiles = entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .slice(0, 15);
  } catch { /* skip */ }

  const claudeMdContent = readFileOrNull(path.join(absPath, 'CLAUDE.md'));
  const existingClaudeMd = claudeMdContent
    ? claudeMdContent.slice(0, SOURCE_CONTENT_LIMIT)
    : undefined;

  const readmeContent = readFileOrNull(path.join(absPath, 'README.md'));
  const readmeExcerpt = readmeContent
    ? readmeContent.slice(0, README_CONTENT_LIMIT)
    : undefined;

  const gitRemoteUrl = getGitRemoteUrl(absPath);

  return {
    name: packageName || path.basename(absPath),
    type: 'repo',
    role: config.role || 'related-repo',
    description: config.description || '',
    origin,
    gitRemoteUrl,
    topLevelDirs,
    keyFiles,
    existingClaudeMd,
    readmeExcerpt,
    packageName,
  };
}

function collectFileSummary(resolved: ResolvedSource, projectDir: string): SourceSummary {
  const { config, origin, absPath } = resolved;
  const content = readFileOrNull(absPath);

  return {
    name: path.basename(absPath),
    type: 'file',
    role: config.role || 'reference-doc',
    description: config.description || content?.slice(0, 100).split('\n')[0] || '',
    origin,
    existingClaudeMd: content ? content.slice(0, SOURCE_CONTENT_LIMIT) : undefined,
  };
}

export function formatSourcesForPrompt(sources: SourceSummary[]): string {
  if (sources.length === 0) return '';

  const parts: string[] = [
    '\n--- Related Sources ---',
    'This project works with these related sources. Reference them in the generated',
    'config where relevant — mention shared conventions, cross-repo workflows, and',
    'integration points.\n',
  ];

  for (const source of sources) {
    parts.push(`[${source.name}] (${source.role})`);
    if (source.description) parts.push(source.description);

    if (source.topLevelDirs?.length) {
      parts.push(`Key dirs: ${source.topLevelDirs.join(', ')}`);
    }
    if (source.keyFiles?.length) {
      parts.push(`Key files: ${source.keyFiles.join(', ')}`);
    }
    if (source.existingClaudeMd) {
      parts.push(`Their CLAUDE.md:\n${source.existingClaudeMd}`);
    } else if (source.readmeExcerpt) {
      parts.push(`Their README:\n${source.readmeExcerpt}`);
    }
    parts.push('');
  }

  parts.push('--- End Related Sources ---');
  return parts.join('\n');
}

export function computeSourceHash(source: SourceSummary): string {
  const key = [
    source.name,
    source.type,
    source.topLevelDirs?.join(',') || '',
    source.existingClaudeMd?.slice(0, 500) || '',
  ].join('::');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function computeSourceHashes(sources: SourceSummary[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const source of sources) {
    hashes[source.name] = computeSourceHash(source);
  }
  return hashes;
}

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { resolveCaliber, isCaliberCommand } from './resolve-caliber.js';

const SETTINGS_PATH = path.join('.claude', 'settings.json');
const REFRESH_TAIL = 'refresh --quiet';
const HOOK_DESCRIPTION = 'Caliber: auto-refreshing docs based on code changes';

function getHookCommand(): string {
  return `${resolveCaliber()} ${REFRESH_TAIL}`;
}

interface HookEntry {
  type: string;
  command: string;
  description?: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    SessionEnd?: HookMatcher[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function readSettings(): ClaudeSettings {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(settings: ClaudeSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function findHookIndex(sessionEnd: HookMatcher[]): number {
  return sessionEnd.findIndex(entry =>
    entry.hooks?.some(h => isCaliberCommand(h.command, REFRESH_TAIL))
  );
}

export function isHookInstalled(): boolean {
  const settings = readSettings();
  const sessionEnd = settings.hooks?.SessionEnd;
  if (!Array.isArray(sessionEnd)) return false;
  return findHookIndex(sessionEnd) !== -1;
}

export function installHook(): { installed: boolean; alreadyInstalled: boolean } {
  const settings = readSettings();

  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.SessionEnd)) settings.hooks.SessionEnd = [];

  if (findHookIndex(settings.hooks.SessionEnd) !== -1) {
    return { installed: false, alreadyInstalled: true };
  }

  settings.hooks.SessionEnd.push({
    matcher: '',
    hooks: [{ type: 'command', command: getHookCommand(), description: HOOK_DESCRIPTION }],
  });

  writeSettings(settings);
  return { installed: true, alreadyInstalled: false };
}

export function removeHook(): { removed: boolean; notFound: boolean } {
  const settings = readSettings();
  const sessionEnd = settings.hooks?.SessionEnd;

  if (!Array.isArray(sessionEnd)) {
    return { removed: false, notFound: true };
  }

  const idx = findHookIndex(sessionEnd);
  if (idx === -1) {
    return { removed: false, notFound: true };
  }

  sessionEnd.splice(idx, 1);
  if (sessionEnd.length === 0) {
    delete settings.hooks!.SessionEnd;
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settings);
  return { removed: true, notFound: false };
}

// ── Pre-commit hook ──────────────────────────────────────────────────

const PRECOMMIT_START = '# caliber:pre-commit:start';
const PRECOMMIT_END = '# caliber:pre-commit:end';

function getPrecommitBlock(): string {
  const bin = resolveCaliber();
  return `${PRECOMMIT_START}
if [ -x "${bin}" ] || command -v "${bin}" >/dev/null 2>&1; then
  echo "\\033[2mcaliber: refreshing docs...\\033[0m"
  "${bin}" refresh 2>/dev/null || true
  "${bin}" learn finalize 2>/dev/null || true
  git diff --name-only -- CLAUDE.md .claude/ .cursor/ AGENTS.md CALIBER_LEARNINGS.md 2>/dev/null | xargs git add 2>/dev/null || true
fi
${PRECOMMIT_END}`;
}

function getGitHooksDir(): string | null {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return path.join(gitDir, 'hooks');
  } catch {
    return null;
  }
}

function getPreCommitPath(): string | null {
  const hooksDir = getGitHooksDir();
  return hooksDir ? path.join(hooksDir, 'pre-commit') : null;
}

export function isPreCommitHookInstalled(): boolean {
  const hookPath = getPreCommitPath();
  if (!hookPath || !fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, 'utf-8');
  return content.includes(PRECOMMIT_START);
}

export function installPreCommitHook(): { installed: boolean; alreadyInstalled: boolean } {
  if (isPreCommitHookInstalled()) {
    return { installed: false, alreadyInstalled: true };
  }

  const hookPath = getPreCommitPath();
  if (!hookPath) return { installed: false, alreadyInstalled: false };

  const hooksDir = path.dirname(hookPath);
  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

  let content = '';
  if (fs.existsSync(hookPath)) {
    content = fs.readFileSync(hookPath, 'utf-8');
    if (!content.endsWith('\n')) content += '\n';
    content += '\n' + getPrecommitBlock() + '\n';
  } else {
    content = '#!/bin/sh\n\n' + getPrecommitBlock() + '\n';
  }

  fs.writeFileSync(hookPath, content);
  fs.chmodSync(hookPath, 0o755);
  return { installed: true, alreadyInstalled: false };
}

export function removePreCommitHook(): { removed: boolean; notFound: boolean } {
  const hookPath = getPreCommitPath();
  if (!hookPath || !fs.existsSync(hookPath)) {
    return { removed: false, notFound: true };
  }

  let content = fs.readFileSync(hookPath, 'utf-8');
  if (!content.includes(PRECOMMIT_START)) {
    return { removed: false, notFound: true };
  }

  const regex = new RegExp(`\\n?${PRECOMMIT_START}[\\s\\S]*?${PRECOMMIT_END}\\n?`);
  content = content.replace(regex, '\n');

  // If only the shebang remains, remove the file entirely
  if (content.trim() === '#!/bin/sh' || content.trim() === '') {
    fs.unlinkSync(hookPath);
  } else {
    fs.writeFileSync(hookPath, content);
  }

  return { removed: true, notFound: false };
}

import fs from 'fs';
import path from 'path';
import { resolveCaliber, isCaliberCommand } from './resolve-caliber.js';

// ── Claude Code hooks ────────────────────────────────────────────────

const SETTINGS_PATH = path.join('.claude', 'settings.json');

const HOOK_TAILS = [
  { event: 'PostToolUse', tail: 'learn observe', description: 'Caliber: recording tool usage for session learning' },
  { event: 'PostToolUseFailure', tail: 'learn observe --failure', description: 'Caliber: recording tool failure for session learning' },
  { event: 'UserPromptSubmit', tail: 'learn observe --prompt', description: 'Caliber: recording user prompt for correction detection' },
  { event: 'SessionEnd', tail: 'learn finalize --auto', description: 'Caliber: finalizing session learnings' },
] as const;

function getHookConfigs() {
  const bin = resolveCaliber();
  return HOOK_TAILS.map(({ event, tail, description }) => ({
    event,
    command: `${bin} ${tail}`,
    tail,
    description,
  }));
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
  hooks?: Record<string, HookMatcher[]>;
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

function hasLearningHook(matchers: HookMatcher[], tail: string): boolean {
  return matchers.some(entry => entry.hooks?.some(h => isCaliberCommand(h.command, tail)));
}

export function areLearningHooksInstalled(): boolean {
  const settings = readSettings();
  if (!settings.hooks) return false;

  return HOOK_TAILS.every(cfg => {
    const matchers = settings.hooks![cfg.event];
    return Array.isArray(matchers) && hasLearningHook(matchers, cfg.tail);
  });
}

export function installLearningHooks(): { installed: boolean; alreadyInstalled: boolean } {
  if (areLearningHooksInstalled()) {
    return { installed: false, alreadyInstalled: true };
  }

  const settings = readSettings();
  if (!settings.hooks) settings.hooks = {};

  const configs = getHookConfigs();
  for (const cfg of configs) {
    if (!Array.isArray(settings.hooks[cfg.event])) {
      settings.hooks[cfg.event] = [];
    }

    if (!hasLearningHook(settings.hooks[cfg.event], cfg.tail)) {
      settings.hooks[cfg.event].push({
        matcher: '',
        hooks: [{ type: 'command', command: cfg.command, description: cfg.description }],
      });
    }
  }

  writeSettings(settings);
  return { installed: true, alreadyInstalled: false };
}

// ── Cursor hooks (https://cursor.com/docs/hooks) ─────────────────────
// Cursor uses .cursor/hooks.json with camelCase event names and a flatter structure.

const CURSOR_HOOKS_PATH = path.join('.cursor', 'hooks.json');

const CURSOR_HOOK_EVENTS = [
  { event: 'postToolUse', tail: 'learn observe' },
  { event: 'postToolUseFailure', tail: 'learn observe --failure' },
  { event: 'userPromptSubmit', tail: 'learn observe --prompt' },
  { event: 'sessionEnd', tail: 'learn finalize --auto' },
] as const;

interface CursorHooksConfig {
  version: number;
  hooks: Record<string, Array<{ command: string }>>;
}

function readCursorHooks(): CursorHooksConfig {
  if (!fs.existsSync(CURSOR_HOOKS_PATH)) return { version: 1, hooks: {} };
  try {
    return JSON.parse(fs.readFileSync(CURSOR_HOOKS_PATH, 'utf-8'));
  } catch {
    return { version: 1, hooks: {} };
  }
}

function writeCursorHooks(config: CursorHooksConfig): void {
  const dir = path.dirname(CURSOR_HOOKS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CURSOR_HOOKS_PATH, JSON.stringify(config, null, 2));
}

function hasCursorHook(entries: Array<{ command: string }>, tail: string): boolean {
  return entries.some(e => isCaliberCommand(e.command, tail));
}

export function areCursorLearningHooksInstalled(): boolean {
  const config = readCursorHooks();
  return CURSOR_HOOK_EVENTS.every(cfg => {
    const entries = config.hooks[cfg.event];
    return Array.isArray(entries) && hasCursorHook(entries, cfg.tail);
  });
}

export function installCursorLearningHooks(): { installed: boolean; alreadyInstalled: boolean } {
  if (areCursorLearningHooksInstalled()) {
    return { installed: false, alreadyInstalled: true };
  }

  const config = readCursorHooks();
  const bin = resolveCaliber();

  for (const cfg of CURSOR_HOOK_EVENTS) {
    if (!Array.isArray(config.hooks[cfg.event])) {
      config.hooks[cfg.event] = [];
    }
    if (!hasCursorHook(config.hooks[cfg.event], cfg.tail)) {
      config.hooks[cfg.event].push({ command: `${bin} ${cfg.tail}` });
    }
  }

  writeCursorHooks(config);
  return { installed: true, alreadyInstalled: false };
}

export function removeCursorLearningHooks(): { removed: boolean; notFound: boolean } {
  const config = readCursorHooks();
  let removedAny = false;

  for (const cfg of CURSOR_HOOK_EVENTS) {
    const entries = config.hooks[cfg.event];
    if (!Array.isArray(entries)) continue;

    const idx = entries.findIndex(e => isCaliberCommand(e.command, cfg.tail));
    if (idx !== -1) {
      entries.splice(idx, 1);
      removedAny = true;
      if (entries.length === 0) delete config.hooks[cfg.event];
    }
  }

  if (!removedAny) return { removed: false, notFound: true };

  writeCursorHooks(config);
  return { removed: true, notFound: false };
}

// ── Claude Code hooks (continued) ────────────────────────────────────

export function removeLearningHooks(): { removed: boolean; notFound: boolean } {
  const settings = readSettings();
  if (!settings.hooks) return { removed: false, notFound: true };

  let removedAny = false;

  for (const cfg of HOOK_TAILS) {
    const matchers = settings.hooks[cfg.event];
    if (!Array.isArray(matchers)) continue;

    const idx = matchers.findIndex(entry => entry.hooks?.some(h => isCaliberCommand(h.command, cfg.tail)));
    if (idx !== -1) {
      matchers.splice(idx, 1);
      removedAny = true;

      if (matchers.length === 0) delete settings.hooks[cfg.event];
    }
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  if (!removedAny) return { removed: false, notFound: true };

  writeSettings(settings);
  return { removed: true, notFound: false };
}

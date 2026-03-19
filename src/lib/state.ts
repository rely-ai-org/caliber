import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { CALIBER_DIR } from '../constants.js';

const STATE_FILE = path.join(CALIBER_DIR, '.caliber-state.json');

interface CaliberState {
  lastRefreshSha: string;
  lastRefreshTimestamp: string;
  targetAgent?: ('claude' | 'cursor' | 'codex' | 'github-copilot')[];
}

function normalizeTargetAgent(value: unknown): ('claude' | 'cursor' | 'codex' | 'github-copilot')[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    if (value === 'both') return ['claude', 'cursor'];
    if (['claude', 'cursor', 'codex', 'github-copilot'].includes(value)) return [value as 'claude' | 'cursor' | 'codex' | 'github-copilot'];
  }
  return undefined;
}

export function readState(): CaliberState | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    if (raw.targetAgent) raw.targetAgent = normalizeTargetAgent(raw.targetAgent);
    return raw;
  } catch {
    return null;
  }
}

export function writeState(state: CaliberState): void {
  if (!fs.existsSync(CALIBER_DIR)) {
    fs.mkdirSync(CALIBER_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function getCurrentHeadSha(): string | null {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

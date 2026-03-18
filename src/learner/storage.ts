import fs from 'fs';
import path from 'path';
import {
  LEARNING_DIR,
  LEARNING_SESSION_FILE,
  LEARNING_STATE_FILE,
  LEARNING_MAX_EVENTS,
} from '../constants.js';

const MAX_RESPONSE_LENGTH = 2000;

export interface ToolEvent {
  timestamp: string;
  session_id: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: Record<string, unknown>;
  tool_use_id: string;
  cwd: string;
}

export interface PromptEvent {
  timestamp: string;
  session_id: string;
  hook_event_name: 'UserPromptSubmit';
  prompt_content: string;
  cwd: string;
}

export type SessionEvent = ToolEvent | PromptEvent;

export interface LearningState {
  sessionId: string | null;
  eventCount: number;
  lastAnalysisTimestamp: string | null;
  lastAnalysisEventCount: number;
}

const DEFAULT_STATE: LearningState = {
  sessionId: null,
  eventCount: 0,
  lastAnalysisTimestamp: null,
  lastAnalysisEventCount: 0,
};

export function ensureLearningDir(): void {
  if (!fs.existsSync(LEARNING_DIR)) {
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
  }
}

function sessionFilePath(): string {
  return path.join(LEARNING_DIR, LEARNING_SESSION_FILE);
}

function stateFilePath(): string {
  return path.join(LEARNING_DIR, LEARNING_STATE_FILE);
}

function truncateResponse(response: Record<string, unknown>): Record<string, unknown> {
  const str = JSON.stringify(response);
  if (str.length <= MAX_RESPONSE_LENGTH) return response;
  return { _truncated: str.slice(0, MAX_RESPONSE_LENGTH) };
}

export function appendEvent(event: ToolEvent): void {
  ensureLearningDir();
  const truncated = { ...event, tool_response: truncateResponse(event.tool_response) };
  const filePath = sessionFilePath();

  fs.appendFileSync(filePath, JSON.stringify(truncated) + '\n');

  const count = getEventCount();
  if (count > LEARNING_MAX_EVENTS) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const kept = lines.slice(lines.length - LEARNING_MAX_EVENTS);
    fs.writeFileSync(filePath, kept.join('\n') + '\n');
  }
}

export function appendPromptEvent(event: PromptEvent): void {
  ensureLearningDir();
  const filePath = sessionFilePath();
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n');

  const count = getEventCount();
  if (count > LEARNING_MAX_EVENTS) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const kept = lines.slice(lines.length - LEARNING_MAX_EVENTS);
    fs.writeFileSync(filePath, kept.join('\n') + '\n');
  }
}

export function readAllEvents(): SessionEvent[] {
  const filePath = sessionFilePath();
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  const events: SessionEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as SessionEvent);
    } catch {
      // Skip corrupt JSONL lines (e.g. truncated by concurrent writes)
    }
  }
  return events;
}

export function getEventCount(): number {
  const filePath = sessionFilePath();
  if (!fs.existsSync(filePath)) return 0;

  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(Boolean).length;
}

export function clearSession(): void {
  const filePath = sessionFilePath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

export function readState(): LearningState {
  const filePath = stateFilePath();
  if (!fs.existsSync(filePath)) return { ...DEFAULT_STATE };
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeState(state: LearningState): void {
  ensureLearningDir();
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2));
}

export function resetState(): void {
  writeState({ ...DEFAULT_STATE });
}

// ── Finalize lock (prevents concurrent analysis from parallel sessions) ──

const LOCK_FILE = 'finalize.lock';
const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

function lockFilePath(): string {
  return path.join(LEARNING_DIR, LOCK_FILE);
}

/** Attempt to acquire the finalize lock. Returns true if acquired. */
export function acquireFinalizeLock(): boolean {
  ensureLearningDir();
  const lockPath = lockFilePath();

  if (fs.existsSync(lockPath)) {
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs < LOCK_STALE_MS) {
        return false; // Lock is held and not stale
      }
    } catch {
      // Can't stat — treat as stale
    }
  }

  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    // File was created between check and write — another process won
    return false;
  }
}

/** Release the finalize lock. */
export function releaseFinalizeLock(): void {
  const lockPath = lockFilePath();
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    // Best effort
  }
}

import fs from 'fs';
import path from 'path';
import { LEARNING_DIR, LEARNING_ROI_FILE, MIN_SESSIONS_FOR_COMPARISON } from '../constants.js';
import { ensureLearningDir } from './storage.js';
import { isSimilarLearning } from './utils.js';

export interface LearningCostEntry {
  timestamp: string;
  observationType: string;
  summary: string;
  wasteTokens: number;
  sourceEventCount: number;
  occurrences?: number;
  activationCount?: number;
  lastActivationTimestamp?: string | null;
  explanation?: string | null;
}

export interface SessionROISummary {
  timestamp: string;
  sessionId: string;
  eventCount: number;
  failureCount: number;
  promptCount: number;
  wasteSeconds: number;
  hadLearningsAvailable: boolean;
  learningsCount: number;
  newLearningsProduced: number;
  taskCount?: number;
  taskSuccessCount?: number;
  taskCorrectionCount?: number;
  taskFailureCount?: number;
}

export interface ROITotals {
  totalWasteTokens: number;
  totalWasteSeconds: number;
  totalSessionsWithLearnings: number;
  totalSessionsWithoutLearnings: number;
  totalFailuresWithLearnings: number;
  totalFailuresWithoutLearnings: number;
  estimatedSavingsTokens: number;
  estimatedSavingsSeconds: number;
  firstSessionTimestamp: string;
  lastSessionTimestamp: string;
}

export interface ROIStats {
  learnings: LearningCostEntry[];
  sessions: SessionROISummary[];
  totals: ROITotals;
}

const DEFAULT_TOTALS: ROITotals = {
  totalWasteTokens: 0,
  totalWasteSeconds: 0,
  totalSessionsWithLearnings: 0,
  totalSessionsWithoutLearnings: 0,
  totalFailuresWithLearnings: 0,
  totalFailuresWithoutLearnings: 0,
  estimatedSavingsTokens: 0,
  estimatedSavingsSeconds: 0,
  firstSessionTimestamp: '',
  lastSessionTimestamp: '',
};

function roiFilePath(): string {
  return path.join(LEARNING_DIR, LEARNING_ROI_FILE);
}

export function readROIStats(): ROIStats {
  const filePath = roiFilePath();
  if (!fs.existsSync(filePath)) {
    return { learnings: [], sessions: [], totals: { ...DEFAULT_TOTALS } };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    try {
      const corruptPath = filePath + '.corrupt';
      fs.renameSync(filePath, corruptPath);
      console.error(`caliber: roi-stats.json was corrupt — renamed to ${corruptPath}`);
    } catch {
      // Best effort — if rename fails, just continue with defaults
    }
    return { learnings: [], sessions: [], totals: { ...DEFAULT_TOTALS } };
  }
}

export function writeROIStats(stats: ROIStats): void {
  ensureLearningDir();
  fs.writeFileSync(roiFilePath(), JSON.stringify(stats, null, 2));
}

function recalculateTotals(stats: ROIStats): void {
  const totals = stats.totals;

  totals.totalWasteTokens = stats.learnings.reduce((sum, l) => sum + l.wasteTokens, 0);
  totals.totalWasteSeconds = 0;

  totals.totalSessionsWithLearnings = 0;
  totals.totalSessionsWithoutLearnings = 0;
  totals.totalFailuresWithLearnings = 0;
  totals.totalFailuresWithoutLearnings = 0;

  for (const s of stats.sessions) {
    totals.totalWasteSeconds += s.wasteSeconds || 0;
    if (s.hadLearningsAvailable) {
      totals.totalSessionsWithLearnings++;
      totals.totalFailuresWithLearnings += s.failureCount;
    } else {
      totals.totalSessionsWithoutLearnings++;
      totals.totalFailuresWithoutLearnings += s.failureCount;
    }
  }

  if (
    totals.totalSessionsWithLearnings >= MIN_SESSIONS_FOR_COMPARISON &&
    totals.totalSessionsWithoutLearnings >= MIN_SESSIONS_FOR_COMPARISON
  ) {
    const rateWithout = totals.totalFailuresWithoutLearnings / totals.totalSessionsWithoutLearnings;
    const rateWith = totals.totalFailuresWithLearnings / totals.totalSessionsWithLearnings;
    if (rateWithout > 0 && rateWith < rateWithout) {
      const reduction = (rateWithout - rateWith) / rateWithout;
      const totalSessions = totals.totalSessionsWithLearnings + totals.totalSessionsWithoutLearnings;
      const avgWastePerSession = totalSessions > 0 ? totals.totalWasteTokens / totalSessions : 0;
      totals.estimatedSavingsTokens = Math.round(reduction * avgWastePerSession * totals.totalSessionsWithLearnings);
      const avgWasteSecondsPerSession = totalSessions > 0 ? totals.totalWasteSeconds / totalSessions : 0;
      totals.estimatedSavingsSeconds = Math.round(reduction * avgWasteSecondsPerSession * totals.totalSessionsWithLearnings);
    } else {
      totals.estimatedSavingsTokens = 0;
      totals.estimatedSavingsSeconds = 0;
    }
  } else {
    totals.estimatedSavingsTokens = 0;
    totals.estimatedSavingsSeconds = 0;
  }

  if (stats.sessions.length > 0) {
    totals.firstSessionTimestamp = stats.sessions[0].timestamp;
    totals.lastSessionTimestamp = stats.sessions[stats.sessions.length - 1].timestamp;
  }
}

const MAX_SESSIONS = 500;
const MAX_LEARNINGS = 1000;

export function recordSession(summary: SessionROISummary, learnings?: LearningCostEntry[]): ROIStats {
  const stats = readROIStats();
  stats.sessions.push(summary);
  if (learnings?.length) {
    for (const entry of learnings) {
      const existingIdx = stats.learnings.findIndex(e => isSimilarLearning(e.summary, entry.summary));
      if (existingIdx !== -1) {
        stats.learnings[existingIdx].occurrences = (stats.learnings[existingIdx].occurrences || 1) + 1;
        stats.learnings[existingIdx].timestamp = entry.timestamp;
      } else {
        entry.occurrences = 1;
        stats.learnings.push(entry);
      }
    }
  }
  if (stats.sessions.length > MAX_SESSIONS) {
    stats.sessions = stats.sessions.slice(-MAX_SESSIONS);
  }
  if (stats.learnings.length > MAX_LEARNINGS) {
    stats.learnings = stats.learnings.slice(-MAX_LEARNINGS);
  }
  recalculateTotals(stats);
  writeROIStats(stats);
  return stats;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function formatROISummary(stats: ROIStats): string {
  const t = stats.totals;
  const totalSessions = t.totalSessionsWithLearnings + t.totalSessionsWithoutLearnings;
  if (totalSessions === 0) return '';

  const lines: string[] = ['ROI Summary'];

  lines.push(`  Sessions tracked:              ${totalSessions}`);
  lines.push(`  Sessions with learnings:       ${t.totalSessionsWithLearnings}`);

  if (t.totalSessionsWithoutLearnings > 0) {
    const rateWithout = (t.totalFailuresWithoutLearnings / t.totalSessionsWithoutLearnings).toFixed(1);
    lines.push(`  Failure rate (no learnings):   ${rateWithout}/session`);
  }

  if (t.totalSessionsWithLearnings > 0) {
    const rateWith = (t.totalFailuresWithLearnings / t.totalSessionsWithLearnings).toFixed(1);
    lines.push(`  Failure rate (with learnings): ${rateWith}/session`);
  }

  if (t.totalWasteTokens > 0) {
    lines.push(`  Total waste captured:          ${t.totalWasteTokens.toLocaleString()} tokens`);
  }

  if (t.estimatedSavingsTokens > 0) {
    lines.push(`  Estimated savings:             ~${t.estimatedSavingsTokens.toLocaleString()} tokens`);
  }

  if (t.estimatedSavingsSeconds > 0) {
    lines.push(`  Time saved:                    at least ${formatDuration(t.estimatedSavingsSeconds)} (not counting human frustration)`);
  } else if (t.totalWasteSeconds > 0) {
    lines.push(`  Time wasted on failures:       ${formatDuration(t.totalWasteSeconds)} (and counting)`);
  }

  return lines.join('\n');
}

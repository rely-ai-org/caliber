import fs from 'fs';
import path from 'path';
import { LEARNING_DIR, LEARNING_ROI_FILE } from '../constants.js';
import { ensureLearningDir } from './storage.js';

export interface LearningCostEntry {
  timestamp: string;
  observationType: string;
  summary: string;
  wasteTokens: number;
  sourceEventCount: number;
}

export interface SessionROISummary {
  timestamp: string;
  sessionId: string;
  eventCount: number;
  failureCount: number;
  promptCount: number;
  hadLearningsAvailable: boolean;
  learningsCount: number;
  newLearningsProduced: number;
}

export interface ROITotals {
  totalWasteTokens: number;
  totalSessionsWithLearnings: number;
  totalSessionsWithoutLearnings: number;
  totalFailuresWithLearnings: number;
  totalFailuresWithoutLearnings: number;
  estimatedSavingsTokens: number;
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
  totalSessionsWithLearnings: 0,
  totalSessionsWithoutLearnings: 0,
  totalFailuresWithLearnings: 0,
  totalFailuresWithoutLearnings: 0,
  estimatedSavingsTokens: 0,
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

  totals.totalSessionsWithLearnings = 0;
  totals.totalSessionsWithoutLearnings = 0;
  totals.totalFailuresWithLearnings = 0;
  totals.totalFailuresWithoutLearnings = 0;

  for (const s of stats.sessions) {
    if (s.hadLearningsAvailable) {
      totals.totalSessionsWithLearnings++;
      totals.totalFailuresWithLearnings += s.failureCount;
    } else {
      totals.totalSessionsWithoutLearnings++;
      totals.totalFailuresWithoutLearnings += s.failureCount;
    }
  }

  totals.estimatedSavingsTokens = totals.totalWasteTokens * totals.totalSessionsWithLearnings;

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
    stats.learnings.push(...learnings);
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

export function formatROISummary(stats: ROIStats): string {
  const t = stats.totals;
  const totalSessions = t.totalSessionsWithLearnings + t.totalSessionsWithoutLearnings;
  if (totalSessions === 0) return '';

  const lines: string[] = ['ROI Summary'];

  lines.push(`  Sessions tracked:              ${totalSessions}`);
  lines.push(`  Sessions with learnings:       ${t.totalSessionsWithLearnings}`);

  if (t.totalSessionsWithoutLearnings > 0) {
    const rateWithout = t.totalSessionsWithoutLearnings > 0
      ? (t.totalFailuresWithoutLearnings / t.totalSessionsWithoutLearnings).toFixed(1)
      : '0.0';
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

  return lines.join('\n');
}

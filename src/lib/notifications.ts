import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { LEARNING_DIR } from '../constants.js';
import { ensureLearningDir } from '../learner/storage.js';

const NOTIFICATION_FILE = path.join(LEARNING_DIR, 'last-finalize-summary.json');

export interface FinalizeSummary {
  timestamp: string;
  newItemCount: number;
  newItems: string[];
  wasteTokens: number;
}

export function writeFinalizeSummary(summary: FinalizeSummary): void {
  try {
    ensureLearningDir();
    fs.writeFileSync(NOTIFICATION_FILE, JSON.stringify(summary, null, 2));
  } catch {
    // Best effort — never crash the finalize flow
  }
}

export function checkPendingNotifications(): void {
  try {
    if (!fs.existsSync(NOTIFICATION_FILE)) return;

    const raw = fs.readFileSync(NOTIFICATION_FILE, 'utf-8');
    fs.unlinkSync(NOTIFICATION_FILE);

    const summary: FinalizeSummary = JSON.parse(raw);
    if (!summary.newItemCount || summary.newItemCount === 0) return;

    const wasteLabel = summary.wasteTokens > 0
      ? ` (~${summary.wasteTokens.toLocaleString()} wasted tokens captured)`
      : '';
    console.log(
      chalk.dim(`caliber: learned ${summary.newItemCount} new pattern${summary.newItemCount === 1 ? '' : 's'} from your last session${wasteLabel}`),
    );
    for (const item of summary.newItems.slice(0, 3)) {
      console.log(chalk.dim(`  + ${item.replace(/^- /, '').slice(0, 80)}`));
    }
    if (summary.newItems.length > 3) {
      console.log(chalk.dim(`  ... and ${summary.newItems.length - 3} more`));
    }
    console.log('');
  } catch {
    // Corrupt file — delete and move on
    try { fs.unlinkSync(NOTIFICATION_FILE); } catch { /* best effort */ }
  }
}

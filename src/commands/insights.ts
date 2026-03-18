import chalk from 'chalk';
import { readROIStats, formatDuration } from '../learner/roi.js';
import type { ROIStats } from '../learner/roi.js';
import { computeLocalScore } from '../scoring/index.js';
import { readState } from '../lib/state.js';
import { trackInsightsViewed } from '../telemetry/events.js';
import {
  areLearningHooksInstalled,
  areCursorLearningHooksInstalled,
} from '../lib/learning-hooks.js';

interface InsightsOptions {
  json?: boolean;
}

const MIN_SESSIONS_FULL = 20;

function buildInsightsData(stats: ROIStats) {
  const t = stats.totals;
  const totalSessions = t.totalSessionsWithLearnings + t.totalSessionsWithoutLearnings;

  const failureRateWith = t.totalSessionsWithLearnings > 0
    ? t.totalFailuresWithLearnings / t.totalSessionsWithLearnings
    : null;
  const failureRateWithout = t.totalSessionsWithoutLearnings > 0
    ? t.totalFailuresWithoutLearnings / t.totalSessionsWithoutLearnings
    : null;
  const failureRateImprovement = failureRateWith !== null && failureRateWithout !== null && failureRateWithout > 0
    ? Math.round((1 - failureRateWith / failureRateWithout) * 100)
    : null;

  let taskCount = 0;
  let taskSuccessCount = 0;
  let taskCorrectionCount = 0;
  let taskFailureCount = 0;
  for (const s of stats.sessions) {
    if (s.taskCount) {
      taskCount += s.taskCount;
      taskSuccessCount += s.taskSuccessCount || 0;
      taskCorrectionCount += s.taskCorrectionCount || 0;
      taskFailureCount += s.taskFailureCount || 0;
    }
  }
  const taskSuccessRate = taskCount > 0 ? Math.round((taskSuccessCount / taskCount) * 100) : null;

  return {
    totalSessions,
    learningCount: stats.learnings.length,
    failureRateWith,
    failureRateWithout,
    failureRateImprovement,
    taskCount,
    taskSuccessCount,
    taskCorrectionCount,
    taskFailureCount,
    taskSuccessRate,
    totalWasteTokens: t.totalWasteTokens,
    totalWasteSeconds: t.totalWasteSeconds,
    estimatedSavingsTokens: t.estimatedSavingsTokens,
    estimatedSavingsSeconds: t.estimatedSavingsSeconds,
  };
}

interface ScoreResult { score: number; grade: string }

function displayColdStart(score: ScoreResult) {
  console.log(chalk.bold('\n  Agent Insights\n'));
  const hooksInstalled = areLearningHooksInstalled() || areCursorLearningHooksInstalled();
  if (!hooksInstalled) {
    console.log(chalk.yellow('  No learning hooks installed.'));
    console.log(chalk.dim('  Run ') + chalk.cyan('caliber learn install') + chalk.dim(' to start tracking agent performance.'));
  } else {
    console.log(chalk.dim('  No session data yet. Use your AI agent and insights will appear here.'));
    console.log(chalk.dim('  Learnings are extracted automatically at the end of each session.'));
  }

  console.log(chalk.dim(`\n  Config score: ${score.score}/100 (${score.grade})`));
  console.log('');
}

function displayEarlyData(data: ReturnType<typeof buildInsightsData>, score: ScoreResult) {
  console.log(chalk.bold('\n  Agent Insights') + chalk.yellow(' (early data)\n'));
  console.log(chalk.dim('  Still collecting data. Insights become more reliable after 20+ sessions.\n'));
  console.log(`  Sessions tracked:       ${chalk.cyan(String(data.totalSessions))}`);
  console.log(`  Learnings accumulated:  ${chalk.cyan(String(data.learningCount))}`);

  if (data.totalWasteTokens > 0) {
    console.log(`  Waste captured:         ${chalk.cyan(data.totalWasteTokens.toLocaleString())} tokens`);
  }

  if (data.failureRateImprovement !== null && data.failureRateImprovement > 0) {
    console.log(`  Failure rate trend:     ${chalk.green(`${data.failureRateImprovement}% fewer`)} failures with learnings ${chalk.dim('(early signal)')}`);
  }

  if (data.taskSuccessRate !== null) {
    console.log(`  Task success rate:      ${chalk.cyan(`${data.taskSuccessRate}%`)} ${chalk.dim(`(${data.taskCount} tasks)`)}`);
  }

  console.log(`  Config score:           ${chalk.cyan(`${score.score}/100`)} (${score.grade})`);
  console.log('');
}

function displayFullInsights(data: ReturnType<typeof buildInsightsData>, score: ScoreResult) {
  console.log(chalk.bold('\n  Agent Insights\n'));

  console.log(chalk.bold('  Agent Health'));
  if (data.taskSuccessRate !== null) {
    const color = data.taskSuccessRate >= 80 ? chalk.green : data.taskSuccessRate >= 60 ? chalk.yellow : chalk.red;
    console.log(`    Task success rate:    ${color(`${data.taskSuccessRate}%`)} across ${data.taskCount} tasks`);
    if (data.taskCorrectionCount > 0) {
      console.log(`    Corrections needed:   ${chalk.yellow(String(data.taskCorrectionCount))} tasks required user correction`);
    }
  }
  console.log(`    Sessions tracked:     ${chalk.cyan(String(data.totalSessions))}`);

  console.log(chalk.bold('\n  Learning Impact'));
  console.log(`    Learnings active:     ${chalk.cyan(String(data.learningCount))}`);

  if (data.failureRateWith !== null && data.failureRateWithout !== null) {
    console.log(`    Failure rate:         ${chalk.red(data.failureRateWithout.toFixed(1))}/session ${chalk.dim('\u2192')} ${chalk.green(data.failureRateWith.toFixed(1))}/session with learnings`);
    if (data.failureRateImprovement !== null && data.failureRateImprovement > 0) {
      console.log(`    Improvement:          ${chalk.green(`${data.failureRateImprovement}%`)} fewer failures`);
    }
  }

  if (data.totalWasteTokens > 0 || data.estimatedSavingsTokens > 0) {
    console.log(chalk.bold('\n  Efficiency'));
    if (data.totalWasteTokens > 0) {
      console.log(`    Waste captured:       ${chalk.cyan(data.totalWasteTokens.toLocaleString())} tokens`);
    }
    if (data.estimatedSavingsTokens > 0) {
      console.log(`    Estimated savings:    ~${chalk.green(data.estimatedSavingsTokens.toLocaleString())} tokens`);
    }
    if (data.estimatedSavingsSeconds > 0) {
      console.log(`    Time saved:           ~${chalk.green(formatDuration(data.estimatedSavingsSeconds))}`);
    }
  }

  console.log(chalk.bold('\n  Config Quality'));
  console.log(`    Score:                ${chalk.cyan(`${score.score}/100`)} (${score.grade})`);
  console.log('');
}

export async function insightsCommand(options: InsightsOptions) {
  const stats = readROIStats();
  const data = buildInsightsData(stats);
  const score = computeLocalScore(process.cwd(), readState()?.targetAgent);

  trackInsightsViewed(data.totalSessions, data.learningCount);

  if (options.json) {
    console.log(JSON.stringify({
      ...data,
      tier: data.totalSessions === 0 ? 'cold-start' : data.totalSessions < MIN_SESSIONS_FULL ? 'early' : 'full',
      configScore: score.score,
      configGrade: score.grade,
    }, null, 2));
    return;
  }

  if (data.totalSessions === 0) {
    displayColdStart(score);
  } else if (data.totalSessions < MIN_SESSIONS_FULL) {
    displayEarlyData(data, score);
  } else {
    displayFullInsights(data, score);
  }
}

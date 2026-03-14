import chalk from 'chalk';
import { computeLocalScore } from '../scoring/index.js';
import type { TargetAgent } from '../scoring/index.js';
import { displayScore } from '../scoring/display.js';
import { readState } from '../lib/state.js';
import { trackScoreComputed } from '../telemetry/events.js';

interface ScoreOptions {
  json?: boolean;
  quiet?: boolean;
  agent?: TargetAgent;
}

export async function scoreCommand(options: ScoreOptions) {
  const dir = process.cwd();
  const target = options.agent ?? readState()?.targetAgent;
  const result = computeLocalScore(dir, target);
  trackScoreComputed(result.score, target);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (options.quiet) {
    console.log(`${result.score}/100 (${result.grade})`);
    return;
  }

  displayScore(result);

  const separator = chalk.gray('  ' + '─'.repeat(53));
  console.log(separator);

  if (result.score < 40) {
    console.log(chalk.gray('  Run ') + chalk.hex('#83D1EB')('caliber onboard') + chalk.gray(' to generate a complete, optimized setup.'));
  } else if (result.score < 70) {
    console.log(chalk.gray('  Run ') + chalk.hex('#83D1EB')('caliber onboard') + chalk.gray(' to improve your setup.'));
  } else {
    console.log(chalk.green('  Looking good!') + chalk.gray(' Run ') + chalk.hex('#83D1EB')('caliber regenerate') + chalk.gray(' to rebuild from scratch.'));
  }
  console.log('');
}

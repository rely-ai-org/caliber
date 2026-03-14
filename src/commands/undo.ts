import chalk from 'chalk';
import ora from 'ora';
import { undoSetup } from '../writers/index.js';
import { trackUndoExecuted } from '../telemetry/events.js';

export function undoCommand() {
  const spinner = ora('Reverting setup...').start();

  try {
    const { restored, removed } = undoSetup();

    if (restored.length === 0 && removed.length === 0) {
      spinner.info('Nothing to undo.');
      return;
    }

    trackUndoExecuted();
    spinner.succeed('Setup reverted successfully.\n');

    if (restored.length > 0) {
      console.log(chalk.cyan('  Restored from backup:'));
      for (const file of restored) {
        console.log(`    ${chalk.green('↩')} ${file}`);
      }
    }

    if (removed.length > 0) {
      console.log(chalk.cyan('  Removed:'));
      for (const file of removed) {
        console.log(`    ${chalk.red('✗')} ${file}`);
      }
    }

    console.log('');
  } catch (err) {
    spinner.fail(chalk.red(err instanceof Error ? err.message : 'Undo failed'));
    throw new Error('__exit__');
  }
}

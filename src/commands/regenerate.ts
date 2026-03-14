import chalk from 'chalk';
import ora from 'ora';
import select from '@inquirer/select';
import { collectFingerprint } from '../fingerprint/index.js';
import { generateSetup } from '../ai/generate.js';
import { writeSetup, undoSetup } from '../writers/index.js';
import { stageFiles, cleanupStaging } from '../writers/staging.js';
import { promptWantsReview, promptReviewMethod, openReview } from '../utils/review.js';
import { readManifest } from '../writers/manifest.js';
import { loadConfig } from '../llm/config.js';
import { validateModel } from '../llm/index.js';
import { readState, writeState, getCurrentHeadSha } from '../lib/state.js';
import { computeLocalScore } from '../scoring/index.js';
import { displayScoreSummary, displayScoreDelta } from '../scoring/display.js';
import { SpinnerMessages, GENERATION_MESSAGES } from '../utils/spinner-messages.js';
import { collectSetupFiles } from './setup-files.js';
import { trackRegenerateCompleted } from '../telemetry/events.js';

export async function regenerateCommand(options: { dryRun?: boolean }) {
  const config = loadConfig();
  if (!config) {
    console.log(chalk.red('No LLM provider configured. Run ') + chalk.hex('#83D1EB')('caliber config') + chalk.red(' first.'));
    throw new Error('__exit__');
  }

  const manifest = readManifest();
  if (!manifest) {
    console.log(chalk.yellow('No existing setup found. Run ') + chalk.hex('#83D1EB')('caliber onboard') + chalk.yellow(' first.'));
    throw new Error('__exit__');
  }

  const targetAgent = readState()?.targetAgent ?? ['claude', 'cursor'];

  // Verify configured model is reachable before starting heavy work
  await validateModel({ fast: true });

  // 1. Fingerprint
  const spinner = ora('Analyzing project...').start();
  const fingerprint = await collectFingerprint(process.cwd());
  spinner.succeed('Project analyzed');

  // 2. Baseline score
  const baselineScore = computeLocalScore(process.cwd(), targetAgent);
  displayScoreSummary(baselineScore);

  if (baselineScore.score === 100) {
    console.log(chalk.green('  Your setup is already at 100/100 — nothing to regenerate.\n'));
    return;
  }

  // 3. Generate
  const genSpinner = ora('Regenerating setup...').start();
  const genMessages = new SpinnerMessages(genSpinner, GENERATION_MESSAGES, { showElapsedTime: true });
  genMessages.start();

  let generatedSetup: Record<string, unknown> | null = null;

  try {
    const result = await generateSetup(
      fingerprint,
      targetAgent,
      undefined,
      {
        onStatus: (status) => { genMessages.handleServerStatus(status); },
        onComplete: (setup) => { generatedSetup = setup; },
        onError: (error) => {
          genMessages.stop();
          genSpinner.fail(`Generation error: ${error}`);
        },
      }
    );

    if (!generatedSetup) generatedSetup = result.setup;
  } catch (err) {
    genMessages.stop();
    const msg = err instanceof Error ? err.message : 'Unknown error';
    genSpinner.fail(`Regeneration failed: ${msg}`);
    throw new Error('__exit__');
  }

  genMessages.stop();

  if (!generatedSetup) {
    genSpinner.fail('Failed to regenerate setup.');
    throw new Error('__exit__');
  }

  genSpinner.succeed('Setup regenerated');

  // 4. Diff review
  const setupFiles = collectSetupFiles(generatedSetup);
  const staged = stageFiles(setupFiles, process.cwd());
  const totalChanges = staged.newFiles + staged.modifiedFiles;

  console.log(chalk.dim(`\n  ${chalk.green(`${staged.newFiles} new`)} / ${chalk.yellow(`${staged.modifiedFiles} modified`)} file${totalChanges !== 1 ? 's' : ''}\n`));

  if (totalChanges === 0) {
    console.log(chalk.dim('  No changes needed — your configs are already up to date.\n'));
    cleanupStaging();
    return;
  }

  if (options.dryRun) {
    console.log(chalk.yellow('[Dry run] Would write:'));
    for (const f of staged.stagedFiles) {
      console.log(`  ${f.isNew ? chalk.green('+') : chalk.yellow('~')} ${f.relativePath}`);
    }
    cleanupStaging();
    return;
  }

  const wantsReview = await promptWantsReview();
  if (wantsReview) {
    const reviewMethod = await promptReviewMethod();
    await openReview(reviewMethod, staged.stagedFiles);
  }

  const action = await select({
    message: 'Apply regenerated setup?',
    choices: [
      { name: 'Accept and apply', value: 'accept' as const },
      { name: 'Decline', value: 'decline' as const },
    ],
  });

  cleanupStaging();

  if (action === 'decline') {
    console.log(chalk.dim('Regeneration cancelled. No files were modified.'));
    return;
  }

  // 5. Write
  const writeSpinner = ora('Writing config files...').start();
  try {
    const result = writeSetup(generatedSetup as unknown as Parameters<typeof writeSetup>[0]);
    writeSpinner.succeed('Config files written');

    for (const file of result.written) {
      console.log(`  ${chalk.green('✓')} ${file}`);
    }
    if (result.deleted.length > 0) {
      for (const file of result.deleted) {
        console.log(`  ${chalk.red('✗')} ${file}`);
      }
    }
    if (result.backupDir) {
      console.log(chalk.dim(`\n  Backups saved to ${result.backupDir}`));
    }
  } catch (err) {
    writeSpinner.fail('Failed to write files');
    console.error(chalk.red(err instanceof Error ? err.message : 'Unknown error'));
    throw new Error('__exit__');
  }

  // Update state
  const sha = getCurrentHeadSha();
  writeState({
    lastRefreshSha: sha ?? '',
    lastRefreshTimestamp: new Date().toISOString(),
    targetAgent,
  });

  // 6. Score delta + regression guard
  const afterScore = computeLocalScore(process.cwd(), targetAgent);

  if (afterScore.score < baselineScore.score) {
    console.log('');
    console.log(chalk.yellow(`  Score would drop from ${baselineScore.score} to ${afterScore.score} — reverting changes.`));
    try {
      const { restored, removed } = undoSetup();
      if (restored.length > 0 || removed.length > 0) {
        console.log(chalk.dim(`  Reverted ${restored.length + removed.length} file${restored.length + removed.length === 1 ? '' : 's'} from backup.`));
      }
    } catch { /* best effort */ }
    console.log(chalk.dim('  Run ') + chalk.hex('#83D1EB')('caliber onboard --force') + chalk.dim(' to override.\n'));
    return;
  }

  displayScoreDelta(baselineScore, afterScore);

  trackRegenerateCompleted(action, Date.now());
  console.log(chalk.bold.green('  Regeneration complete!'));
  console.log(chalk.dim('  Run ') + chalk.hex('#83D1EB')('caliber undo') + chalk.dim(' to revert changes.\n'));
}

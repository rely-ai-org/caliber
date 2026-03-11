import chalk from 'chalk';
import ora from 'ora';
import confirm from '@inquirer/confirm';
import { collectFingerprint } from '../fingerprint/index.js';
import { generateSetup } from '../ai/generate.js';
import { writeSetup } from '../writers/index.js';
import { readManifest } from '../writers/manifest.js';
import { loadConfig } from '../llm/config.js';
import { readState } from '../lib/state.js';
import { SpinnerMessages, GENERATION_MESSAGES } from '../utils/spinner-messages.js';

export async function regenerateCommand(options: { dryRun?: boolean }) {
  const config = loadConfig();
  if (!config) {
    console.log(chalk.red('No LLM provider configured. Run `caliber config` or set ANTHROPIC_API_KEY.'));
    throw new Error('__exit__');
  }

  const manifest = readManifest();
  if (!manifest) {
    console.log(chalk.yellow('No existing setup found. Run `caliber init` first.'));
    throw new Error('__exit__');
  }

  const spinner = ora('Re-analyzing project...').start();
  const fingerprint = collectFingerprint(process.cwd());
  spinner.succeed('Project re-analyzed');

  const genSpinner = ora('Regenerating setup...').start();
  const genMessages = new SpinnerMessages(genSpinner, GENERATION_MESSAGES);
  genMessages.start();

  let generatedSetup: Record<string, unknown> | null = null;

  try {
    const targetAgent = readState()?.targetAgent ?? 'both';
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

  if (options.dryRun) {
    console.log(chalk.yellow('\n[Dry run] Would write:'));
    console.log(JSON.stringify(generatedSetup, null, 2));
    return;
  }

  const shouldApply = await confirm({ message: 'Apply regenerated setup?', default: true });
  if (!shouldApply) {
    console.log(chalk.dim('Regeneration cancelled.'));
    return;
  }

  const writeSpinner = ora('Updating config files...').start();
  const result = writeSetup(generatedSetup as unknown as Parameters<typeof writeSetup>[0]);
  writeSpinner.succeed('Config files updated');

  for (const file of result.written) {
    console.log(`  ${chalk.green('✓')} ${file}`);
  }
  console.log('');
}

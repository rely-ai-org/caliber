import chalk from 'chalk';
import fs from 'fs';
import { readManifest } from '../writers/manifest.js';
import { loadConfig } from '../llm/config.js';

export async function statusCommand(options: { json?: boolean }) {
  const config = loadConfig();
  const manifest = readManifest();

  if (options.json) {
    console.log(JSON.stringify({
      configured: !!config,
      provider: config?.provider,
      model: config?.model,
      manifest: manifest,
    }, null, 2));
    return;
  }

  console.log(chalk.bold('\nCaliber Status\n'));

  if (config) {
    console.log(`  LLM: ${chalk.green(config.provider)} (${config.model})`);
  } else {
    console.log(`  LLM: ${chalk.yellow('Not configured')} — run ${chalk.hex('#83D1EB')('caliber config')}`);
  }

  if (!manifest) {
    console.log(`  Setup: ${chalk.dim('No setup applied')}`);
    console.log(chalk.dim('\n  Run ') + chalk.hex('#83D1EB')('caliber init') + chalk.dim(' to get started.\n'));
    return;
  }

  console.log(`  Files managed: ${chalk.cyan(manifest.entries.length.toString())}`);
  for (const entry of manifest.entries) {
    const exists = fs.existsSync(entry.path);
    const icon = exists ? chalk.green('✓') : chalk.red('✗');
    console.log(`    ${icon} ${entry.path} (${entry.action})`);
  }

  console.log('');
}

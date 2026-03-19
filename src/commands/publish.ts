import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { collectFingerprint } from '../fingerprint/index.js';
import { loadConfig } from '../llm/config.js';
import { readFileOrNull } from '../scoring/utils.js';

export async function publishCommand() {
  const dir = process.cwd();

  const config = loadConfig();
  if (!config) {
    console.log(chalk.red('No LLM provider configured. Run ') + chalk.hex('#83D1EB')('caliber config') + chalk.red(' first.'));
    throw new Error('__exit__');
  }

  const spinner = ora('Generating project summary...').start();

  try {
    const fingerprint = await collectFingerprint(dir);

    const claudeMd = readFileOrNull(path.join(dir, 'CLAUDE.md'));

    const topLevelDirs = fingerprint.fileTree
      .filter((f) => f.endsWith('/') && !f.includes('/'))
      .map((f) => f.replace(/\/$/, ''));

    const summary: Record<string, unknown> = {
      name: fingerprint.packageName || path.basename(dir),
      version: '1.0.0',
      description: fingerprint.description || '',
      languages: fingerprint.languages,
      frameworks: fingerprint.frameworks,
      tools: fingerprint.tools,
      topLevelDirs,
    };

    if (claudeMd) {
      // Extract key conventions from CLAUDE.md (first 2000 chars)
      summary.conventions = claudeMd.slice(0, 2000);
    }

    try {
      const pkgContent = readFileOrNull(path.join(dir, 'package.json'));
      if (pkgContent) {
        const pkg = JSON.parse(pkgContent);
        if (pkg.scripts) {
          const commands: Record<string, string> = {};
          for (const key of ['test', 'build', 'dev', 'lint', 'start'] as const) {
            if (pkg.scripts[key]) commands[key] = `npm run ${key}`;
          }
          if (Object.keys(commands).length > 0) summary.commands = commands;
        }
      }
    } catch { /* skip */ }

    const outputDir = path.join(dir, '.caliber');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'summary.json');
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

    spinner.succeed('Project summary published');
    console.log(`  ${chalk.green('✓')} ${path.relative(dir, outputPath)}`);
    console.log(chalk.dim('\n  Other projects can now reference this repo as a source.'));
    console.log(chalk.dim('  When they run `caliber init`, they\'ll read this summary automatically.\n'));
  } catch (err) {
    spinner.fail('Failed to generate summary');
    if (err instanceof Error && err.message === '__exit__') throw err;
    console.error(chalk.red(err instanceof Error ? err.message : 'Unknown error'));
    throw new Error('__exit__');
  }
}

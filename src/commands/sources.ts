import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  loadSourcesConfig,
  writeSourcesConfig,
  isInsideDir,
  detectSourceType,
  type SourceConfig,
} from '../fingerprint/sources.js';
import { getDetectedWorkspaces } from '../fingerprint/cache.js';
import { promptInput } from '../utils/prompt.js';

export async function sourcesListCommand() {
  const dir = process.cwd();
  const configSources = loadSourcesConfig(dir);
  const workspaces = getDetectedWorkspaces(dir);

  if (configSources.length === 0 && workspaces.length === 0) {
    console.log(chalk.dim('\n  No sources configured.\n'));
    console.log(chalk.dim('  Add a source: ') + chalk.hex('#83D1EB')('caliber sources add <path>'));
    console.log(chalk.dim('  Or add to .caliber/sources.json manually.\n'));
    return;
  }

  console.log(chalk.bold('\n  External Sources\n'));

  if (configSources.length > 0) {
    for (const source of configSources) {
      const sourcePath = source.path || source.url || '';
      const exists = source.path ? fs.existsSync(path.resolve(dir, source.path)) : false;
      const status = exists ? chalk.green('reachable') : chalk.red('not found');
      const hasSummary = source.path && fs.existsSync(path.join(path.resolve(dir, source.path), '.caliber', 'summary.json'));

      console.log(`  ${chalk.bold(source.role || source.type)}  ${chalk.dim(sourcePath)}`);
      console.log(`    Type: ${source.type}  Status: ${status}${hasSummary ? '  ' + chalk.cyan('has summary.json') : ''}`);
      if (source.description) console.log(`    ${chalk.dim(source.description)}`);
      console.log('');
    }
  }

  if (workspaces.length > 0) {
    console.log(chalk.dim('  Auto-detected workspaces:'));
    for (const ws of workspaces) {
      const exists = fs.existsSync(path.resolve(dir, ws));
      console.log(`    ${exists ? chalk.green('●') : chalk.red('●')} ${ws}`);
    }
    console.log('');
  }
}

export async function sourcesAddCommand(sourcePath: string) {
  const dir = process.cwd();
  const absPath = path.resolve(dir, sourcePath);

  if (!fs.existsSync(absPath)) {
    console.log(chalk.red(`\n  Path not found: ${sourcePath}\n`));
    throw new Error('__exit__');
  }

  const type = detectSourceType(absPath);

  if (isInsideDir(absPath, dir)) {
    console.log(chalk.red(`\n  Cannot add a path inside the current project as a source.\n`));
    throw new Error('__exit__');
  }

  const existing = loadSourcesConfig(dir);
  const alreadyConfigured = existing.some(
    (s) => s.path && path.resolve(dir, s.path) === absPath,
  );
  if (alreadyConfigured) {
    console.log(chalk.yellow(`\n  Already configured: ${sourcePath}\n`));
    return;
  }

  const defaultRole = type === 'repo' ? 'related-repo' : 'reference-doc';
  const roleInput = await promptInput(`Role (e.g., shared-library, deployment) [${defaultRole}]:`);
  const role = roleInput || defaultRole;

  const description = await promptInput('Brief description (optional):');

  const newSource: SourceConfig = {
    type,
    path: sourcePath,
    role,
    ...(description ? { description } : {}),
  };

  existing.push(newSource);
  writeSourcesConfig(dir, existing);

  console.log(chalk.green(`\n  ✓ Added ${sourcePath} as ${type} source (${role})\n`));
}

export async function sourcesRemoveCommand(name: string) {
  const dir = process.cwd();
  const existing = loadSourcesConfig(dir);

  const idx = existing.findIndex(
    (s) => s.path?.includes(name) || s.role === name,
  );

  if (idx === -1) {
    console.log(chalk.red(`\n  Source not found: ${name}\n`));
    console.log(chalk.dim('  Available sources:'));
    for (const s of existing) {
      console.log(chalk.dim(`    ${s.path || s.url} (${s.role || s.type})`));
    }
    throw new Error('__exit__');
  }

  const removed = existing.splice(idx, 1)[0];
  writeSourcesConfig(dir, existing);
  console.log(chalk.green(`\n  ✓ Removed ${removed.path || removed.url} (${removed.role || removed.type})\n`));
}

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initCommand } from './commands/onboard.js';
import { undoCommand } from './commands/undo.js';
import { statusCommand } from './commands/status.js';
import { regenerateCommand } from './commands/regenerate.js';
import { recommendCommand } from './commands/recommend.js';
import { scoreCommand } from './commands/score.js';
import { refreshCommand } from './commands/refresh.js';
import { hooksCommand } from './commands/hooks.js';
import { configCommand } from './commands/config.js';
import {
  learnObserveCommand,
  learnFinalizeCommand,
  learnInstallCommand,
  learnRemoveCommand,
  learnStatusCommand,
} from './commands/learn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')
);

const program = new Command();

const displayVersion = process.env.CALIBER_LOCAL ? `${pkg.version}-local` : pkg.version;

program
  .name(process.env.CALIBER_LOCAL ? 'caloc' : 'caliber')
  .description('Configure your coding agent environment')
  .version(displayVersion);

function parseAgentOption(value: string): ('claude' | 'cursor' | 'codex')[] {
  if (value === 'both') return ['claude', 'cursor'];
  if (value === 'all') return ['claude', 'cursor', 'codex'];
  const valid = ['claude', 'cursor', 'codex'];
  const agents = [...new Set(value.split(',').map(s => s.trim().toLowerCase()).filter(a => valid.includes(a)))];
  if (agents.length === 0) {
    console.error(`Invalid agent "${value}". Choose from: claude, cursor, codex (comma-separated for multiple)`);
    process.exit(1);
  }
  return agents as ('claude' | 'cursor' | 'codex')[];
}

program
  .command('onboard')
  .alias('init')
  .description('Onboard your project for AI-assisted development')
  .option('--agent <type>', 'Target agents (comma-separated): claude, cursor, codex', parseAgentOption)
  .option('--dry-run', 'Preview changes without writing files')
  .option('--force', 'Overwrite existing setup without prompting')
  .action(initCommand);

program
  .command('undo')
  .description('Revert all config changes made by Caliber')
  .action(undoCommand);

program
  .command('status')
  .description('Show current Caliber setup status')
  .option('--json', 'Output as JSON')
  .action(statusCommand);

program
  .command('regenerate')
  .alias('regen')
  .alias('re')
  .description('Re-analyze project and regenerate setup')
  .option('--dry-run', 'Preview changes without writing files')
  .action(regenerateCommand);

program
  .command('config')
  .description('Configure LLM provider, API key, and model')
  .action(configCommand);

program
  .command('skills')
  .description('Discover and install community skills for your project')
  .action(recommendCommand);

program
  .command('score')
  .description('Score your current agent config setup (deterministic, no network)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'One-line output for scripts/hooks')
  .option('--agent <type>', 'Target agents (comma-separated): claude, cursor, codex', parseAgentOption)
  .action(scoreCommand);

program
  .command('refresh')
  .description('Update docs based on recent code changes')
  .option('--quiet', 'Suppress output (for use in hooks)')
  .option('--dry-run', 'Preview changes without writing files')
  .action(refreshCommand);

program
  .command('hooks')
  .description('Manage auto-refresh hooks (toggle interactively)')
  .option('--install', 'Enable all hooks non-interactively')
  .option('--remove', 'Disable all hooks non-interactively')
  .action(hooksCommand);

// [In Development] Session learning — not yet ready for public use.
// The command is functional but hidden from help output.
const learn = program
  .command('learn', { hidden: true })
  .description('[dev] Session learning — observe tool usage and extract reusable instructions');

learn
  .command('observe')
  .description('Record a tool event from stdin (called by hooks)')
  .option('--failure', 'Mark event as a tool failure')
  .action(learnObserveCommand);

learn
  .command('finalize')
  .description('Analyze session events and update CLAUDE.md (called on SessionEnd)')
  .action(learnFinalizeCommand);

learn
  .command('install')
  .description('Install learning hooks into .claude/settings.json')
  .action(learnInstallCommand);

learn
  .command('remove')
  .description('Remove learning hooks from .claude/settings.json')
  .action(learnRemoveCommand);

learn
  .command('status')
  .description('Show learning system status')
  .action(learnStatusCommand);

export { program };

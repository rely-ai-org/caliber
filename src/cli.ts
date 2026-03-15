import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initCommand } from './commands/init.js';
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
import { setTelemetryDisabled } from './telemetry/config.js';
import { initTelemetry, trackEvent } from './telemetry/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8')
);

const program = new Command();

const displayVersion = process.env.CALIBER_LOCAL ? `${pkg.version}-local` : pkg.version;

program
  .name(process.env.CALIBER_LOCAL ? 'caloc' : 'caliber')
  .description('Configure your coding agent environment')
  .version(displayVersion)
  .option('--no-traces', 'Disable anonymous telemetry for this run');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tracked<T extends (...args: any[]) => any>(commandName: string, handler: T): T {
  const wrapper = async (...args: Parameters<T>) => {
    const start = Date.now();
    trackEvent('command_started', {
      command: commandName,
      cli_version: pkg.version,
    });
    try {
      await handler(...args);
      trackEvent('command_completed', {
        command: commandName,
        duration_ms: Date.now() - start,
        success: true,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorType = err instanceof Error ? err.constructor.name : typeof err;
      if (errorMessage !== '__exit__') {
        trackEvent('command_error', {
          command: commandName,
          error_type: errorType,
          error_message: errorMessage,
        });
      }
      trackEvent('command_completed', {
        command: commandName,
        duration_ms: Date.now() - start,
        success: false,
      });
      throw err;
    }
  };
  return wrapper as unknown as T;
}

program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals();
  if (opts.traces === false) {
    setTelemetryDisabled(true);
  }
  initTelemetry();
});

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
  .command('init')
  .description('Initialize your project for AI-assisted development')
  .option('--agent <type>', 'Target agents (comma-separated): claude, cursor, codex', parseAgentOption)
  .option('--dry-run', 'Preview changes without writing files')
  .option('--force', 'Overwrite existing setup without prompting')
  .option('--debug-report', undefined, false)
  .action(tracked('init', initCommand));

program
  .command('undo')
  .description('Revert all config changes made by Caliber')
  .action(tracked('undo', undoCommand));

program
  .command('status')
  .description('Show current Caliber setup status')
  .option('--json', 'Output as JSON')
  .action(tracked('status', statusCommand));

program
  .command('regenerate')
  .alias('regen')
  .alias('re')
  .description('Re-analyze project and regenerate setup')
  .option('--dry-run', 'Preview changes without writing files')
  .action(tracked('regenerate', regenerateCommand));

program
  .command('config')
  .description('Configure LLM provider, API key, and model')
  .action(tracked('config', configCommand));

program
  .command('skills')
  .description('Discover and install community skills for your project')
  .action(tracked('skills', recommendCommand));

program
  .command('score')
  .description('Score your current agent config setup (deterministic, no network)')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'One-line output for scripts/hooks')
  .option('--agent <type>', 'Target agents (comma-separated): claude, cursor, codex', parseAgentOption)
  .action(tracked('score', scoreCommand));

program
  .command('refresh')
  .description('Update docs based on recent code changes')
  .option('--quiet', 'Suppress output (for use in hooks)')
  .option('--dry-run', 'Preview changes without writing files')
  .action(tracked('refresh', refreshCommand));

program
  .command('hooks')
  .description('Manage auto-refresh hooks (toggle interactively)')
  .option('--install', 'Enable all hooks non-interactively')
  .option('--remove', 'Disable all hooks non-interactively')
  .action(tracked('hooks', hooksCommand));

// [In Development] Session learning — not yet ready for public use.
// The command is functional but hidden from help output.
const learn = program
  .command('learn', { hidden: true })
  .description('[dev] Session learning — observe tool usage and extract reusable instructions');

learn
  .command('observe')
  .description('Record a tool event from stdin (called by hooks)')
  .option('--failure', 'Mark event as a tool failure')
  .action(tracked('learn:observe', learnObserveCommand));

learn
  .command('finalize')
  .description('Analyze session events and update CLAUDE.md (called on SessionEnd)')
  .action(tracked('learn:finalize', learnFinalizeCommand));

learn
  .command('install')
  .description('Install learning hooks into .claude/settings.json')
  .action(tracked('learn:install', learnInstallCommand));

learn
  .command('remove')
  .description('Remove learning hooks from .claude/settings.json')
  .action(tracked('learn:remove', learnRemoveCommand));

learn
  .command('status')
  .description('Show learning system status')
  .action(tracked('learn:status', learnStatusCommand));

export { program };

import chalk from 'chalk';
import fs from 'fs';
import {
  isHookInstalled, installHook, removeHook,
  isPreCommitHookInstalled, installPreCommitHook, removePreCommitHook,
} from '../lib/hooks.js';
import {
  installLearningHooks,
  installCursorLearningHooks,
} from '../lib/learning-hooks.js';

interface HookDef {
  id: string;
  label: string;
  description: string;
  isInstalled: () => boolean;
  install: () => { installed: boolean; alreadyInstalled: boolean };
  remove: () => { removed: boolean; notFound: boolean };
}

const HOOKS: HookDef[] = [
  {
    id: 'session-end',
    label: 'Claude Code SessionEnd',
    description: 'Auto-refresh CLAUDE.md when a Claude Code session ends',
    isInstalled: isHookInstalled,
    install: installHook,
    remove: removeHook,
  },
  {
    id: 'pre-commit',
    label: 'Git pre-commit',
    description: 'Auto-refresh CLAUDE.md before each git commit',
    isInstalled: isPreCommitHookInstalled,
    install: installPreCommitHook,
    remove: removePreCommitHook,
  },
];

function printStatus() {
  console.log(chalk.bold('\n  Hooks\n'));
  for (const hook of HOOKS) {
    const installed = hook.isInstalled();
    const icon = installed ? chalk.green('✓') : chalk.dim('✗');
    const state = installed ? chalk.green('enabled') : chalk.dim('disabled');
    console.log(`  ${icon} ${hook.label.padEnd(26)} ${state}`);
    console.log(chalk.dim(`    ${hook.description}`));
  }
  console.log('');
}

// --- Interactive mode (default when running `caliber hooks`) ---

export async function hooksCommand(options: { install?: boolean; remove?: boolean }) {
  if (options.install) {
    for (const hook of HOOKS) {
      const result = hook.install();
      if (result.alreadyInstalled) {
        console.log(chalk.dim(`  ${hook.label} already enabled.`));
      } else {
        console.log(chalk.green('  ✓') + ` ${hook.label} enabled`);
      }
    }
    // Also install learning hooks alongside refresh hooks
    if (fs.existsSync('.claude')) {
      const r = installLearningHooks();
      if (r.installed) console.log(chalk.green('  ✓') + ' Claude Code learning hooks enabled');
    }
    if (fs.existsSync('.cursor')) {
      const r = installCursorLearningHooks();
      if (r.installed) console.log(chalk.green('  ✓') + ' Cursor learning hooks enabled');
    }
    return;
  }

  if (options.remove) {
    for (const hook of HOOKS) {
      const result = hook.remove();
      if (result.notFound) {
        console.log(chalk.dim(`  ${hook.label} already disabled.`));
      } else {
        console.log(chalk.green('  ✓') + ` ${hook.label} removed`);
      }
    }
    return;
  }

  // Interactive toggle UI
  if (!process.stdin.isTTY) {
    printStatus();
    return;
  }

  const { stdin, stdout } = process;
  let cursor = 0;
  let lineCount = 0;

  // Snapshot current state into a mutable array
  const states = HOOKS.map(h => h.isInstalled());

  function render(): string {
    const lines: string[] = [];
    lines.push(chalk.bold('  Hooks'));
    lines.push('');

    for (let i = 0; i < HOOKS.length; i++) {
      const hook = HOOKS[i];
      const enabled = states[i];
      const toggle = enabled ? chalk.green('[on] ') : chalk.dim('[off]');
      const ptr = i === cursor ? chalk.cyan('>') : ' ';
      lines.push(`  ${ptr} ${toggle} ${hook.label}`);
      lines.push(chalk.dim(`        ${hook.description}`));
    }

    lines.push('');
    lines.push(chalk.dim('  ↑↓ navigate  ⎵ toggle  a all on  n all off  ⏎ apply  q cancel'));
    return lines.join('\n');
  }

  function draw(initial: boolean) {
    if (!initial && lineCount > 0) {
      stdout.write(`\x1b[${lineCount}A`);
    }
    stdout.write('\x1b[0J');
    const output = render();
    stdout.write(output + '\n');
    lineCount = output.split('\n').length;
  }

  return new Promise<void>((resolve) => {
    console.log('');
    draw(true);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function apply() {
      let changed = 0;
      for (let i = 0; i < HOOKS.length; i++) {
        const hook = HOOKS[i];
        const wasInstalled = hook.isInstalled();
        const wantEnabled = states[i];

        if (wantEnabled && !wasInstalled) {
          hook.install();
          console.log(chalk.green('  ✓') + ` ${hook.label} enabled`);
          changed++;
        } else if (!wantEnabled && wasInstalled) {
          hook.remove();
          console.log(chalk.green('  ✓') + ` ${hook.label} disabled`);
          changed++;
        }
      }
      if (changed === 0) {
        console.log(chalk.dim('  No changes.'));
      }
      console.log('');
    }

    function onData(key: string) {
      switch (key) {
        case '\x1b[A':
          cursor = (cursor - 1 + HOOKS.length) % HOOKS.length;
          draw(false);
          break;
        case '\x1b[B':
          cursor = (cursor + 1) % HOOKS.length;
          draw(false);
          break;
        case ' ':
          states[cursor] = !states[cursor];
          draw(false);
          break;
        case 'a':
          states.fill(true);
          draw(false);
          break;
        case 'n':
          states.fill(false);
          draw(false);
          break;
        case '\r':
        case '\n':
          cleanup();
          apply();
          resolve();
          break;
        case 'q':
        case '\x1b':
        case '\x03':
          cleanup();
          console.log(chalk.dim('\n  Cancelled.\n'));
          resolve();
          break;
      }
    }

    stdin.on('data', onData);
  });
}

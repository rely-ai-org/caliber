---
name: adding-a-command
description: Creates a new CLI command following caliber's pattern: file in src/commands/, export async function, register in src/cli.ts with tracked(), use ora spinners, throw __exit__ on user-facing failures. Use when user says 'add command', 'new subcommand', 'create CLI action', or adds files to src/commands/. Do NOT use for modifying existing commands.
---
# Adding a Command

## Critical

1. **Command file location**: Create `src/commands/<name>.ts` (use actual command name, not placeholder)
2. **CLI registration**: Add command to `src/cli.ts` using `.command()` with `tracked()` wrapper for telemetry
3. **Error handling**: User-facing errors MUST use `throw new Error('__exit__: message')` pattern; all other errors propagate to telemetry
4. **Spinner usage**: Use `ora` spinner for status updates — call `spinner.start()`, then `spinner.succeed()` or `spinner.fail()`
5. **Named exports only**: Command functions use named exports, not default exports

## Instructions

1. **Create command file** at `src/commands/<name>.ts` (replace `<name>` with your command name)

```typescript
import ora from 'ora';

export async function myCommand(options: { strict?: boolean } = {}): Promise<void> {
  const spinner = ora();
  try {
    spinner.start('Performing action...');
    // Implementation here
    spinner.succeed('Action complete');
  } catch (error) {
    spinner.fail('Action failed');
    throw error;
  }
}
```

2. **Register in `src/cli.ts`**

```typescript
import { myCommand } from './commands/my-command.js';

program
  .command('my-command')
  .description('Brief description of the command')
  .option('--strict', 'Fail on warnings')
  .action(tracked(async (options) => {
    await myCommand(options);
  }));
```

3. **Add tests** colocated with source (e.g., `src/commands/score.ts` → tests alongside it)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { myCommand } from '../my-command.js';

vi.mock('ora', () => ({
  default: vi.fn(() => ({ start: vi.fn(), succeed: vi.fn(), fail: vi.fn() })),
}));

describe('myCommand', () => {
  it('succeeds on valid input', async () => {
    await expect(myCommand()).resolves.toBeUndefined();
  });

  it('throws on invalid input with strict mode', async () => {
    await expect(myCommand({ strict: true })).rejects.toThrow();
  });
});
```

4. **Build and validate**

```bash
npm run build
node dist/bin.js my-command --help
npm run test
```

## Common Issues

**Command not in `caliber --help`**
- Verify `.command('my-command')` and `.action(tracked(...))` are chained in `src/cli.ts`
- Run `npm run build` to recompile

**Import errors at runtime**
- In `src/cli.ts`, imports must use `.js` extension: `import { myCommand } from './commands/my-command.js'`

**Telemetry not recording**
- Ensure handler is wrapped: `.action(tracked('my-command', async (options) => { ... }))`

**Spinner shows wrong status**
- Create new `ora()` instance per command; don't reuse across try/catch boundaries

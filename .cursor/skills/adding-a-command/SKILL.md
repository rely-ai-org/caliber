---
name: adding-a-command
description: Creates a new CLI command following caliber's pattern: file in src/commands/, export async function, register in src/cli.ts with tracked(), use ora spinners, throw __exit__ on user-facing failures. Use when user says 'add command', 'new subcommand', 'create CLI action', or adds files to src/commands/. Do NOT use for modifying existing commands.
---
# Adding a Command

## Critical

1. **Every command MUST be wrapped with `tracked()`** in `src/cli.ts`. This enables telemetry. Verify the command exports are named exports before registering.
2. **User-facing errors MUST throw `__exit__`** (not Error). This prevents stack traces. Example: `throw __exit__("Project not initialized. Run: caliber init")`.
3. **All long-running operations MUST use `ora` spinners**. Never skip spinner.start() / spinner.succeed() / spinner.fail(). See `src/commands/init.ts` for exact pattern.
4. **Commands MUST match the existing file structure**: `src/commands/COMMAND_NAME.ts` with `export async function COMMAND_NAME(options: ...)`. No default exports.

## Instructions

1. **Create the command file** at `src/commands/COMMAND_NAME.ts` with this boilerplate:
   ```typescript
   import ora from 'ora';
   import { __exit__ } from '../lib/exit.js';
   
   export async function COMMAND_NAME(options: {
     // Define options matching Command builder pattern
   }): Promise<void> {
     const spinner = ora();
     
     try {
       spinner.start('Performing action...');
       // Implementation
       spinner.succeed('Action completed');
     } catch (error) {
       spinner.fail('Action failed');
       if (error instanceof Error && error.message.includes('specific')) {
         throw __exit__('User-friendly message');
       }
       throw error;
     }
   }
   ```
   Verify: File created at correct path, function is async, options parameter defined, returns Promise<void>.

2. **Register the command in `src/cli.ts`**:
   - Import: `import { COMMAND_NAME } from './commands/COMMAND_NAME.js';`
   - Add command builder using Commander.js pattern (see `status`, `init`, `score` commands in file):
   ```typescript
   program
     .command('command-name')
     .description('Brief description')
     .option('-f, --flag <value>', 'Flag description')
     .action(tracked(async (options) => {
       await COMMAND_NAME(options);
     }));
   ```
   Verify: Import is present, command is wrapped with `tracked()`, options passed to function match.

3. **Add tests in `src/commands/__tests__/COMMAND_NAME.test.ts`**:
   - Use Vitest pattern from existing tests (e.g., `init.test.ts`).
   - Mock `ora` using: `vi.mock('ora', () => ({ default: vi.fn(() => mockSpinner) }))`.
   - Test success path and error cases (including `__exit__` throws).
   Verify: Test file created, mocks are in place, success and failure cases covered.

4. **Validate types** with `npx tsc --noEmit` and run tests with `npm run test`.
   Verify: No TypeScript errors, all tests passing.

## Examples

**User says:** "Add a 'validate' command that checks if the project is initialized and reports status."

**Actions taken:**
1. Create `src/commands/validate.ts`:
   ```typescript
   import ora from 'ora';
   import { __exit__ } from '../lib/exit.js';
   import { loadManifest } from '../writers/manifest.js';
   
   export async function validate(): Promise<void> {
     const spinner = ora();
     try {
       spinner.start('Validating project...');
       const manifest = await loadManifest();
       if (!manifest) {
         throw __exit__('No .caliber/manifest.json found. Run: caliber init');
       }
       spinner.succeed(`Project valid. Found ${Object.keys(manifest.rules || {}).length} rules.`);
     } catch (error) {
       spinner.fail('Validation failed');
       throw error;
     }
   }
   ```

2. Register in `src/cli.ts`:
   ```typescript
   import { validate } from './commands/validate.js';
   
   program
     .command('validate')
     .description('Validate the project configuration')
     .action(tracked(async () => {
       await validate();
     }));
   ```

3. Add test in `src/commands/__tests__/validate.test.ts` mocking `loadManifest` and `ora`.

**Result:** Command runs as `caliber validate`, shows spinner, throws __exit__ on missing manifest, tests pass.

## Common Issues

**Error: "Cannot find module './commands/COMMAND_NAME.js'"**
- **Fix:** Verify file is at `src/commands/COMMAND_NAME.ts` (exact spelling and case). Check import path in `src/cli.ts` includes `.js` extension (TS gets compiled to JS).

**Error: "Spinner is not defined" or "ora is not exported"**
- **Fix:** Ensure `import ora from 'ora'` is at top of file. Verify line: `const spinner = ora();` before calling `spinner.start()`.

**Error: "tracked is not a function"**
- **Fix:** In `src/cli.ts`, verify import: `import { tracked } from '../telemetry/tracked.js'`. Command must be wrapped: `.action(tracked(async (options) => { ... }))`.

**Error: "__exit__ is not exported"**
- **Fix:** Verify import in command file: `import { __exit__ } from '../lib/exit.js'`. Throw like: `throw __exit__("message")`, not `throw new Error(__exit__(...))`.

**Spinner shows wrong status after multiple operations**
- **Fix:** Create new spinner instance for each step: `spinner = ora()` before each `.start()`. Don't reuse across try/catch boundaries.

**Tests fail with "ora is not mocked"**
- **Fix:** Add to test file:
  ```typescript
  vi.mock('ora', () => ({
    default: vi.fn(() => ({ start: vi.fn(), succeed: vi.fn(), fail: vi.fn() })),
  }));
  ```
  before importing the command function.
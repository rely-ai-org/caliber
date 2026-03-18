---
name: adding-a-command
description: Add a new CLI command to @rely-ai/caliber. Creates files in src/commands/, registers with tracked() in src/cli.ts, wires llmCall/llmJsonCall from src/llm/index.ts, uses ora spinners and chalk for UX. Use when user says 'add command', 'new command', 'create subcommand', or creates files in src/commands/. Do NOT use for modifying scoring checks, fingerprinting logic, or LLM provider integration.
---
# Adding a Command

## Critical

- **Every command MUST call `tracked()`** wrapping the command definition in `src/cli.ts`. This is how telemetry and Cursor ACP integration work. Missing it breaks observability.
- **Commands MUST export a default async function** from `src/commands/{name}.ts` matching the signature: `(options: CommandOptions, logger?: Logger) => Promise<void>`.
- **Verify the command file exists and exports before registering in `src/cli.ts`** — TypeScript won't catch missing default exports at build time.
- **Use only `ora` for spinners and `chalk` for color** — these are the project standards. No `console.log()` for errors; use `throw new Error()` instead.

## Instructions

1. **Create the command file** at `src/commands/{command-name}.ts`.
   - Import: `import { tracked } from '../telemetry/index.js'`
   - Import: `import { llmCall, llmJsonCall } from '../llm/index.js'`
   - Import: `import ora from 'ora'`
   - Import: `import chalk from 'chalk'`
   - Export default async function with signature: `export default async function commandName(options: CommandOptions, logger?: Logger): Promise<void>`
   - Use `ora().start()` for spinners; call `.succeed()`, `.fail()`, or `.stop()` before returning.
   - Verify: Command file compiles with `npx tsc --noEmit`.

2. **Register the command in `src/cli.ts`**.
   - Import the command: `import commandName from './commands/{command-name}.js'`
   - Call `tracked()` wrapper: `tracked(program, 'command-name', (cmd) => { cmd.action(async (options) => { await commandName(options, logger); }); })`
   - Check exact pattern from existing commands (e.g., `src/commands/status.ts` and its registration in `src/cli.ts`).
   - Verify: Run `npm run build` without errors.

3. **Wire LLM calls if needed**.
   - For simple LLM generation (text): `const result = await llmCall(config, systemPrompt, userPrompt)`.
   - For JSON parsing: `const parsed = await llmJsonCall(config, systemPrompt, userPrompt, parseFunction)`.
   - Import `LLMConfig` from `src/llm/types.ts` and use `config: LLMConfig` parameter from `CommandOptions`.
   - Check `src/llm/index.ts` for retry logic and `TRANSIENT_ERRORS`; all errors bubble up automatically.
   - Verify: Test locally with `ANTHROPIC_API_KEY` set: `npm run build && npx caliber {command-name}`.

4. **Add tests** in `src/commands/__tests__/{command-name}.test.ts`.
   - Use Vitest: `import { describe, it, expect, vi } from 'vitest'`
   - Mock LLM: `vi.mock('../llm/index.js', () => ({ llmCall: vi.fn(), llmJsonCall: vi.fn() }))`
   - Test happy path, error handling, and spinner state.
   - Run: `npx vitest run src/commands/__tests__/{command-name}.test.ts`.

5. **Ensure tracked() wraps the entire action** so telemetry logs command name, success/failure, and duration.
   - Verify: Run command once; check `.caliber/manifest.json` has new event in `commands` array.

## Examples

**User says:** "Add a 'validate' command that checks if CLAUDE.md exists and scores the project."

**Actions:**

1. Create `src/commands/validate.ts`:
```typescript
import { promises as fs } from 'fs';
import path from 'path';
import ora from 'ora';
import chalk from 'chalk';
import { llmCall } from '../llm/index.js';
import { CommandOptions, Logger } from '../types/index.js';

export default async function validate(
  options: CommandOptions,
  logger?: Logger
): Promise<void> {
  const spinner = ora('Validating CLAUDE.md...').start();
  try {
    const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
    await fs.access(claudeMdPath);
    spinner.succeed(chalk.green('CLAUDE.md found'));
  } catch (error) {
    spinner.fail(chalk.red('CLAUDE.md not found'));
    throw new Error('CLAUDE.md is required. Run `caliber init`.');
  }
}
```

2. Register in `src/cli.ts`:
```typescript
import validate from './commands/validate.js';
// ...
tracked(program, 'validate', (cmd) => {
  cmd.description('Validate project configuration').action(async (options) => {
    await validate(options, logger);
  });
});
```

3. Test:
```bash
npm run build
npx caliber validate  # Should succeed if CLAUDE.md exists
```

**Result:** New `caliber validate` command works and logs telemetry.

## Common Issues

- **"Default export not found"** when building: Verify command file has `export default async function ...` (not `export const` or `export class`). Check `src/commands/status.ts` for correct pattern.
- **Command doesn't appear in `caliber help`**: Ensure `tracked()` wrapper is called in `src/cli.ts` during `program` setup, before `program.parse()`.
- **Spinner shows indefinitely after command completes**: Call `.stop()`, `.succeed()`, or `.fail()` on spinner before returning or throwing. Missing this blocks process exit.
- **LLM call fails with "Config not available"**: Verify `options.config` is passed from `CommandOptions`. If using LLM, check that user ran `caliber config set` or environment has `ANTHROPIC_API_KEY`.
- **Test fails with "Cannot find module './llm/index.js'"**: Ensure mock path matches import: `vi.mock('../llm/index.js', ...)`. Use relative paths from test file.
- **TypeScript error: "CommandOptions not assignable"**: Import exact type: `import type { CommandOptions, Logger } from '../types/index.js'`. Check `src/types/index.ts` for current definition.
# Adding a New CLI Command

## Critical

- **Imports**: Use `.js` extension for all relative imports (e.g. `'../llm/config.js'`).
- **Registration**: Every command must be wrapped with `tracked('commandName', handler)` in `src/cli.ts` so telemetry runs.
- **Clean exit**: For user-facing failures (e.g. no config, validation), call `throw new Error('__exit__')` so no stack trace is printed.
- **Spinner on error**: In a `catch` block, call `spinner.fail(chalk.red(...))` before rethrowing or throwing `__exit__`.

## Instructions

### 1. Create the command file

Create `src/commands/<kebab-name>.ts`. Export a single async function named `<camelName>Command`. Accept an options object typed from the flags you will add in Step 2.

- Import: `chalk`, `ora`; for LLM: `loadConfig` (and optionally `getFastModel`) from `../llm/config.js`; for calls: `llmCall` / `llmJsonCall` from `../llm/index.js`. Use `.js` in paths.
- If the command needs an LLM provider: at the start, `const config = loadConfig(); if (!config) { console.log(chalk.red('No LLM provider configured. Run `caliber config` or set ANTHROPIC_API_KEY.')); throw new Error('__exit__'); }`
- For async work, use `const spinner = ora('Message...').start();` then in `try` use `spinner.succeed(...)` / `spinner.warn(...)`; in `catch` use `spinner.fail(chalk.red(err instanceof Error ? err.message : '...'));` then rethrow or `throw new Error('__exit__')`.

**Verify**: File path is `src/commands/<name>.ts`, export name ends with `Command`, and imports use `.js` extensions.

### 2. Register in CLI

In `src/cli.ts`:

- Add: `import { <camelName>Command } from './commands/<kebab-name>.js';`
- Add: `program.command('<name>').description('...').option('--flag', 'Description').action(tracked('<name>', <camelName>Command));`
- For subcommands (e.g. `learn finalize`): create a parent with `program.command('parent', { hidden: true })` then `parent.command('child').action(tracked('parent:child', handler));`

**Verify**: `npm run build` succeeds and `node dist/bin.js <name> --help` shows the command and options.

### 3. Use the LLM layer (if needed)

- Use `llmCall` for plain text or `llmJsonCall<YourType>()` for JSON. Both are in `src/llm/index.js`. Never import provider SDKs directly.
- Optional fast model: `const fastModel = getFastModel();` and pass `...(fastModel ? { model: fastModel } : {})` into the call options.
- See the `llm-provider` skill for streaming and provider details.

**Verify**: When config is missing, the command exits with your chalk message and no stack trace (__exit__).

### 4. Add a test

Create `src/commands/__tests__/<kebab-name>.test.ts`. Use `describe`/`it`/`expect`/`vi` from vitest. `llmCall`/`llmJsonCall`/`getProvider` are globally mocked in `src/test/setup.ts`. Mock only what the command under test needs (e.g. `vi.mock('../../scanner/index.js')`). Test at least: success path and the __exit__ path when config is missing (if applicable).

**Verify**: `npm run test -- src/commands/__tests__/<name>.test.ts` passes.

### 5. Docs and commit

Add a row to the Commands table in `README.md` if user-facing. Commit: `feat: add <name> command` (or `feat(commands): ...`).

## Examples

**User says**: "Add a `greet` command that says hello and optionally calls the LLM."

**Actions**: (1) Create `src/commands/greet.ts` with `export async function greetCommand(options: { llm?: boolean })`, chalk + ora; if `options.llm` then `loadConfig()` and if !config throw __exit__ and show message, else `llmCall({ system: '...', prompt: 'Say hello.' })` and print result. (2) In `src/cli.ts`: import `greetCommand`, add `program.command('greet').option('--llm', 'Use LLM').action(tracked('greet', greetCommand));`. (3) Add `src/commands/__tests__/greet.test.ts` with test for no-llm output and test that when config is missing and `--llm` is used, command throws `__exit__`.

**Result**: `caliber greet` and `caliber greet --llm` work; help shows the option; tests pass.

## Common Issues

| Issue | Fix |
|-------|-----|
| Command not listed in `caliber --help` | Ensure `program.command('name').action(tracked('name', handler))` is in `src/cli.ts` and the handler is the same function you export from the command file. |
| Options undefined in handler | Commander passes options as first argument. Define an interface (e.g. `RefreshOptions { quiet?: boolean }`) and use it as the parameter type; options match `.option('--quiet', '...')` as `quiet: boolean`. |
| Stack trace on validation failure | Use `throw new Error('__exit__')` after printing the message; the CLI catches it and exits without a trace. |
| `Cannot find module '../llm/config.js'` | You must use the `.js` extension in imports from `.ts` files (ESM resolution in this project). |
| Tests fail with "getProvider is not a function" or real LLM call | Ensure the test file is under `src/**/*.test.ts` so `src/test/setup.ts` runs and mocks `../llm/index.js`. For tests in `src/commands/__tests__/`, the global mock applies to code under `src/commands/` that imports from `../llm/index.js`. |
| Spinner keeps running after error | In every `catch` block that rethrows, call `spinner.fail(chalk.red(...))` before `throw err` or `throw new Error('__exit__')`. |

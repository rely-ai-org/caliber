# Vitest Testing

## Critical

- **Test files**: Only under `src/**/__tests__/*.test.ts`. Config includes `src/**/*.test.ts`; keep `__tests__` for structure.
- **Imports**: Use `.js` extension for local modules (e.g. `from '../utils.js'`). Import `describe`, `it`, `expect` from `'vitest'`; add `vi`, `beforeEach`, `afterEach` when mocking or using hooks.
- **vi.mock hoisting**: Call `vi.mock('...')` at the **top** of the file, before any imports of the module under test (or of modules that transitively use the mocked dependency). Imports are hoisted; mocks must be too.
- **Async**: Use `async/await` inside `it(...)`. If using `expect(...).resolves` or `.rejects`, **always** `await` the expect (e.g. `await expect(promise).rejects.toThrow(...)`).

## Instructions

1. **Create or extend tests**
   - Add a test file at `src/<area>/__tests__/<name>.test.ts` (e.g. `src/llm/__tests__/utils.test.ts`).
   - Use one `describe` per module or function; nest `describe` for logical groups. Use short, present-tense `it` descriptions.
   - **Verify**: File path matches `src/**/__tests__/*.test.ts` and imports use `.js` for local modules.

2. **Imports and structure**
   - Line 1: `import { describe, it, expect } from 'vitest';` — add `vi`, `beforeEach`, `afterEach` if needed.
   - Next: any `vi.mock(...)` calls (no other code before mocks).
   - Then: imports of modules under test (use `../` or `../../` and `.js`).
   - **Verify**: No code runs before `vi.mock`; SUT is imported after mocks.

3. **Mocking modules**
   - Full mock: `vi.mock('fs');` then `vi.mocked(fs.readFileSync).mockReturnValue(value);` (cast to `any` for buffer/string if needed).
   - Factory mock: `vi.mock('os', () => ({ default: { homedir: () => '/home/user' } }));`
   - Partial/actual: `vi.mock('fs', async (importOriginal) => { const actual = await importOriginal<typeof import('fs')>(); return { ...actual, readFileSync: vi.fn() }; });`
   - For per-test control, declare `const mockFn = vi.fn();` before `vi.mock`, then in the factory pass through: `vi.mock('../../llm/index.js', () => ({ llmCall: (...args: unknown[]) => mockFn(...args) }));`
   - **Verify**: After adding a mock, run the test; no "module not found" or missing mock implementation.

4. **Per-test state**
   - Use `beforeEach` for `vi.clearAllMocks()`, resetting `process.env` (save `originalEnv = process.env`, restore in `afterEach`), or creating temp dirs.
   - Temp dirs: `dir = mkdtempSync(join(tmpdir(), 'caliber-<name>-'));` in `beforeEach`; `rmSync(dir, { recursive: true, force: true });` in `afterEach`.
   - **Verify**: Tests don't leak env or files; each test can run in isolation.

5. **Assertions**
   - Use `expect(x).toBe(y)` for primitives, `expect(obj).toEqual({ ... })` for objects, `expect(str).toContain('...')`, `expect(() => fn()).toThrow()` or `toThrow('message')`.
   - For mocks: `expect(mockFn).toHaveBeenCalledWith(...)`, `mockFn.mock.calls[0][0]` for first argument.
   - **Verify**: No floating promises; async tests use `async () => { ... await ... }` or `await expect(promise).resolves/rejects....`.

6. **Run and coverage**
   - Run all: `npm run test` (or `vitest run`). Single file: `npx vitest run src/scoring/__tests__/accuracy.test.ts`.
   - Coverage: `npm run test:coverage`. Coverage excludes are in `vitest.config.ts` (e.g. `src/test/**`, `src/commands/**`).
   - **Verify**: `npm run test` passes and, if changed, coverage excludes still match intent.

## Examples

**User says:** "Add a unit test for a pure function in `src/lib/foo.ts`."

- Create `src/lib/__tests__/foo.test.ts`.
- `import { describe, it, expect } from 'vitest';`
- `import { myFn } from '../foo.js';`
- `describe('myFn', () => { it('returns X when ...', () => { expect(myFn(...)).toBe(...); }); });`
- Run: `npx vitest run src/lib/__tests__/foo.test.ts`.

**User says:** "Test code that reads from the filesystem."

- Use a temp dir: `beforeEach` → `mkdtempSync(join(tmpdir(), 'caliber-foo-'));`; `afterEach` → `rmSync(dir, { recursive: true, force: true });`. Create files under `dir` and pass `dir` to the function. No global `vi.mock('fs')` if the code uses real `fs` and you control the path.

**User says:** "Test code that calls `llmCall`."

- Rely on global LLM mock in `src/test/setup.ts` for basic runs. To override per test: in that test file, `vi.mock('../../llm/index.js', () => ({ llmCall: vi.fn(), ... }));` and then `vi.mocked(llmCall).mockResolvedValue('...');` in a test. See `src/ai/__tests__/refresh.test.ts` and `detect.test.ts` for patterns.

## Common Issues

- **"vi.mock is not a function" or mock has no effect**  
  Ensure `vi` is imported from `'vitest'` and `vi.mock(...)` is at the top of the file with no code between it and other top-level statements (only other `vi.mock` and imports).

- **"Cannot read property 'mockReturnValue' of undefined"**  
  The mocked module's export (e.g. `fs.readFileSync`) may be undefined if the mock wasn't applied before the module was loaded. Use `vi.mocked(fs.readFileSync)` after importing `fs`; ensure `vi.mock('fs')` runs before `import fs from 'fs'`.

- **Tests pass in watch but fail in single run**  
  Often env or mock state leaking. Restore `process.env` in `afterEach` (assign back to saved `originalEnv`). Use `vi.clearAllMocks()` in `beforeEach` when reusing the same mock across tests.

- **"Expected number of calls" or wrong call args**  
  If the SUT or another test calls the mock, clear between tests: `beforeEach(() => { vi.clearAllMocks(); });` and set up the mock for that test (e.g. `mockFn.mockResolvedValue(...)`).

- **Async test passes but code never awaited**  
  Use `async ()=>{ await ... }` in the test, or `await expect(promise).rejects.toThrow(...)`. Without `await` on `expect(...).resolves/rejects`, the assertion may run after the test finishes.

- **Import path "cannot find module"**  
  Use `.js` extension for local TS files (e.g. `from '../config.js'`), matching project ES module resolution.

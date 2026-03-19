---
name: caliber-testing
description: Writes Vitest tests for caliber modules following project patterns. LLM calls are globally mocked in src/test/setup.ts via vi.mock('@/llm'). Override per-test with vi.spyOn for specific behavior. Use temp dirs (os.tmpdir()) for learner/fingerprint file tests, memfs for isolated fs mocking. Use when user says 'write test', 'add test', 'test coverage', or when adding files to src/**/__tests__/. Do NOT re-mock llmCall globally—it's pre-mocked. Do NOT test LLM integrations; mock them. Do NOT skip validation of mock setup before running tests.
---
# caliber-testing

## Critical

- **LLM calls are already mocked globally** in `src/test/setup.ts` via `vi.mock('@/llm')`. Do NOT re-mock `llmCall` or `llmJsonCall` globally; it breaks the test suite.
- **Override per-test** using `vi.spyOn(llmModule, 'llmCall')` if a specific test needs custom behavior.
- **Never test actual LLM API calls**. All LLM interactions must be mocked.
- **Always verify mock setup** by running the test file in isolation before adding to the suite:
  ```bash
  npx vitest run src/path/__tests__/file.test.ts
  ```
- Test file location: `src/<module>/__tests__/<module>.test.ts` (colocated with source).

## Instructions

1. **Set up test file structure**
   - Create file: `src/<module>/__tests__/<module-name>.test.ts`
   - Import test utilities:
     ```typescript
     import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
     import { moduleName } from '../index';
     import * as llmModule from '@/llm';
     ```
   - Verify global LLM mock is active by checking `src/test/setup.ts` imports `@/llm` with `vi.mock()`.

2. **Mock external dependencies per test**
   - For fingerprint tests: use `memfs` to mock filesystem without touching disk:
     ```typescript
     import { vol } from 'memfs';
     beforeEach(() => {
       vol.reset();
       vol.fromJSON({ '/project/file.ts': 'const x = 1;' });
     });
     afterEach(() => vol.reset());
     ```
   - For learner/file-based tests: use `os.tmpdir()` for real temp directories:
     ```typescript
     import os from 'os';
     import path from 'path';
     const tmpDir = path.join(os.tmpdir(), `caliber-test-${Date.now()}`);
     ```
   - Verify before proceeding: Run `npx vitest run src/<module>/__tests__/file.test.ts` and confirm no file I/O errors.

3. **Mock LLM behavior per-test (override global mock)**
   - If test needs specific LLM response, use `vi.spyOn()`:
     ```typescript
     it('should generate config', async () => {
       vi.spyOn(llmModule, 'llmJsonCall').mockResolvedValueOnce({
         content: { rules: ['rule1'] },
       });
       const result = await generate();
       expect(result).toEqual({ rules: ['rule1'] });
     });
     ```
   - Verify mock is called: Use `expect(llmModule.llmJsonCall).toHaveBeenCalledWith(...)`.
   - **Do NOT** use `vi.mock()` inside the test file for LLM—it's already mocked globally.

4. **Test error handling with mock failures**
   - Mock transient errors (from `src/llm/index.ts` `TRANSIENT_ERRORS`):
     ```typescript
     it('should retry on transient error', async () => {
       vi.spyOn(llmModule, 'llmCall')
         .mockRejectedValueOnce(new Error('RATE_LIMIT_EXCEEDED'))
         .mockResolvedValueOnce({ content: 'success' });
       const result = await callWithRetry();
       expect(result.content).toBe('success');
     });
     ```
   - Verify mock was called twice: `expect(llmModule.llmCall).toHaveBeenCalledTimes(2)`.

5. **Run tests and validate coverage**
   - Run single file: `npx vitest run src/<module>/__tests__/file.test.ts`
   - Run full suite: `npm run test`
   - Check coverage: `npm run test:coverage`
   - Verify all mocks are cleaned up: `afterEach(() => vi.clearAllMocks())`.

## Examples

**User**: "Write a test for the `generate.ts` module."

**Actions**:
1. Create `src/ai/__tests__/generate.test.ts`
2. Import llmModule and vitest utilities
3. Mock llmJsonCall to return fingerprint-based config
4. Test that `generate()` returns a CLAUDE.md config object
5. Test error path: mock llmJsonCall rejection, verify error is caught
6. Run: `npx vitest run src/ai/__tests__/generate.test.ts`

**Result**:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generate } from '../generate';
import * as llmModule from '@/llm';

describe('generate', () => {
  afterEach(() => vi.clearAllMocks());

  it('should generate CLAUDE.md config from fingerprint', async () => {
    vi.spyOn(llmModule, 'llmJsonCall').mockResolvedValueOnce({
      content: { title: 'Test Project', commands: [] },
    });
    const result = await generate({ projectRoot: '/test' });
    expect(result.title).toBe('Test Project');
    expect(llmModule.llmJsonCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('should handle LLM errors gracefully', async () => {
    vi.spyOn(llmModule, 'llmJsonCall').mockRejectedValueOnce(
      new Error('API_ERROR'),
    );
    await expect(generate({ projectRoot: '/test' })).rejects.toThrow('API_ERROR');
  });
});
```

## Common Issues

**"Cannot find module '@/llm' or it is not mocked"**
- Root cause: `src/test/setup.ts` not being loaded by Vitest.
- Fix: Verify `vitest.config.ts` has `setupFiles: ['src/test/setup.ts']`. Run `npx vitest run --reporter=verbose` and check log output mentions setup.ts being loaded.

**"llmCall is not a function"**
- Root cause: Global mock in setup.ts is not working because vi.mock() runs before imports.
- Fix: Verify test file imports `@/llm` AFTER the mock is active. Check that `src/llm/index.ts` exports named exports (not default). Run test in isolation: `npx vitest run src/<module>/__tests__/file.test.ts --reporter=verbose`.

**"Unexpected file system access: /home/.../file.ts"**
- Root cause: Test is using real fs instead of memfs or tmpdir.
- Fix: For fingerprint tests, wrap fs calls in `vol` from memfs. For learner tests, use `path.join(os.tmpdir(), uniqueId)` and clean up in afterEach. Verify: `ls -la .caliber/` should NOT increase after test runs.

**"Mock was not called as expected"**
- Root cause: Function being tested does not actually call the mocked dependency.
- Fix: Add `console.log()` in the function being tested to trace execution. Verify the mock spy is on the correct function: `expect(llmModule.llmJsonCall).toHaveBeenCalled()` before asserting call arguments. Check that the function under test actually invokes the mocked dependency.

**"Cannot read property 'fromJSON' of undefined"**
- Root cause: memfs not imported or vol not initialized.
- Fix: Add `import { vol } from 'memfs';` at top of test file. Call `vol.reset()` in beforeEach. Verify memfs is installed: `npm ls memfs` (it's a devDependency).
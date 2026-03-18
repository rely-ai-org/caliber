---
name: caliber-testing
description: Vitest testing patterns for @rely-ai/caliber. Global LLM mocks in src/test/setup.ts, coverage config in vitest.config.ts, temp dir patterns for scoring tests. Use when writing or fixing tests, mocking llmCall/llmJsonCall, or testing scoring checks with fs. Do NOT use for integration or live API tests.
---
# Caliber Testing

## Critical

1. **All tests must use the global LLM mock setup** in `src/test/setup.ts`. Never call real APIs in tests.
2. **Mock `llmCall` and `llmJsonCall`** using `vi.mocked()` from Vitest. Default mock returns `{ message: { content: [{ type: 'text', text: '{}' }] } }`.
3. **Use `memfs` for file-system tests** in scoring checks. Real fs mutations break parallel test runs.
4. **Verify test isolation**: Each test should clean up mocks with `vi.clearAllMocks()` or use `beforeEach`.

## Instructions

1. **Create test file in the appropriate `__tests__` directory**.
   - Pattern: `src/<module>/__tests__/<feature>.test.ts`
   - Example: `src/scoring/checks/__tests__/existence.test.ts`, `src/llm/__tests__/anthropic.test.ts`
   - Verify: File exists and imports from `vitest`.

2. **Import test utilities and setup**.
   ```typescript
   import { describe, it, expect, beforeEach, vi } from 'vitest';
   import { llmCall, llmJsonCall } from '../../llm';
   ```
   - If testing file operations, import: `import { fs } from 'memfs'` and `import { vol } from 'memfs'`
   - Verify: All mocks are resolved from `src/test/setup.ts` (auto-loaded by vitest.config.ts).

3. **Set up test suite with describe block and beforeEach cleanup**.
   ```typescript
   describe('Feature Name', () => {
     beforeEach(() => {
       vi.clearAllMocks();
     });
   ```
   - Verify: Mock state is fresh before each test.

4. **Mock LLM responses using `vi.mocked(llmCall).mockResolvedValueOnce()`**.
   ```typescript
   vi.mocked(llmCall).mockResolvedValueOnce({
     message: {
       content: [{ type: 'text', text: '{"key": "value"}' }],
     },
   });
   ```
   - For `llmJsonCall`: Mock the resolved JSON object directly (e.g., `{ skills: [...] }`).
   - Verify: Mock is set *before* function call; use `.mockResolvedValueOnce()` for sequence.

5. **For fs tests, use memfs vol and isolation**.
   ```typescript
   import { vol } from 'memfs';
   
   beforeEach(() => {
     vol.reset();
     vol.mkdirSync('/test', { recursive: true });
   });
   
   afterEach(() => {
     vol.reset();
   });
   ```
   - Pass `fs` instance to functions that accept it (scoring checks use `fs` parameter).
   - Verify: `vol.reset()` clears all files before and after each test.

6. **Assert using standard Vitest matchers**.
   - For objects: `expect(result).toEqual({ ... })`
   - For errors: `expect(() => fn()).toThrow('message')`
   - For calls: `expect(vi.mocked(llmCall)).toHaveBeenCalledWith(...)`
   - Verify: Assertion runs and passes.

7. **Run tests locally before committing**.
   ```bash
   npm run test                    # Run all
   npm run test:watch             # Watch mode
   npm run test -- --grep "Feature Name"  # Single suite
   npm run test:coverage          # v8 report → coverage/
   ```
   - Verify: All tests pass and coverage is acceptable (target: >80%).

## Examples

### Example 1: Testing an LLM-based Function
**User says**: "Test that `generateSkill` calls llmJsonCall and returns parsed skills."

**File**: `src/ai/__tests__/generate.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { llmJsonCall } from '../../llm';
import { generateSkill } from '../generate';

describe('generateSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call llmJsonCall and return skills', async () => {
    const mockSkills = [
      { name: 'test-skill', description: 'A test skill' },
    ];
    vi.mocked(llmJsonCall).mockResolvedValueOnce(mockSkills);

    const result = await generateSkill({ context: 'test' });

    expect(result).toEqual(mockSkills);
    expect(vi.mocked(llmJsonCall)).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.any(String) })
    );
  });
});
```

**Result**: Test mocks the LLM, verifies function calls it, and asserts return value.

### Example 2: Testing a Scoring Check with fs
**User says**: "Test that the existence check detects missing CLAUDE.md."

**File**: `src/scoring/checks/__tests__/existence.test.ts`

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vol } from 'memfs';
import { checkExistence } from '../existence';
import { fs } from 'memfs';

describe('checkExistence', () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync('/test', { recursive: true });
  });

  afterEach(() => {
    vol.reset();
  });

  it('should fail if CLAUDE.md does not exist', () => {
    const result = checkExistence({
      cwd: '/test',
      fs,
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('CLAUDE.md');
  });

  it('should pass if CLAUDE.md exists', () => {
    vol.writeFileSync('/test/CLAUDE.md', '# CLAUDE');
    const result = checkExistence({
      cwd: '/test',
      fs,
    });
    expect(result.passed).toBe(true);
  });
});
```

**Result**: Uses memfs to test file checks without touching real fs; isolation prevents cross-test contamination.

## Common Issues

**Issue**: "ReferenceError: llmCall is not defined in test."
- **Fix**: Verify `src/test/setup.ts` is loaded. Check `vitest.config.ts` has `setupFiles: ['./src/test/setup.ts']`. Run `npm run test` (not `node test.ts`).

**Issue**: "ENOENT: no such file or directory, open '/real/path'" during fs test.
- **Fix**: You are using real `fs` instead of `memfs`. Change imports: `import { fs } from 'memfs'`. Call `vol.mkdirSync()` before test. Verify function signature accepts `fs` parameter.

**Issue**: "Mock is not being called / test is calling real API."
- **Fix**: Ensure mock is set *before* async call: `await vi.mocked(llmCall).mockResolvedValueOnce(...)` must come before `await functionUnderTest()`. Use `.mockResolvedValueOnce()` (not `.mockResolvedValue()`) if testing multiple calls in sequence.

**Issue**: "Test passes locally but fails in CI / parallel runs fail."
- **Fix**: Missing `vi.clearAllMocks()` in `beforeEach`. Missing `vol.reset()` for fs tests. Ensure no global state mutations. Run `npm run test -- --reporter=verbose` to see isolation issues.

**Issue**: "Coverage shows untested lines in scoring check."
- **Fix**: Add test case for error path: `expect(() => checkX({ invalid: true })).toThrow()`. Mock both happy and sad paths. Run `npm run test:coverage` to identify gaps.
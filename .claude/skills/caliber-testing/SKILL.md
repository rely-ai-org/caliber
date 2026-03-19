---
name: caliber-testing
description: Writes Vitest tests for caliber modules following project patterns. LLM calls are globally mocked via src/test/setup.ts; override per-test with vi.spyOn. Use temp dirs (os.tmpdir()) for learner/storage tests, mock fs via memfs for fingerprint tests. Use when user says 'write test', 'add test', 'test coverage', or creates files in src/**/__tests__/. Do NOT re-mock llmCall globally—it's already stubbed. Do NOT use Jest syntax; use Vitest (describe, it, expect, vi).
---
# Caliber Testing

## Critical

- **LLM calls are pre-mocked globally in `src/test/setup.ts`** — do NOT add duplicate mocks for `llmCall` or `llmJsonCall`. Override behavior per-test with `vi.spyOn()` on the imported module.
- **Use Vitest syntax only**: `describe()`, `it()`, `expect()`, `vi.spyOn()`, `vi.mock()`. No Jest matchers.
- **Temp directories for I/O**: Tests that write files must use `os.tmpdir()`. Clean up in `afterEach()`.
- **Mock fs with memfs for fingerprint tests**: Use `vol` from `memfs` to simulate file trees.
- **Test file location**: Colocated with source in the same module directory.

## Instructions

1. **Set up test file structure**:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadLearnings } from '../storage.js';
```

2. **Override LLM mock per-test** using `vi.spyOn()` (do NOT re-mock globally):

```typescript
import * as llmModule from '../../llm/index.js';

it('uses custom LLM response', async () => {
  vi.spyOn(llmModule, 'llmCall').mockResolvedValueOnce({ text: 'mocked' });
  const result = await generate();
  expect(result).toMatch(/mocked/);
});
```

3. **File I/O tests — use temp directories**:

```typescript
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, writeFileSync } from 'fs';

let testDir: string;
beforeEach(() => { testDir = join(tmpdir(), `test-${Date.now()}`); });
afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

it('loads learnings from CALIBER_LEARNINGS.md', async () => {
  writeFileSync(join(testDir, 'CALIBER_LEARNINGS.md'), '# Learnings\n- learned X', 'utf8');
  const learnings = await loadLearnings({ root: testDir });
  expect(learnings).toMatch(/learned X/);
});
```

4. **Fingerprint tests — use memfs**:

```typescript
import { vol } from 'memfs';
vi.mock('fs');

beforeEach(() => { vol.reset(); });
afterEach(() => { vol.reset(); });

it('detects Node.js project from package.json', () => {
  vol.fromJSON({ '/project/package.json': JSON.stringify({ name: 'test' }) });
  const platforms = detectPlatforms('/project');
  expect(platforms).toContain('node');
});
```

5. **Run and validate**:

```bash
npx vitest run src/learner/
npm run test
npm run test:coverage
```

## Common Issues

**"llmCall is not a function" or spyOn fails**
- Global mock in `src/test/setup.ts` wraps `llmCall` as `vi.fn()` — use `vi.mocked(llmCall).mockResolvedValue(...)` instead of `vi.spyOn()`

**Temp files persist after test runs**
- Wrap cleanup in try/finally: `afterEach(() => { try { rmSync(testDir, { recursive: true }) } catch {} })`

**memfs not intercepting fs calls**
- Move `vi.mock('fs')` to top of file before any imports; verify `memfs` is in devDependencies

**Test times out waiting for async**
- Add timeout option: `it('name', async () => { ... }, 5000)`

**"ReferenceError: describe is not defined"**
- Add `import { describe, it, expect } from 'vitest'` to test file; verify `vitest.config.ts` exists

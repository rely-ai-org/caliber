---
name: scoring-checks
description: Adds a new deterministic scoring check to src/scoring/checks/ following the Check interface. Use constants from src/scoring/constants.ts for point values. Triggered by 'add scoring check', 'new check', 'score X', or modifications to src/scoring/. Do NOT use for LLM-based evaluation or refining checks after they're deployed.
---
# Scoring Checks

## Critical

- **All checks are deterministic**: No LLM calls, no async I/O, no external APIs. Pure functions that analyze files/trees in memory.
- **Check must implement the `Check` interface** from `src/scoring/index.ts`:
  ```typescript
  interface Check {
    name: string;
    run(ctx: CheckContext): number | Promise<number>;
  }
  interface CheckContext {
    files: Map<string, string>; // path → content
    tree: FileTree;
    manifest: Manifest;
  }
  ```
- **Point values MUST come from `src/scoring/constants.ts`**, not hardcoded. If a constant doesn't exist, add it to `constants.ts` first.
- **Return an integer**: total points earned. Zero if check fails; positive if it passes.
- **Register the check** in `src/scoring/checks/index.ts` (default export array).
- **Verify output with** `npm run test -- src/scoring/__tests__/` before merging.

## Instructions

1. **Identify the check category** from existing checks in `src/scoring/checks/`:
   - `existence.ts` — file presence (CLAUDE.md, .cursor/rules/)
   - `quality.ts` — content depth & structure
   - `grounding.ts` — relevance to codebase
   - `accuracy.ts` — correctness of links/references
   - `freshness.ts` — cache age & manifest updates
   - `bonus.ts` — optional enhancements
   
   Choose the category or create a new file if check doesn't fit.
   **Verify: Does the check category exist in `src/scoring/checks/`?**

2. **Study one existing check** in the target category to extract the pattern:
   - Open e.g. `src/scoring/checks/existence.ts` and read the full function.
   - Note: imports from `src/scoring/constants.ts`, `src/types.ts`, file path patterns.
   - Note: how it accesses `ctx.files`, `ctx.tree`, `ctx.manifest`.
   **Verify: Can you write pseudocode for the check logic in 2 sentences?**

3. **Add point constants** to `src/scoring/constants.ts` if they don't exist:
   ```typescript
   export const POINTS_MY_CHECK = 50;
   ```
   Naming: `POINTS_<CHECK_NAME>` (uppercase, snake_case).
   **Verify: Constants file compiles with `npx tsc --noEmit`.**

4. **Create or update the check file**:
   ```typescript
   import { Check, CheckContext } from '../index.ts';
   import { POINTS_MY_CHECK } from '../constants.ts';
   
   export const myCheck: Check = {
     name: 'my-check', // kebab-case
     run(ctx: CheckContext): number {
       // Pure logic: inspect ctx.files, ctx.tree, ctx.manifest
       // Return POINTS_MY_CHECK if condition met, else 0
       const condition = /* ... */;
       return condition ? POINTS_MY_CHECK : 0;
     },
   };
   ```
   **Verify: Check has no `async`, no `await`, no external calls.**

5. **Register in `src/scoring/checks/index.ts`**:
   ```typescript
   import { myCheck } from './my-check.ts';
   export default [existenceChecks, qualityChecks, myCheck, /* ... */];
   ```
   **Verify: `npx tsc --noEmit` passes.**

6. **Write a test** in `src/scoring/__tests__/` (copy pattern from existing tests):
   ```typescript
   it('myCheck: returns POINTS_MY_CHECK if condition', async () => {
     const ctx = { files: new Map([...]), tree, manifest };
     const score = await myCheck.run(ctx);
     expect(score).toBe(POINTS_MY_CHECK);
   });
   ```
   **Verify: `npm run test -- src/scoring/__tests__/<check>.test.ts` passes.**

7. **Run full scoring suite** to confirm integration:
   ```bash
   npm run test -- src/scoring/__tests__/
   ```
   **Verify: All tests pass, no regressions.**

## Examples

**User says:** "Add a scoring check for .cursor/rules/typescript.md existence"

**Actions taken:**

1. Category: `existence.ts` (file presence check).
2. Study `src/scoring/checks/existence.ts` → pattern: `ctx.files.has('path')` → return `POINTS_*` or `0`.
3. Add `POINTS_CURSOR_TS_RULES = 15` to `constants.ts`.
4. Update `src/scoring/checks/existence.ts`:
   ```typescript
   const cursorTsRulesExists: Check = {
     name: 'cursor-ts-rules',
     run(ctx: CheckContext) {
       return ctx.files.has('.cursor/rules/typescript.md')
         ? POINTS_CURSOR_TS_RULES
         : 0;
     },
   };
   ```
5. Add to export array in `existence.ts`.
6. Test: verify `npm run test -- src/scoring/__tests__/existence.test.ts` includes new case.

**Result:** Check is live; `caliber score` now rewards `.cursor/rules/typescript.md` presence.

## Common Issues

**Error: "Cannot find name 'POINTS_...'"**
- **Cause:** Constant not defined in `src/scoring/constants.ts`.
- **Fix:** Add `export const POINTS_MY_CHECK = <number>;` to `constants.ts`. Verify import in check file: `import { POINTS_MY_CHECK } from '../constants.ts';`

**Error: "myCheck is not assigned to default export"**
- **Cause:** Check not added to export array in `src/scoring/checks/index.ts`.
- **Fix:** Open `index.ts`, add `import { myCheck } from './my-check.ts';`, then add `myCheck` to the default export array.

**Test fails: "expected 50 but got 0"**
- **Cause:** Check logic is returning 0 when it should return points.
- **Fix:** Debug the condition in `run()`. Use `ctx.files.has()` not `ctx.files.get()` for existence. Verify `ctx.tree` or `ctx.manifest` structure matches actual data by logging in test.

**Error: "Cannot read property 'files' of undefined"**
- **Cause:** Test context not set up correctly.
- **Fix:** Copy full test setup from `src/scoring/__tests__/existence.test.ts`. Ensure `files`, `tree`, and `manifest` are initialized before passing to `check.run(ctx)`.

**Error: "check.run is not a function" or "myCheck is not a Check"**
- **Cause:** Check object missing `name` or `run` property, or incorrect export.
- **Fix:** Verify object literal has both fields: `{ name: string, run(ctx: CheckContext): number { ... } }`. Verify TypeScript compiles: `npx tsc --noEmit`.
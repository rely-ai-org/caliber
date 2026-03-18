---
name: scoring-and-fingerprint
description: Deterministic scoring system (no LLM) with checks in src/scoring/checks/ and fingerprint collection in src/fingerprint/. Use when adding scoring checks, modifying fingerprint collection, debugging 'caliber score' output, or analyzing project structure. Add checks via src/scoring/constants.ts and category files (existence.ts, quality.ts, grounding.ts, accuracy.ts, freshness.ts, bonus.ts). Do NOT use for LLM generation, writers, or CLI command routing.
---
# Scoring and Fingerprint

## Critical

1. **Scoring is deterministic** — no LLM calls. All checks run synchronously in `src/scoring/` via `caliber score`.
2. **Checks are grouped by category** — each file in `src/scoring/checks/` (existence.ts, quality.ts, grounding.ts, accuracy.ts, freshness.ts, bonus.ts) handles one responsibility.
3. **Constants FIRST** — before writing a check, add weight and metadata to `src/scoring/constants.ts` under `SCORING_CHECKS`. The check name must match the constant key exactly.
4. **Fingerprint feeds scoring** — `src/fingerprint/index.ts` orchestrates git, file-tree, existing-config, and code-analysis. Fingerprint is *not* stored; it's generated per run and passed to scoring.
5. **No breaking changes to check names or weight keys** — manifests in `.caliber/manifest.json` record historical scores; renaming a check breaks backward compatibility.

## Instructions

### Adding a New Scoring Check

1. **Define constant in `src/scoring/constants.ts`**
   - Open `src/scoring/constants.ts`
   - Add entry to `SCORING_CHECKS` object:
     ```typescript
     SCORING_CHECKS: {
       YOUR_CHECK_KEY: {
         name: 'Your Check',
         category: 'existence' | 'quality' | 'grounding' | 'accuracy' | 'freshness' | 'bonus',
         weight: number,
         description: 'What this check validates'
       }
     }
     ```
   - Verify: weight is 0–100, category matches an existing file in `src/scoring/checks/`

2. **Implement check in category file**
   - Open `src/scoring/checks/{CATEGORY}.ts` (e.g., `quality.ts`)
   - Add function: `async function checkYourCheckKey(projectPath: string, fingerprint: Fingerprint): Promise<CheckResult>`
   - Return `{ passed: boolean, message: string, evidence?: string }`
   - Example from `existence.ts`:
     ```typescript
     export async function checkClaudeMdExists(projectPath: string): Promise<CheckResult> {
       const path = join(projectPath, 'CLAUDE.md');
       const exists = await pathExists(path);
       return {
         passed: exists,
         message: exists ? 'CLAUDE.md exists' : 'CLAUDE.md not found'
       };
     }
     ```
   - Verify: function is exported, uses async/await for file operations, no LLM calls

3. **Register check in category file's export map**
   - Scroll to bottom of category file (e.g., `src/scoring/checks/quality.ts`)
   - Add function reference to exported `CHECKS` object:
     ```typescript
     export const CHECKS = {
       YOUR_CHECK_KEY: checkYourCheckKey,
       // ... other checks
     };
     ```
   - Verify: key matches `SCORING_CHECKS` constant name exactly

4. **Test the check**
   - Create `src/scoring/__tests__/{CATEGORY}.test.ts` if it doesn't exist
   - Add test case:
     ```typescript
     import { checkYourCheckKey } from '../checks/{category}';
     describe('checkYourCheckKey', () => {
       it('returns passed: true when condition is met', async () => {
         const result = await checkYourCheckKey('/test/path', mockFingerprint);
         expect(result.passed).toBe(true);
       });
     });
     ```
   - Run: `npm run test -- src/scoring/__tests__/{category}.test.ts`
   - Verify: test passes, coverage includes both pass and fail paths

5. **Run full scoring suite**
   - Execute: `npm run test -- --filter=scoring`
   - Verify: all new and existing checks pass
   - Run: `caliber score` on a test project to validate integration
   - Verify: output includes your check in the report with correct weight and category

### Modifying Fingerprint Collection

1. **Understand fingerprint shape** — open `src/fingerprint/index.ts`, locate the return type.
   - Fingerprint includes: `git` (commits, files), `fileTree` (structure), `existingConfig` (CLAUDE.md, AGENTS.md, etc.), `codeAnalysis` (detected frameworks, languages).
   - It is *generated per run*, not stored.

2. **Add collection logic to appropriate module**
   - For git info: edit `src/fingerprint/git.ts` → export `collectGitMetadata(projectPath)`
   - For file structure: edit `src/fingerprint/file-tree.ts` → export `buildFileTree(projectPath)`
   - For existing configs: edit `src/fingerprint/existing-config.ts` → export `detectExistingConfig(projectPath)`
   - For code analysis: edit `src/fingerprint/code-analysis.ts` → export `analyzeCodebase(projectPath)`
   - Each function must use async/await and `pathExists()` from utils

3. **Update fingerprint type in `src/fingerprint/types.ts`** (if adding new field)
   - Add property to `Fingerprint` interface:
     ```typescript
     export interface Fingerprint {
       // ... existing fields
       newField: YourType;
     }
     ```
   - Verify: all imports of `Fingerprint` in scoring checks still compile

4. **Integrate in `src/fingerprint/index.ts`**
   - In `collectFingerprint(projectPath)` function, add call:
     ```typescript
     const fingerprint: Fingerprint = {
       git: await collectGitMetadata(projectPath),
       fileTree: await buildFileTree(projectPath),
       // ... add your new field
       newField: await yourNewCollectionFn(projectPath)
     };
     ```
   - Verify: function is awaited, no LLM calls, runs fast (<1s for typical projects)

5. **Test fingerprint changes**
   - Run: `npm run test -- src/fingerprint/__tests__/index.test.ts`
   - Verify: fingerprint shape is correct, all fields populate
   - Optional: inspect `.caliber/manifest.json` → `fingerprint` field to see collected data

### Debugging `caliber score` Output

1. **Run scoring with verbose output**
   - Execute: `caliber score --verbose` (if flag exists) or check logs:
     ```bash
     DEBUG=* caliber score
     ```
   - Verify: each check reports `passed: true/false`, weight, and message

2. **Inspect manifest**
   - Open `.caliber/manifest.json` in project root
   - Locate `scores` array → each entry shows `checkKey`, `passed`, `weight`, `timestamp`
   - Verify: sum of `weight * passed` gives total score

3. **Add console output to a check (temporary)**
   - Open `src/scoring/checks/{category}.ts`
   - Add `console.error()` (not `console.log`) in the check function
   - Re-run: `caliber score`
   - Verify: stderr shows debug info
   - Remove before commit

4. **Common failures**
   - Check returns `{ passed: false, message: '' }` — add non-empty message
   - Check throws error — wrap in try/catch, return `{ passed: false, message: error.message }`
   - Manifest has stale scores — delete `.caliber/manifest.json` and re-run

## Examples

### Example 1: Add a New Scoring Check for "AGENTS.md Exists"

**User says:** "Add a scoring check to verify AGENTS.md exists in the project."

**Actions:**
1. Edit `src/scoring/constants.ts` → add:
   ```typescript
   AGENTS_MD_EXISTS: {
     name: 'AGENTS.md Exists',
     category: 'existence',
     weight: 10,
     description: 'Verifies AGENTS.md file is present'
   }
   ```
2. Edit `src/scoring/checks/existence.ts` → add function:
   ```typescript
   export async function checkAgentsMdExists(projectPath: string): Promise<CheckResult> {
     const path = join(projectPath, 'AGENTS.md');
     const exists = await pathExists(path);
     return {
       passed: exists,
       message: exists ? 'AGENTS.md exists' : 'AGENTS.md not found'
     };
   }
   ```
3. Add to `CHECKS` export in same file:
   ```typescript
   export const CHECKS = {
     AGENTS_MD_EXISTS: checkAgentsMdExists,
     // ...
   };
   ```
4. Run: `npm run test -- src/scoring/__tests__/existence.test.ts` → passes
5. Run: `caliber score` on test project → score report includes "AGENTS.md Exists"

**Result:** Check is live, reports "passed: true" when AGENTS.md is found, "passed: false" otherwise. Weight is 10.

### Example 2: Extend Fingerprint to Collect Node.js Version

**User says:** "Update fingerprint to detect the Node.js version from package.json."

**Actions:**
1. Edit `src/fingerprint/types.ts` → add to `Fingerprint` interface:
   ```typescript
   nodeVersion?: string;
   ```
2. Edit `src/fingerprint/code-analysis.ts` → add:
   ```typescript
   async function extractNodeVersion(projectPath: string): Promise<string | undefined> {
     const pkgPath = join(projectPath, 'package.json');
     if (!(await pathExists(pkgPath))) return undefined;
     const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
     return pkg.engines?.node || pkg.volta?.node;
   }
   ```
3. Edit `src/fingerprint/index.ts` → in `collectFingerprint()`, add:
   ```typescript
   nodeVersion: await extractNodeVersion(projectPath)
   ```
4. Run: `npm run test -- src/fingerprint/__tests__/index.test.ts` → passes
5. Run: `caliber score` → `.caliber/manifest.json` shows `fingerprint.nodeVersion` populated

**Result:** Fingerprint now collects Node.js version; any check can read it via `fingerprint.nodeVersion`.

## Common Issues

**Issue: "Check returns undefined instead of CheckResult"**
- Fix: Ensure function has explicit `return { passed: boolean, message: string }`
- Verify: TypeScript error shows return type mismatch
- Action: Add explicit return statement at end of function

**Issue: "manifest.json scores are stale, check passes but old result shows passed: false"**
- Cause: `.caliber/manifest.json` caches scores from previous run
- Fix: Delete `.caliber/manifest.json`: `rm .caliber/manifest.json`
- Re-run: `caliber score`
- Verify: new manifest shows correct scores

**Issue: "Check takes >1 second, slows down `caliber score`"**
- Cause: Synchronous file I/O, large glob, or unoptimized logic
- Fix: Use `glob` with limit, cache results in fingerprint instead of check, avoid nested loops
- Example: Instead of reading all files, read manifest once in fingerprint, query in check
- Verify: `time caliber score` completes in <3 seconds total

**Issue: "Fingerprint undefined in check — 'Cannot read property of undefined'"**
- Cause: Fingerprint field not populated by `collectFingerprint()`
- Fix: Verify field is added to `Fingerprint` interface AND set in `src/fingerprint/index.ts`
- Debug: Add `console.error('fingerprint:', fingerprint)` in check
- Verify: field is present before accessing

**Issue: "Test fails: 'mockFingerprint is not defined'"**
- Cause: Missing import or setup in test file
- Fix: Ensure test file imports `Fingerprint` type and creates mock:
  ```typescript
  const mockFingerprint: Fingerprint = { git: { /* ... */ }, /* ... */ };
  ```
- Verify: `npm run test -- src/scoring/__tests__/{category}.test.ts` passes
---
name: git-workflow
description: Git commit and PR workflow using Conventional Commits (feat/fix/docs/refactor/test/chore), feature branches, and pre-push verification with npm run test and npx tsc --noEmit. Use when user says 'commit', 'PR', 'push', 'changelog', or 'merge'. Do NOT use for git hooks setup (use caliber hooks command instead) or for CI/CD pipeline configuration.
---
# Git Workflow

## Critical

- **Always run pre-push verification** before opening a PR or pushing to main:
  ```bash
  npm run test      # Vitest must pass
  npx tsc --noEmit # TypeScript must have zero errors
  ```
  If either fails, fix the code and re-run. Do NOT push incomplete work.

- **Use Conventional Commits** format: `<type>(<scope>): <subject>`
  - `feat`: new feature (bumps minor version)
  - `fix`: bug fix (bumps patch)
  - `docs`: documentation only
  - `refactor`: code restructure (no feature/fix)
  - `test`: test additions/fixes
  - `chore`: deps, build config, cleanup
  - Example: `feat(llm): add Vertex AI provider support`

- **Work on feature branches**, never commit directly to `main`. Format: `feat/feature-name` or `fix/issue-name`.

## Instructions

1. **Create and switch to a feature branch**
   ```bash
   git checkout -b feat/your-feature-name
   # or for fixes:
   git checkout -b fix/your-fix-name
   ```
   Verify: `git branch` shows your new branch as current.

2. **Make commits with Conventional Commit messages**
   ```bash
   git add src/path/to/file.ts
   git commit -m "feat(scope): description of change"
   ```
   Verify: `git log --oneline -3` shows your commits with correct format.

3. **Run full test suite before pushing** (Step 1 output required)
   ```bash
   npm run test      # Vitest run (all tests must pass)
   npx tsc --noEmit # TypeScript strict mode (zero errors)
   ```
   If tests fail, fix the code and commit again. Do NOT skip this step.
   Verify: Both commands exit with code 0.

4. **Push your branch to remote**
   ```bash
   git push -u origin feat/your-feature-name
   ```
   Verify: GitHub branch appears in repo (check `git push` output for URL).

5. **Open a Pull Request**
   - Title: Use same Conventional Commit format: `feat(scope): description`
   - Body: Describe *why* the change, link any issues (`Closes #123`)
   - Example:
     ```
     feat(llm): add Vertex AI provider support

     - Adds `src/llm/vertex.ts` with ADC + service account auth
     - Integrates into `src/llm/config.ts` DEFAULT_MODELS
     - Tests in `src/llm/__tests__/vertex.test.ts`

     Closes #456
     ```
   Verify: PR title passes pre-commit lint check (no typos, correct scope).

6. **Address review feedback**
   - Make requested changes in new commits (same branch)
   - Commit message format: `fix(scope): address review feedback` or specific detail
   - Do NOT amend/rebase unless maintainer requests
   - Re-run tests after each change

7. **Merge to main** (maintainer or after approval)
   ```bash
   git checkout main
   git pull origin main
   git merge --ff-only feat/your-feature-name
   git push origin main
   ```
   Verify: GitHub shows commit merged into main, branch auto-deleted.

## Examples

**User says:** "Add support for OpenAI-compatible endpoints"

**Actions:**
1. `git checkout -b feat/openai-compat` (Step 1)
2. Create `src/llm/openai-compat.ts` with provider logic
3. Update `src/llm/config.ts` to register provider
4. Add tests in `src/llm/__tests__/openai-compat.test.ts`
5. `git add src/llm/` → `git commit -m "feat(llm): add OpenAI-compatible endpoint support"` (Step 2)
6. `npm run test && npx tsc --noEmit` → both pass (Step 3)
7. `git push -u origin feat/openai-compat` (Step 4)
8. Open PR titled `feat(llm): add OpenAI-compatible endpoint support`, link issue (Step 5)

**Result:** PR passes CI, ready for review.

---

**User says:** "Fix the Cursor ACP retry logic"

**Actions:**
1. `git checkout -b fix/cursor-acp-retry` (Step 1)
2. Edit `src/llm/cursor-acp.ts` to fix retry backoff
3. Update test in `src/llm/__tests__/cursor-acp.test.ts`
4. `git commit -m "fix(llm): correct Cursor ACP retry backoff calculation"` (Step 2)
5. `npm run test -- --filter=cursor` + `npx tsc --noEmit` (Step 3)
6. `git push -u origin fix/cursor-acp-retry` → Open PR → Merge after approval (Steps 4–7)

**Result:** Bug fixed, tests pass, change merged to main.

## Common Issues

**"fatal: not a git repository"**
- You are not in the project root. Run `cd /path/to/caliber` first.
- Verify: `git status` shows the repo, `ls` shows `.git` directory.

**"npm run test" fails with "Cannot find module 'vitest'"**
- Dependencies not installed. Run `npm install` (or `pnpm install` if using pnpm).
- Verify: `node_modules/vitest/` exists, `npm run test -- --version` shows version.

**"npx tsc --noEmit" reports 15 errors**
- TypeScript compilation failed. Fix each error (e.g., missing types, `null` checks, imports).
- Run `npx tsc --noEmit` again after each fix. Do NOT commit if errors remain.
- Verify: `npx tsc --noEmit` exits with code 0 (no output = success).

**"git push" rejected: "Updates were rejected because the tip of your branch is behind"**
- Remote has new commits. Sync your branch:
  ```bash
  git pull origin feat/your-feature-name --rebase
  ```
- Re-run tests: `npm run test && npx tsc --noEmit`
- Push again: `git push origin feat/your-feature-name`
- Verify: `git log --oneline` shows your commits on top.

**"Commit message doesn't match Conventional Commit format"**
- Reword the commit (only if not yet pushed):
  ```bash
  git commit --amend -m "feat(scope): correct message"
  git push -f origin feat/your-feature-name
  ```
- Or create a new commit with correct format (if already pushed).
- Verify: `git log --oneline -1` shows correct format.

**PR title has typo (e.g., "feat(llmm): ..." instead of "feat(llm): ...")** — Edit the PR title directly on GitHub. Verify: Title matches your branch's first commit scope.
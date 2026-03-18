---
name: writers-and-staging
description: Manage file writes for Claude/Cursor/Codex configs through staging pipeline. Use when implementing or modifying CLAUDE.md, SKILL.md, .cursor/rules/, or AGENTS.md output. Includes staging buffer (src/writers/staging.ts), manifest tracking (src/writers/manifest.ts), and backup management (src/writers/backup.ts). Do NOT use for LLM generation, scoring, or fingerprinting logic.
---
# Writers and Staging

## Critical

1. **Always use staging pipeline** — Never write directly to user files. All writes must flow through `src/writers/staging.ts` to buffer, validate, and await user confirmation.
2. **Track manifest on success** — After user confirms writes, update `.caliber/manifest.json` via `src/writers/manifest.ts`. This records what was written, when, and by which command.
3. **Create backups before overwrite** — If a file already exists and will be modified, call `createBackup()` from `src/writers/backup.ts` BEFORE staging. Backups go to `.caliber/backups/{filename}.{timestamp}.bak`.
4. **Validate output format** — Before staging, ensure output matches the target writer's schema (Anthropic Claude.md, Cursor ACP rules, Codex format). Use type guards from `src/writers/{claude,cursor,codex}/index.ts`.
5. **Use exact file paths** — Config paths are NOT relative to cwd. Use constants: `CLAUDE_CONFIG_PATH` (project root), `CURSOR_RULES_DIR` (`.cursor/rules/`), `CODEX_CONFIG_PATH` (project root).

## Instructions

1. **Import writer modules and types**
   ```typescript
   import { stagingPipeline } from 'src/writers/staging';
   import { updateManifest } from 'src/writers/manifest';
   import { createBackup } from 'src/writers/backup';
   import type { StagedFile } from 'src/writers/staging';
   ```
   Verify: Check that `staging.ts`, `manifest.ts`, `backup.ts` exist in `src/writers/`.

2. **Prepare backup if file exists** (only for modifications, not new files)
   ```typescript
   if (fileExists(targetPath)) {
     await createBackup(targetPath);
   }
   ```
   Verify: Backup file created at `.caliber/backups/{name}.{iso-timestamp}.bak`.

3. **Build StagedFile array with exact format**
   ```typescript
   const stagedFiles: StagedFile[] = [
     {
       path: absolutePath,
       content: fileContent,
       description: 'Brief reason for change',
     },
   ];
   ```
   Verify: Each `StagedFile.path` is absolute, `content` is string, `description` is non-empty.

4. **Invoke stagingPipeline with user context**
   ```typescript
   const confirmed = await stagingPipeline(stagedFiles, { logger, interactive: true });
   ```
   Verify: User sees staged diff and is prompted `(y/n)`. Returns `true` if accepted.

5. **Update manifest on confirmation**
   ```typescript
   if (confirmed) {
     await updateManifest({
       command: 'regenerate',
       files: stagedFiles.map(f => ({ path: f.path, action: 'write' })),
       timestamp: new Date().toISOString(),
     });
   }
   ```
   Verify: `.caliber/manifest.json` updated with write record.

6. **Return summary for CLI output**
   ```typescript
   return confirmed ? `✓ Written ${stagedFiles.length} file(s)` : '✗ Cancelled by user';
   ```

## Examples

**User says:** `caliber regenerate`

**Actions taken:**
1. LLM generates new CLAUDE.md content via `src/ai/generate.ts`.
2. Command calls `src/writers/claude/index.ts` to format it.
3. Check if `CLAUDE.md` exists → call `createBackup('CLAUDE.md')`.
4. Build `StagedFile` with path, content, description.
5. Call `stagingPipeline([claudeFile], { logger, interactive: true })`.
6. User sees:
   ```
   📝 Staged changes:
   - CLAUDE.md (12.4 KB)
   ─────────────────────
   + # My Project (new lines)
   ...
   Accept changes? (y/n)
   ```
7. If `y` → confirm returns `true` → `updateManifest()` writes record → return success msg.
8. If `n` → cancel, no writes, no manifest update.

**Result:** User can review before any files touch disk. Backup preserved if file was overwritten.

## Common Issues

**"EACCES: permission denied on write to /path/to/CLAUDE.md"**
- Root cause: File exists and is read-only or user lacks write permission.
- Fix: 1. Check permissions: `ls -la CLAUDE.md`. 2. Ensure user can write: `chmod 644 CLAUDE.md`. 3. Retry `caliber regenerate`.

**"Cannot read property 'path' of undefined" in staging pipeline**
- Root cause: `StagedFile.path` is undefined or relative.
- Fix: 1. Verify all `stagedFiles[i].path` are absolute paths. Use `path.resolve()` if needed. 2. Never pass relative paths like `./CLAUDE.md`; use full path from cwd.

**Manifest not updated after write**
- Root cause: `updateManifest()` was not called or threw silently.
- Fix: 1. Check `confirmed === true` before calling `updateManifest()`. 2. Verify `.caliber/` directory exists: `mkdir -p .caliber`. 3. Check manifest file permissions: `ls -la .caliber/manifest.json`.

**Backup file not created before overwrite**
- Root cause: `createBackup()` skipped or threw error.
- Fix: 1. Call `fileExists()` before backup. 2. Ensure `.caliber/backups/` writable: `mkdir -p .caliber/backups && chmod 755 .caliber/backups`. 3. Verify target file is readable before backup.

**"path is not absolute" in staging validation**
- Root cause: Using relative path in `StagedFile.path`.
- Fix: Convert to absolute: `path.resolve(process.cwd(), relativePath)`.
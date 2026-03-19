---
name: writers-pattern
description: Adds a new file writer following the established pattern in src/writers/. Writers export a function that returns string[] of written file paths, use fs.writeFileSync directly, and handle frontmatter generation for MARKDOWN files. Use when user says 'add writer', 'write config file', 'new platform output', or modifies src/writers/. Do NOT use for reading configs or querying existing files.
---
# Writers Pattern

## Critical

- Writers MUST export a default function: `export default async function write(config: WriterConfig, options?: WriterOptions): Promise<string[]>`
- ALWAYS use `fs.writeFileSync()` directly — writers handle their own error handling via try/catch
- MUST return an array of absolute file paths that were written
- For SKILL.md files: generate frontmatter, then append markdown body
- For CLAUDE.md / cursor rules: NO frontmatter, write raw markdown
- Check `WriterConfig` type in `src/writers/staging.ts` before writing
- Writers live in `src/writers/claude/index.ts`, `src/writers/cursor/index.ts`, `src/writers/codex/index.ts`

## Instructions

1. **Create the writer file** (e.g., `src/writers/codex/index.ts`):

```typescript
import * as fs from 'fs';
import * as path from 'path';

export default async function write(
  config: WriterConfig,
  options?: WriterOptions
): Promise<string[]> {
  const written: string[] = [];
  const targetDir = path.join(config.projectRoot, '.codex');

  if (!config.generatedRules || config.generatedRules.length === 0) {
    throw new Error('No generated rules available for Codex writer');
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const rulesPath = path.join(targetDir, 'rules.md');
  const content = `# Codex Rules\n\n${config.generatedRules.join('\n')}`;
  fs.writeFileSync(rulesPath, content, 'utf8');
  written.push(rulesPath);

  return written;
}
```

2. **Export from `src/writers/index.ts`**:

```typescript
export { default as codexWriter } from './codex/index.js';
```

3. **Invoke in `src/commands/regenerate.ts`** via the `callWriters()` function — add the new platform key to the writer map.

4. **Study existing writers** for exact patterns: `src/writers/claude/index.ts` writes `CLAUDE.md` as raw markdown; `src/writers/cursor/index.ts` writes `.cursor/rules/` files; `src/writers/codex/index.ts` shows the codex pattern.

5. **Build and verify**:

```bash
npm run build
caliber regenerate
ls .codex/
```

## Common Issues

**"Cannot read property 'generatedRules' of undefined"**
- Add guard before write: `if (!config.generatedRules) throw new Error('Missing generatedRules')`

**"ENOENT: no such file or directory"**
- Always call `fs.mkdirSync(targetDir, { recursive: true })` before `writeFileSync()`

**Files written but not tracked in manifest**
- Add new platform key to `WriterManifest` type in `src/writers/manifest.ts`
- Update `src/writers/manifest.ts` to include the new paths

**Writer not invoked during regenerate**
- Check `src/commands/regenerate.ts` — add new platform key to the `callWriters()` map

**Returned paths don't match written files**
- Use `path.resolve()` consistently; push resolved path before returning

---
name: writers-pattern
description: Adds a new file writer following the pattern in src/writers/. Writers generate and persist config files (CLAUDE.md, .cursor/rules/, AGENTS.md, skills) to disk, return string[] of written paths, use fs directly, and inject frontmatter. Use when: user says 'add writer', 'write config file', 'new platform output', or modifies src/writers/. Do NOT use for reading configs or parsing existing files.
---
# Writers Pattern

## Critical

- Writers are **synchronous** functions that return `string[]` (paths written).
- Always use `fs` module directly; never use async/await in writer functions.
- Every writer must export a default function with signature: `(config: WriterConfig, data: WriterData) => string[]`.
- Writers are invoked from `src/writers/staging.ts` after all generation is complete—do NOT call LLM or parse files.
- Frontmatter injection (for skills only): prepend YAML block before markdown content. Study `src/writers/cursor/rules-writer.ts` for exact format.
- Verify output directory exists before writing; create if missing using `mkdirSync(..., { recursive: true })`.

## Instructions

1. **Create writer file** at `src/writers/<platform>/index.ts` (or similar).
   - Study existing: `src/writers/claude/index.ts` (writes `CLAUDE.md`), `src/writers/cursor/index.ts` (writes `.cursor/rules/` + `.cursor/agents.json`), `src/writers/codex/index.ts`.
   - Verify: Each file imports `fs`, `path`, and types from `src/writers/types.ts`.

2. **Import required types** from `src/writers/types.ts`:
   ```typescript
   import { WriterConfig, WriterData } from '../types';
   import * as fs from 'fs';
   import * as path from 'path';
   ```
   Verify: Both `WriterConfig` and `WriterData` interfaces exist in `types.ts` before proceeding.

3. **Define writer function** with exact signature:
   ```typescript
   export default function writeMyPlatform(config: WriterConfig, data: WriterData): string[] {
     const writtenPaths: string[] = [];
     // implementation
     return writtenPaths;
   }
   ```
   Validate: Function body must be synchronous (no async/await).

4. **Handle directory creation**:
   ```typescript
   const outputDir = path.resolve(config.projectRoot, 'path/to/output');
   fs.mkdirSync(outputDir, { recursive: true });
   ```
   Verify: Directory exists before any write operation.

5. **Write files using `fs.writeFileSync()`**:
   - For CLAUDE.md or markdown: Use plain string content (no frontmatter unless skills).
   - For skills (markdown): Prepend YAML frontmatter block. See step 6.
   - Push each written path to `writtenPaths[]` before returning.
   Validate: All content is available in `data` object (do NOT call LLM).

6. **Inject frontmatter for skill files** (if applicable):
   ```typescript
   const frontmatter = `---\nname: ${skillName}\ndescription: ${skillDesc}\n---\n`;
   const content = frontmatter + markdownBody;
   fs.writeFileSync(filePath, content, 'utf8');
   ```
   Verify: Match frontmatter structure from existing skill files (e.g., `.cursor/rules/` in cursor writer).

7. **Export from parent index** (`src/writers/index.ts`):
   - Add import: `import writeMyPlatform from './my-platform/index.ts';`
   - Add to `WRITERS` object or export function that calls it.
   Validate: Parent index must expose your writer for invocation by `staging.ts`.

8. **Add writer invocation** to `src/writers/staging.ts` (if not already wired):
   - Call: `writtenPaths.push(...writeMyPlatform(config, data));`
   - Verify: Invoked only after all generation complete (no early returns on failures).

9. **Run and verify**:
   ```bash
   npm run build
   npm run test -- src/writers/__tests__/
   ```
   Validate: Output files exist at expected paths; frontmatter is valid YAML; all returned paths match written files.

## Examples

**User**: "Add a writer for the 'MyLLM' platform that outputs a JSON config file."

**Actions**:
1. Create `src/writers/my-llm/index.ts`.
2. Define `writeMyLlmConfig(config: WriterConfig, data: WriterData): string[]`.
3. Build config object from `data.config` and `data.agents`.
4. Write JSON to `${config.projectRoot}/.caliber/my-llm-config.json` using `fs.writeFileSync()`.
5. Push file path to `writtenPaths[]`; return it.
6. Import in `src/writers/index.ts` and export.
7. Call in `src/writers/staging.ts` after all other writers.
8. Run `npm run build` and verify `.caliber/my-llm-config.json` exists with correct JSON structure.

**Result**: Writer persists config, returns paths, integrates with staging pipeline.

## Common Issues

**"ENOENT: no such file or directory"** when writing:
- Directory does not exist before `writeFileSync()` call.
- **Fix**: Add `fs.mkdirSync(path.dirname(filePath), { recursive: true });` before write.

**"Frontmatter is invalid YAML" in test**:
- YAML block has unescaped special characters or incorrect formatting.
- **Fix**: Ensure `---` is on its own lines; use JSON.stringify() to escape strings in frontmatter values.

**Writer not called during `caliber init`**:
- Writer function not exported from parent index or not invoked in `staging.ts`.
- **Fix**: Verify import in `src/writers/index.ts` and add call in `staging.ts` after line with last writer invocation.

**Returned paths don't match written files**:
- Path calculated differently than actual write location (e.g., relative vs absolute).
- **Fix**: Use `path.resolve()` consistently; `writtenPaths.push(path.resolve(filePath));` and verify against `fs.existsSync(filePath)` after write.

**"Cannot read property 'agents' of undefined"**:
- `data.agents` or similar expected field missing from `WriterData`.
- **Fix**: Check `src/writers/types.ts` for actual `WriterData` shape; adjust access (e.g., `data.config?.agents`).
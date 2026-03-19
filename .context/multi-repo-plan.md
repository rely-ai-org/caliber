# External Context Sources for Caliber

*Reviewed via /plan-ceo-review (SCOPE EXPANSION mode). CEO plan: `~/.gstack/projects/rely-ai-org-caliber/ceo-plans/2026-03-19-multi-source-context.md`*

## Problem Statement

Caliber fingerprints and generates configs for a single repo in isolation. Teams with interdependent repos (frontend + shared component library, app + deployment infra, microservices) get configs that miss critical cross-repo context. The generated CLAUDE.md and skills don't reference shared conventions, deployment patterns, or API contracts from related sources.

**Generalized framing**: The real gap is that caliber can't see *anything* outside `cwd`. Multi-repo is one instance, but teams also keep context in standalone docs, wikis, and shared markdown files. The solution must support multiple source types — not just git repos.

## Architecture

```
  caliber init [--source ../path]
    │
    ▼
  ┌──────────────────────┐  ┌─────────────────────────────┐
  │ collectFingerprint() │  │ resolveAllSources()          │
  │  ├─ getFileTree      │  │  ├─ load .caliber/sources.json│
  │  ├─ readExisting     │  │  ├─ merge --source CLI flags │
  │  ├─ analyzeCode      │  │  ├─ merge auto-detected      │
  │  └─ enrichWithLLM()  │  │  │   workspaces (from LLM)   │
  │      detectProjectStack│ │  ├─ dedup by resolved path   │
  │      now also returns │  │  └─ for each source:         │
  │      workspaces[]     │  │      ├─ has summary.json?    │
  │                       │  │      │   → read it directly  │
  │                       │  │      └─ no summary?          │
  │                       │  │          → collectSourceSummary│
  └──────────┬───────────┘  └──────────────┬────────────────┘
             │  (parallel)                 │
             ▼                             ▼
         Fingerprint { sources: SourceSummary[] }
             │
             ▼
     buildGeneratePrompt()
       ├─ existing sections (file tree, code, configs)
       └─ "--- Related Sources ---" section (max 5, ~2500 tokens)
             │
             ▼
     streamGeneration() ──▶ setup JSON (source-aware)
             │
             ▼
     generateSkills() (source context in buildSkillContext)
             │
             ▼
     scoreAndRefine() (sources_configured, sources_referenced)
```

## Source Types

`.caliber/sources.json` schema — sources have a `type` field for dispatch:
```json
{
  "sources": [
    { "type": "repo", "path": "../shared-components", "role": "shared-library", "description": "Shared React component library" },
    { "type": "file", "path": "../org-standards/CONVENTIONS.md", "role": "org-standards", "description": "Org-wide coding standards" },
    { "type": "url", "url": "https://docs.internal/api-guidelines", "role": "api-guidelines", "description": "API design guidelines" }
  ]
}
```

Phase 1 implements `repo` and `file`. `url` is deferred (schema supports it from day 1).

## Source Resolution

Three inputs, merged and deduplicated:

1. **`.caliber/sources.json`** — explicit config, version-controlled
2. **`--source` CLI flags** — ad-hoc additions for a single run
3. **Auto-detected workspaces** — from `detectProjectStack()` LLM call (ecosystem-agnostic)

**Priority**: CLI flags > sources.json > auto-detected. Dedup by resolved absolute path. Higher-priority entry's metadata wins.

**Hard cap**: `MAX_SOURCES_IN_PROMPT = 5`. When more exist, sort by: source type priority (explicit > CLI > workspace), then proximity (sibling dirs before distant paths).

## Source Summary Collection

```typescript
interface SourceSummary {
  name: string;
  type: 'repo' | 'file' | 'url';
  role: string;
  description: string;
  gitRemoteUrl?: string;
  languages: string[];
  frameworks: string[];
  topLevelDirs: string[];
  keyFiles: string[];
  existingClaudeMd?: string;  // first 2000 chars if exists
  testCommand?: string;
  buildCommand?: string;
  // Optional — populated only from summary.json, not from fallback scan
  exports?: string[];
  apiSchemas?: string[];
  sharedTypes?: string[];
}
```

**Collection dispatch by type:**

| Type | Strategy | Token Cost |
|---|---|---|
| `repo` with `summary.json` | Read `.caliber/summary.json` directly — no LLM | ~200-400 tokens |
| `repo` without `summary.json` | Quick scan: top-level dirs, package name, CLAUDE.md, README + fast-model LLM summary | ~500-1000 tokens |
| `file` | Read file content, truncate to 2000 chars | ~500 tokens |
| `url` | Deferred to Phase 2 | — |

**Parallelization**: All source summary LLM calls run in parallel via `Promise.allSettled` (same pattern as skill generation).

**Caching**: Source summaries cached in `.caliber/cache/sources/{hash}.json`. Cache key = source path + top-level file listing hash. Same invalidation pattern as fingerprint cache.

## Workspace Auto-Detection (LLM-Driven)

The existing `detectProjectStack()` fast-model call in `enrichWithLLM()` gets one extra response field:

```typescript
// Current response: { languages, frameworks, tools }
// Extended:         { languages, frameworks, tools, workspaces? }
```

Prompt addition to `FINGERPRINT_SYSTEM_PROMPT`:
> - "workspaces": array of relative paths to related sub-projects, workspaces, or modules detected from workspace config files. Empty array if not a multi-project repo.

The LLM sees `pnpm-workspace.yaml`, `Cargo.toml [workspace]`, `go.work`, `BUILD` files, `settings.gradle` — whatever the ecosystem uses. No hardcoded parsing. Works for every ecosystem.

Detected workspace paths are resolved to absolute paths, filtered to dirs that actually exist, and treated as auto-detected sources with `role: "workspace-sibling"`.

## `caliber publish`

Generates `.caliber/summary.json` from the current fingerprint + existing CLAUDE.md:

```json
{
  "name": "@org/shared-components",
  "version": "1.0.0",
  "description": "Shared React component library",
  "languages": ["TypeScript"],
  "frameworks": ["React"],
  "conventions": "All components need Storybook stories. Use pnpm test.",
  "commands": { "test": "pnpm test", "build": "pnpm build" },
  "exports": ["Button", "Modal", "useAuth"],
  "topLevelDirs": ["src/", "tests/", "stories/"]
}
```

Reads from `collectFingerprint()` output + existing CLAUDE.md. Does NOT require a separate LLM call — it's a serialization of already-available data. When a consuming repo scans this source, `collectSourceSummary()` reads `summary.json` directly instead of re-analyzing.

## `caliber sources` Subcommand

- **`caliber sources list`** — tabular display of configured + auto-detected sources with status (reachable, has summary.json, last scanned)
- **`caliber sources add <path-or-url>`** — interactive: scans target, auto-detects type, suggests role, confirms, writes to `.caliber/sources.json`
- **`caliber sources remove <name>`** — removes from config

Uses `@inquirer/select` + `chalk` patterns consistent with `caliber config` and `caliber hooks`.

## Source-Aware `caliber refresh`

When `caliber refresh` runs:
1. Check each source's fingerprint hash (or `summary.json` mtime)
2. If a source changed since last refresh AND local repo has git diffs → include updated source summaries alongside the diff in the refresh prompt
3. If a source changed but NO local git diff → **source-only refresh**: send the LLM old vs new source summaries, ask it to update docs accordingly (new prompt mode)
4. If a source disappeared → skip with warning

## Source-Aware Scoring

Two new checks:
- **`sources_configured`** (bonus, 3 pts): `.caliber/sources.json` exists OR workspaces were auto-detected
- **`sources_referenced`** (grounding, 3 pts): If sources are configured, at least one source name/path appears in the generated CLAUDE.md

Added to `src/scoring/constants.ts` and a new check file in `src/scoring/checks/`.

## Error Handling

All source errors are **non-fatal**. Pattern: warn, skip that source, continue.

| Error | Action | User Sees |
|---|---|---|
| sources.json malformed | Skip all sources | "Warning: .caliber/sources.json is malformed, skipping sources" |
| Source path ENOENT | Skip that source | "Source ../foo not found, skipping" |
| Source inside cwd (circular) | Filter out | "Skipping ../foo: inside current project" |
| LLM failure for summary | File-only fallback | Silent |
| summary.json malformed | Fall back to scan | Silent |

## Files to Change

| File | Change |
|---|---|
| `src/fingerprint/sources.ts` (new) | `SourceSummary` type, `resolveAllSources()`, `collectSourceSummary()`, `readPublishedSummary()`, source caching |
| `src/fingerprint/index.ts` | Add `sources?: SourceSummary[]` and `workspaces?: string[]` to `Fingerprint` type |
| `src/ai/detect.ts` | Extend `detectProjectStack` response to include `workspaces` |
| `src/ai/prompts.ts` | Add workspace detection to `FINGERPRINT_SYSTEM_PROMPT`, add source context instructions to generation prompts |
| `src/ai/generate.ts` | `buildGeneratePrompt()` includes "Related Sources" section, `buildSkillContext()` includes source references |
| `src/ai/refresh.ts` | Source-aware refresh: check source hashes, source-only refresh mode |
| `src/commands/init.ts` | Accept `--source` flag, resolve sources in parallel with fingerprint, show in pipeline display |
| `src/commands/sources.ts` (new) | `caliber sources list/add/remove` subcommand |
| `src/commands/publish.ts` (new) | `caliber publish` command |
| `src/cli.ts` | Register `sources` and `publish` commands |
| `src/scoring/checks/sources.ts` (new) | `sources_configured` and `sources_referenced` checks |
| `src/scoring/constants.ts` | Add source check definitions |
| `src/fingerprint/cache.ts` | Source summary caching |
| Tests: `src/fingerprint/__tests__/sources.test.ts` (new) | Unit tests for source resolution, collection, caching |
| Tests: `src/scoring/__tests__/sources.test.ts` (new) | Unit tests for source scoring checks |

## Security

- Source summaries are injected in a clearly delimited prompt section (`--- Related Sources ---` / `--- End Related Sources ---`)
- Content is truncated to prevent prompt blow-up
- `caliber publish` must not include API keys, env vars, or credentials
- Workspace paths from LLM are validated: must exist, must be directories, must resolve to siblings (not outside parent)
- Remote URL fetching (Phase 2) must validate URLs, reject private IPs, use timeouts

## Open Questions (Resolved)

1. ~~Should `caliber refresh` also use sources?~~ **Yes** — accepted in review. Includes source-only refresh mode.
2. ~~Should source repos' CLAUDE.md content be propagated?~~ **Yes** — first 2000 chars, creates staleness risk addressed by source-only refresh.
3. ~~Bidirectional sources?~~ **Deferred** to TODOS.md. Keep it explicit and directional for now.
4. ~~MCP server integration?~~ **Not in scope** — already partially handled by existing MCP scoring check.

## Deferred Work (TODOS.md)

1. **Org-level context directory** (`~/.caliber/org/`) — P2, needs distribution design
2. **Bidirectional source awareness** — P3, needs constraint propagation design
3. **Remote URL source type** (`type: "url"`) — P2, schema supports it, implementation deferred

## Implementation Status

**IMPLEMENTED** — All Phase 1 features shipped:

| Feature | File(s) | Status |
|---|---|---|
| SourceSummary type + resolution | `src/fingerprint/sources.ts` | Done |
| Workspace auto-detection (LLM) | `src/ai/detect.ts`, `src/ai/prompts.ts` | Done |
| Fingerprint.sources | `src/fingerprint/index.ts` | Done |
| Workspace caching | `src/fingerprint/cache.ts` | Done |
| --source CLI flag | `src/commands/init.ts`, `src/cli.ts` | Done |
| Source context in prompts | `src/ai/generate.ts` | Done |
| Source-aware refresh | `src/ai/refresh.ts`, `src/commands/refresh.ts` | Done |
| Scoring checks | `src/scoring/checks/sources.ts`, `src/scoring/constants.ts` | Done |
| caliber sources list/add/remove | `src/commands/sources.ts`, `src/cli.ts` | Done |
| caliber publish | `src/commands/publish.ts`, `src/cli.ts` | Done |
| Unit tests | `src/fingerprint/__tests__/sources.test.ts`, `src/scoring/__tests__/sources.test.ts` | Done |

Build: passing | Tests: 50 files, 581 tests passing

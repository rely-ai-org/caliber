# CLAUDE.md — Caliber

## What Is This

`@rely-ai/caliber` — CLI that fingerprints projects and generates AI agent configs (`CLAUDE.md`, `.cursor/rules/`, `AGENTS.md`, skills). Supports Anthropic (`@anthropic-ai/sdk`), OpenAI (`openai`), Google Vertex AI (`@anthropic-ai/vertex-sdk`, `google-auth-library`), any OpenAI-compatible endpoint, Claude Code CLI (no API key), and Cursor ACP (no API key).

## Commands

```bash
npm run build          # tsup → dist/
npm run dev            # tsup --watch
npm run test           # Vitest run
npm run test:watch     # Vitest watch
npm run test:coverage  # v8 coverage
npx tsc --noEmit       # type-check only
npx vitest run src/scoring/__tests__/accuracy.test.ts  # single file
```

## Architecture

**Entry**: `src/bin.ts` → `src/cli.ts` (Commander.js)

**LLM** (`src/llm/`): `types.ts` (interface, `isSeatBased()`) · `config.ts` (`DEFAULT_MODELS`, `DEFAULT_FAST_MODELS`, `MODEL_CONTEXT_WINDOWS`, `getMaxPromptTokens`, `~/.caliber/config.json`) · `anthropic.ts` · `vertex.ts` · `openai-compat.ts` · `claude-cli.ts` (`claude -p`) · `cursor-acp.ts` (headless `agent --print`) · `seat-based-errors.ts` (shared error parsing) · `utils.ts` (`extractJson`, `estimateTokens`) · `index.ts` (`llmCall`, `llmJsonCall`, retry/backoff via `TRANSIENT_ERRORS`)

**AI** (`src/ai/`): `generate.ts` (streaming init) · `refine.ts` (chat refinement) · `refresh.ts` (diff-based updates) · `learn.ts` (session analysis) · `detect.ts` (LLM framework detection) · `prompts.ts` (all system prompts) · `score-refine.ts` (auto-fix scoring issues)

**Commands** (`src/commands/`): `init.ts` · `regenerate.ts` (alias `regen`/`re`) · `status.ts` · `undo.ts` · `config.ts` · `score.ts` · `refresh.ts` · `hooks.ts` · `learn.ts` · `recommend.ts`

**Fingerprint** (`src/fingerprint/`): `git.ts` · `file-tree.ts` · `existing-config.ts` · `code-analysis.ts` · `cache.ts` (`.caliber/cache/fingerprint.json`) · `index.ts` (orchestrates + LLM enrichment + caching)

**Writers** (`src/writers/`): `claude/index.ts` · `cursor/index.ts` · `codex/index.ts` · `staging.ts` (buffer before confirm) · `manifest.ts` (`.caliber/manifest.json`) · `backup.ts` (`.caliber/backups/`) · `refresh.ts`

**Scoring** (`src/scoring/`): Deterministic, no LLM. Checks in `src/scoring/checks/` — `existence.ts` · `quality.ts` · `grounding.ts` · `accuracy.ts` · `freshness.ts` · `bonus.ts`. Constants in `src/scoring/constants.ts`. Run: `caliber score`.

**Learner** (`src/learner/`): `storage.ts` (events → `.caliber/learning/`) · `writer.ts` (writes `CALIBER_LEARNINGS.md`) · `stdin.ts`. Finalize: `caliber learn finalize`.

**Scanner** (`src/scanner/index.ts`): `detectPlatforms()` · `scanLocalState()` · `compareState()`

**Packages**: `packages/mcp-server/` · `packages/shared/` · `apps/` (web + API — separate from CLI)

## LLM Provider Resolution

1. `ANTHROPIC_API_KEY` → Anthropic (`claude-sonnet-4-6`)
2. `VERTEX_PROJECT_ID` / `GCP_PROJECT_ID` → Vertex (`us-east5`; ADC or `VERTEX_SA_CREDENTIALS`)
3. `OPENAI_API_KEY` → OpenAI (`gpt-4.1`; `OPENAI_BASE_URL` for custom endpoints)
4. `CALIBER_USE_CURSOR_SEAT=1` → Cursor (headless `agent --print`)
5. `CALIBER_USE_CLAUDE_CLI=1` → Claude Code CLI (spawns `claude -p`)
6. `~/.caliber/config.json` — written by `caliber config`
7. `CALIBER_MODEL` — overrides model for any provider

## Two-Tier Model System

Fast model for lightweight tasks; full model for generation/refinement. `getFastModel()` resolves: `CALIBER_FAST_MODEL` → `ANTHROPIC_SMALL_FAST_MODEL` → config `fastModel` → `DEFAULT_FAST_MODELS[provider]`.
- Anthropic/Vertex fast: `claude-haiku-4-5-20251001`
- OpenAI fast: `gpt-4.1-mini`
- Cursor: default `sonnet-4.6`, fast `gpt-5.3-codex-fast`
- `ANTHROPIC_SMALL_FAST_MODEL` env var is scoped to anthropic/vertex only
- Callers spread `...(fastModel ? { model: fastModel } : {})` into call options.

## Testing

- **Framework**: Vitest (`globals: true`, `environment: node`), config in `vitest.config.ts`
- **Setup**: `src/test/setup.ts` — globally mocks `llmCall`/`llmJsonCall`/`getProvider`
- **Location**: `src/**/__tests__/*.test.ts`
- **Coverage**: v8; excludes `src/test/`, `src/bin.ts`, `src/cli.ts`, `src/commands/**`, `dist/**`
- **Single file**: `npx vitest run src/scoring/__tests__/accuracy.test.ts`

## Build & Deploy

```bash
npm run build          # compile TypeScript via tsup → dist/
npx tsc --noEmit       # type-check without emitting files
npm publish --access public   # publish @rely-ai/caliber to npm
npm version patch             # bump patch version before publish
```

## Key Conventions

- **ES module imports require `.js` extension** even for `.ts` source files
- Strict mode, ES2022 target, `moduleResolution: bundler` (`tsconfig.json`)
- Prefer `unknown` over `any`; explicit types on params/returns
- `throw new Error('__exit__')` — clean CLI exit, no stack trace
- Use `ora` spinners with `.fail()` before rethrowing async errors
- Transient LLM errors auto-retry in `llmCall()` via `TRANSIENT_ERRORS` array
- JSON from LLM: always use `extractJson()` from `src/llm/utils.ts`, never raw `JSON.parse()`
- Telemetry via `posthog-node` — wrap commands with `tracked()` in `src/cli.ts`
- Key deps: `commander`, `chalk`, `ora`, `diff`, `glob`, `tsup`, `@inquirer/confirm`, `@inquirer/select`, `@inquirer/checkbox`, `posthog-node`
- API keys stored in `~/.caliber/config.json` with `0600` permissions — never in project files

## Commit Convention

`feat:` → minor · `fix:`/`refactor:`/`chore:` → patch · `feat!:` → major
Scope optional: `feat(scanner): detect Cursor config`
Do NOT include Co-Authored-By headers in commits.

## Permissions

See `.claude/settings.json`. Never commit API keys or credentials.

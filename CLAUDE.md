# CLAUDE.md — Caliber

## What Is This

`@rely-ai/caliber` — CLI that fingerprints projects and generates AI agent configs (CLAUDE.md, .cursor/rules/, AGENTS.md, skills). Supports Anthropic (`@anthropic-ai/sdk`), OpenAI (`openai`), Google Vertex AI (`@anthropic-ai/vertex-sdk`, `google-auth-library`), any OpenAI-compatible endpoint, Claude Code CLI (no API key), and Cursor ACP (no API key).

## Commands

```bash
npm run build          # Compile via tsup → dist/
npm run dev            # Watch mode (tsup --watch)
npm run test           # Run Vitest suite
npm run test:watch     # Vitest in watch mode
npm run test:coverage  # v8 coverage report
npx tsc --noEmit       # Type-check only
npx vitest run src/scoring/__tests__/accuracy.test.ts  # Single file
```

## Architecture

**Entry**: `src/bin.ts` → `src/cli.ts` (Commander.js, all commands)

**LLM** (`src/llm/`): `types.ts` interface · `config.ts` (env → `~/.caliber/config.json`, `DEFAULT_MODELS`, `DEFAULT_FAST_MODELS`) · `anthropic.ts` · `vertex.ts` · `openai-compat.ts` · `claude-cli.ts` (Claude Code CLI via `claude -p`) · `cursor-acp.ts` (Cursor Agent via JSON-RPC) · `utils.ts` (`extractJson`, `estimateTokens`) · `index.ts` (`llmCall`, `llmJsonCall`, retry/backoff)

**AI** (`src/ai/`): `generate.ts` (streaming init) · `refine.ts` (chat refinement) · `refresh.ts` (diff-based updates) · `learn.ts` (session analysis) · `detect.ts` (LLM framework detection) · `prompts.ts` (all system prompts)

**Commands** (`src/commands/`): `init`, `regenerate` (alias `regen`/`re`), `status`, `undo`, `config`, `skills`, `score`, `refresh`, `hooks`, `learn`

**Fingerprint** (`src/fingerprint/`): `git.ts` · `file-tree.ts` · `existing-config.ts` · `code-analysis.ts` · `index.ts` (orchestrates, LLM enrichment built-in)

**Writers** (`src/writers/`): `claude/` · `cursor/` · `codex/` (AGENTS.md + `.agents/skills/`) · `staging.ts` (buffer before confirm) · `manifest.ts` (`.caliber/manifest.json`) · `backup.ts` (`.caliber/backups/`) · `refresh.ts`

**MCP** (`src/mcp/`): `index.ts` (orchestration) · `search.ts` (MCP server discovery) · `validate.ts` (server validation) · `config-extract.ts` (extract config from servers) · `types.ts` · `prompts.ts`

**Scoring** (`src/scoring/`): Deterministic, no LLM. Categories: existence · quality · coverage · accuracy · freshness · bonus. Constants in `scoring/constants.ts`. Run: `caliber score`.

**Learner** (`src/learner/`): `storage.ts` (session events → `.caliber/learning/`) · `writer.ts` · `stdin.ts`. Finalize: `caliber learn finalize`.

**Scanner** (`src/scanner/index.ts`): `detectPlatforms()` (claude, cursor, codex) · `scanLocalState()` · `compareState()`

**Packages**: `packages/mcp-server/` (MCP server) · `packages/shared/` (shared utils) · `apps/` (web + API — separate from CLI)

## LLM Provider Resolution

1. `ANTHROPIC_API_KEY` → Anthropic (`claude-sonnet-4-6`)
2. `VERTEX_PROJECT_ID` / `GCP_PROJECT_ID` → Vertex (`us-east5`; ADC, `VERTEX_SA_CREDENTIALS`, or `GOOGLE_APPLICATION_CREDENTIALS`)
3. `OPENAI_API_KEY` → OpenAI (`gpt-4.1`; `OPENAI_BASE_URL` for custom endpoints)
4. `CALIBER_USE_CURSOR_SEAT=1` → Cursor ACP (no API key; uses Cursor Agent CLI)
5. `CALIBER_USE_CLAUDE_CLI=1` → Claude Code CLI (no API key; uses `claude -p`)
6. `~/.caliber/config.json` — written by `caliber config`
7. `CALIBER_MODEL` — overrides model for any provider

## Two-Tier Model System

Lightweight tasks (classification, scoring, extraction) auto-use a cheaper/faster model; heavy tasks (generation, refinement) use the default model. `getFastModel()` resolves via: `CALIBER_FAST_MODEL` env → `ANTHROPIC_SMALL_FAST_MODEL` env → config file `fastModel` field → `DEFAULT_FAST_MODELS[provider]`. Auto-defaults: Anthropic/Vertex → `claude-haiku-4-5-20251001`, OpenAI → `gpt-4.1-mini`. Cursor and Claude CLI have no fast default (falls back to default model). Callers spread `...(fastModel ? { model: fastModel } : {})` into LLM call options.

## Testing

- **Framework**: Vitest (`globals: true`, `environment: node`)
- **Setup**: `src/test/setup.ts` — globally mocks `llmCall`/`llmJsonCall`/`getProvider`
- **Location**: `src/**/__tests__/*.test.ts`
- **Coverage**: v8; excludes `src/test/`, `src/bin.ts`, `src/cli.ts`, `src/commands/**`, `dist/**`

## Key Conventions

- **ES module imports require `.js` extension** even for `.ts` source files
- Strict mode, ES2022 target, `moduleResolution: bundler`
- Prefer `unknown` over `any`; explicit types on params/returns
- `throw new Error('__exit__')` — clean CLI exit, no stack trace
- Use `ora` spinners with `.fail()` before rethrowing async errors
- Transient LLM errors auto-retry in `llmCall()` via `TRANSIENT_ERRORS`
- Key deps: `commander`, `chalk`, `ora`, `diff`, `glob`, `tsup`, `@inquirer/confirm`, `@inquirer/select`, `@inquirer/checkbox`

## Commit Convention

`feat:` → minor · `fix:`/`refactor:`/`chore:` → patch · `feat!:` → major
Scope optional: `feat(scanner): detect Cursor config`
Do NOT include Co-Authored-By headers in commits.

## Permissions

See `.claude/settings.json`. Never commit API keys or credentials.
# Caliber Learnings

Accumulated patterns and anti-patterns from development sessions.
Auto-managed by [caliber](https://github.com/rely-ai-org/caliber) — do not edit manually.

- **[gotcha]** `agent --print` in non-interactive runs can fail with **Workspace Trust Required**; pass `--trust`/`--yolo`/`-f` (or trust once interactively) before using it in automation.
- **[fix]** Cursor provider performance degrades badly when `agent acp` is spawned per LLM call during `caliber init`; reuse a long-lived ACP process/connection instead of reinitializing for every call.
- **[fix]** In Cursor ACP, enabling `--mode ask` caused outputs to ignore strict JSON expectations and return conversational audit text; removing `--mode ask` restored better prompt adherence.
- **[gotcha]** Updating `DEFAULT_MODELS.cursor` does **not** update existing users automatically if `~/.caliber/config.json` already has `"model": "auto"`; update the user config explicitly when testing new defaults.
- **[fix]** Community skill search frequently timed out at 60s with slower providers; increasing init search timeout to 120s and trimming skill-content fetch fanout/timeouts reduced timeout failures.
- **[pattern]** If merging to `next` fails from the main checkout, use the project’s `next` worktree (`/Users/alonpe/conductor/workspaces/caliber/bandung`) to pull/merge/push.
- **[correction]** Reproduce `caliber init` issues in the user’s actual target repo (`~/Development/infra-core`), not in the `caliber` source repo.
- **[pattern]** Run a real local CLI smoke test before merging provider transport changes to `next`; unit tests passed while live `caliber init` still failed in runtime conditions.
- **[fix]** Cursor `agent --print` prompts that include literal `[[System]]` / `[[User]]` markers can trigger a false "prompt injection attempt" refusal; switching to plain prompt text (no bracketed role markers) restored normal JSON-capable responses.
- **[gotcha]** With `agent --print --output-format stream-json`, stdout is an event stream (`system`, `thinking`, `assistant`, `result`), and the structured payload is in the `result` event’s `result` field (JSON string). Do not parse the full mixed stream as one JSON document.
- **[pattern]** When `caliber init` fails with "Could not parse LLM response", reproduce locally by running the same model via `agent --print --trust` against the real generation prompt shape; this isolates prompt/transport formatting issues faster than relying only on the final error log.
- **[correction]** When merging feature branches to `next` from the main checkout, use the project's `next` worktree (`/Users/alonpe/conductor/workspaces/caliber/bandung`) to pull, merge, and push — the main checkout may not have the `next` branch checked out.
- **[gotcha]** Git merge conflicts in CLAUDE.md can occur when both branches update the LLM architecture description. When merging to `next`, preserve both the HEAD additions (e.g., `MODEL_CONTEXT_WINDOWS`, `getMaxPromptTokens`) and the incoming branch additions (e.g., `isSeatBased()`, `seat-based-errors.ts`).
- **[pattern]** Always run `npx tsc --noEmit && npx vitest run` before committing LLM provider changes — the test suite validates all provider implementations have stderr mocks and proper process handling.
- **[correction]** Seat-based providers (cursor, claude-cli) need to capture stderr on `stdio: ['pipe', 'pipe', 'pipe']` in spawn calls, not `'inherit'` — inheriting stderr loses error context needed for actionable messages.
- **[pattern]** Use `parseSeatBasedError(stderr: string, exitCode: number | null)` from `seat-based-errors.ts` for both Cursor and Claude CLI providers to detect auth failures, rate limits, and model unavailability — this avoids duplicated error parsing logic.
- **[fix]** If Vitest test mocks for child_process are missing the `stderr` EventEmitter, mock spawn return values fail with "Cannot read properties of undefined (reading 'on')". Add `stderr: { on: vi.fn() }` to all mock return values when stdio is `['pipe', 'pipe', 'pipe']`.
- **[convention]** Exponential backoff for LLM retries should use `1000 * Math.pow(2, attempt - 1)` (1s, 2s, 4s) not fixed delays — this reduces load during transient errors without making the user wait unnecessarily on the first retry.
- **[gotcha]** Cursor provider with `--print --output-format stream-json` outputs multiple events (`assistant` deltas with `timestamp_ms`, then final `result` event). Streaming must skip duplicate final events to avoid doubling text — check for `timestamp_ms` presence to detect real deltas.
- **[pattern]** When adding auth checks to interactive provider setup, import and call `isCursorLoggedIn()` from `cursor-acp.ts` during setup, not just `isCursorAgentAvailable()` — catches the case where agent binary exists but user hasn't authenticated.

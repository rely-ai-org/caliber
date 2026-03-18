# TODOS

## P2: Token usage tracking for Cursor provider
**What:** Parse `usage` from Cursor stream-json result events, call `trackUsage()`.
**Why:** Zero visibility into token consumption for Cursor users — API providers show usage summaries, Cursor shows nothing.
**Context:** The result event format is `{"type":"result","usage":{"inputTokens":N,"outputTokens":N,"cacheReadTokens":N}}`. Verified in session 2026-03-18 (see `~/.claude/projects/.../memory/cursor-provider.md`). Data is already in the stream, just not parsed. ~30 LOC in `cursor-acp.ts` + import `trackUsage` from `usage.ts`.
**Effort:** S (human: ~2 hrs / CC: ~10 min)
**Depends on:** Nothing.

## P3: listModels() for Vertex provider
**What:** Implement `listModels()` on VertexProvider (currently unimplemented).
**Why:** Model recovery (`model-recovery.ts`) falls back to hardcoded `KNOWN_MODELS` which may go stale.
**Context:** Vertex SDK should support model listing via the Anthropic SDK's `models.list()` method. Currently only Anthropic and OpenAI implement this.
**Effort:** S (human: ~2 hrs / CC: ~10 min)
**Depends on:** Nothing.

## P2: Auto-accept for high-confidence re-runs
**What:** When re-running `caliber init` with score >=90 and `.caliber/` already exists, auto-apply changes and show undo instructions instead of prompting for review.
**Why:** Power users running init repeatedly shouldn't face the same review prompt every time. Near-zero friction for confident re-runs.
**Context:** The `--auto-approve` flag exists but is a blunt instrument. This would be a smart default based on confidence score + re-run detection. Requires first-run vs re-run awareness (`.caliber/` dir detection) to ship first.
**Effort:** S (human: ~2 hrs / CC: ~10 min)
**Depends on:** First-run vs re-run awareness feature.

## P3: Windows CI test runner
**What:** Add a Windows GitHub Actions runner to test seat-based providers on Windows.
**Why:** Windows shell escaping in claude-cli.ts and cursor-acp.ts is untested.
**Context:** Both providers use `shell: true` on Windows but no test validates argument escaping with special characters.
**Effort:** M (human: ~4 hrs / CC: ~30 min)
**Depends on:** Nothing.

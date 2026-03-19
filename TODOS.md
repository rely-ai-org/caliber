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

## P2: Org-level context directory
**What:** `~/.caliber/org/` directory with markdown files that get injected into every project's generation prompt as org-wide standards.
**Why:** Teams have org-wide rules (commit style, PR process, testing standards) that should appear in every repo's config without per-repo configuration. Currently requires each repo to list an org-standards repo as a source or manually add rules to every CLAUDE.md.
**Pros:** Zero per-repo config for org-wide conventions. Team leads set rules once.
**Cons:** Distribution problem — how do rules reach 20 developers' machines? Needs design thinking about sync mechanisms (git submodule? caliber org sync? shared config repo?).
**Context:** Deferred from multi-source CEO review (Proposal 7). Per-repo sources ship first to learn how teams actually share context. Design the org-level flow informed by real usage patterns.
**Effort:** M (human: ~1 week / CC: ~1 hour)
**Depends on:** Multi-source Phase 1 shipped and validated.

## P3: Bidirectional source awareness
**What:** When repo A lists repo B as a source, surface repo B's constraints and conventions in repo A's config automatically (e.g., "never call UserService.delete() without audit logging").
**Why:** Currently sources are one-directional. B's rules don't propagate to A, so cross-repo constraint violations go undetected.
**Pros:** Catches cross-repo constraint violations. True team-level awareness.
**Cons:** Creates dependency chains and staleness risk. Transitive dependencies (A→B→C) add complexity.
**Context:** Requires `caliber publish` to include constraint/convention data in `summary.json`. Needs design for staleness detection and circular dependency handling. Deferred from multi-source CEO review.
**Effort:** L (human: ~2 weeks / CC: ~3 hours)
**Depends on:** Multi-source Phase 1 + `caliber publish` shipped.

## P2: Remote URL source type
**What:** Implement the `url` source type in `.caliber/sources.json` — fetch a URL (webpage, raw markdown, API docs), extract text, summarize via LLM, inject as source context.
**Why:** The sources schema supports `type: "url"` from day 1 but Phase 1 only implements `repo` and `file`. Teams with standards in Notion, Confluence, or internal wikis can't use sources until this ships.
**Pros:** Covers the "context lives outside git" use case. Makes sources truly universal.
**Cons:** URL fetching introduces network dependencies, auth challenges (private wikis), content extraction complexity.
**Context:** The `fetchSkillContent` pattern in `src/commands/recommend.ts` is reusable. Cache aggressively — URLs don't change often. Deferred from multi-source CEO review.
**Effort:** M (human: ~1 week / CC: ~1 hour)
**Depends on:** Multi-source Phase 1 shipped.

## P3: Refactor cross-platform parity scoring for N agents
**What:** Change parity check from hardcoded `hasClaudeConfigs && hasCursorConfigs` to "any 2 of N configured platforms."
**Why:** With GitHub Copilot as a 4th agent, the parity check ignores Copilot entirely. Users targeting Claude+Copilot don't get parity points.
**Context:** `src/scoring/checks/existence.ts:197-223`. The `hasParity` variable is currently `hasClaudeConfigs && hasCursorConfigs`. Refactor to count platforms with configs and check `>= 2`. Changes scoring semantics — users who only target non-Claude+Cursor pairs would newly get parity points.
**Effort:** S (human: ~1 hr / CC: ~5 min)
**Depends on:** Copilot support.

## P3: Dynamic score badge service
**What:** HTTP endpoint (e.g. Cloudflare Worker) that returns a shields.io-compatible badge with a repo's Caliber score, auto-updated from CI.
**Why:** Users embed auto-updating score badges in their READMEs — every badge is a free acquisition channel. Gamification drives score improvement.
**Context:** Static badge template ships in the README reposition PR. Dynamic version needs a small API that reads score from CI artifacts or a score registry. Could use shields.io endpoint badge format.
**Effort:** M (human: ~1 week / CC: ~2 hrs)
**Depends on:** CI integration for automated score computation.

## P3: Windows CI test runner
**What:** Add a Windows GitHub Actions runner to test seat-based providers on Windows.
**Why:** Windows shell escaping in claude-cli.ts and cursor-acp.ts is untested.
**Context:** Both providers use `shell: true` on Windows but no test validates argument escaping with special characters.
**Effort:** M (human: ~4 hrs / CC: ~30 min)
**Depends on:** Nothing.

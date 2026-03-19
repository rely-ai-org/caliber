<p align="center">
  <img src="assets/social-preview.png" alt="Caliber — AI setup tailored for your codebase" width="900">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rely-ai/caliber"><img src="https://img.shields.io/npm/v/@rely-ai/caliber" alt="npm version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@rely-ai/caliber" alt="license"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@rely-ai/caliber" alt="node"></a>
  <img src="https://img.shields.io/badge/caliber-89%2F100-green" alt="Caliber Score">
  <img src="https://img.shields.io/badge/Claude_Code-supported-blue" alt="Claude Code">
  <img src="https://img.shields.io/badge/Cursor-supported-blue" alt="Cursor">
  <img src="https://img.shields.io/badge/Codex-supported-blue" alt="Codex">
</p>

---

### Try it — zero install, zero commitment

```bash
npx @rely-ai/caliber score
```

Score your AI agent config in 3 seconds. No API key. No changes to your code. Just a score.

> **Your code stays on your machine.** Scoring is 100% local — no LLM calls, no code sent anywhere. Generation uses your own AI subscription (Claude Code, Cursor) or your own API key (Anthropic, OpenAI, Vertex AI). Caliber never sees your code.

---

Caliber scores, generates, and keeps your AI agent configs in sync with your codebase. It fingerprints your project — languages, frameworks, dependencies, architecture — and produces tailored configs for **Claude Code**, **Cursor**, and **OpenAI Codex**. When your code evolves, Caliber detects the drift and updates your configs to match.

<p align="center">
  <img src="assets/demo.gif" alt="Caliber demo" width="640">
</p>

## Before / After

Most repos start with a hand-written `CLAUDE.md` and nothing else. Here's what Caliber finds — and fixes:

```
  Before                                    After caliber init
  ──────────────────────────────            ──────────────────────────────

  Agent Config Score    35 / 100            Agent Config Score    94 / 100
  Grade D                                   Grade A

  FILES & SETUP           6 / 25            FILES & SETUP          24 / 25
  QUALITY                12 / 25            QUALITY                22 / 25
  GROUNDING               7 / 20            GROUNDING              19 / 20
  ACCURACY                5 / 15            ACCURACY               13 / 15
  FRESHNESS               5 / 10            FRESHNESS              10 / 10
  BONUS                   0 / 5             BONUS                   5 / 5
```

Scoring is deterministic — no LLM, no API calls. It cross-references your config files against your actual project filesystem: do referenced paths exist? Are code blocks present? Is there config drift since your last commit?

```bash
caliber score --compare main    # See how your branch changed the score
```

## Audits first, writes second

Caliber never overwrites your existing configs without asking. The workflow mirrors code review:

1. **Score** — read-only audit of your current setup
2. **Propose** — generate or improve configs, shown as a diff
3. **Review** — accept, refine via chat, or decline each change
4. **Backup** — originals saved to `.caliber/backups/` before every write
5. **Undo** — `caliber undo` restores everything to its previous state

If your existing config scores **95+**, Caliber skips full regeneration and applies targeted fixes to the specific checks that are failing.

## How It Works

Caliber is not a one-time setup tool. It's a loop:

```
          caliber score
              │
              ▼
  ┌──── caliber init ◄────────────────┐
  │     (generate / fix)              │
  │           │                       │
  │           ▼                       │
  │     your code evolves             │
  │     (new deps, renamed files,     │
  │      changed architecture)        │
  │           │                       │
  │           ▼                       │
  └──► caliber refresh ──────────────►┘
       (detect drift, update configs)
```

Auto-refresh hooks run this loop automatically — on every commit or at the end of each AI coding session.

### What It Generates

**Claude Code**
- `CLAUDE.md` — Project context, build/test commands, architecture, conventions
- `CALIBER_LEARNINGS.md` — Patterns learned from your AI coding sessions
- `.claude/skills/*/SKILL.md` — Reusable skills ([OpenSkills](https://agentskills.io) format)
- `.mcp.json` — Auto-discovered MCP server configurations
- `.claude/settings.json` — Permissions and hooks

**Cursor**
- `.cursor/rules/*.mdc` — Modern rules with frontmatter (description, globs, alwaysApply)
- `.cursor/skills/*/SKILL.md` — Skills for Cursor
- `.cursor/mcp.json` — MCP server configurations

**OpenAI Codex**
- `AGENTS.md` — Project context for Codex
- `.agents/skills/*/SKILL.md` — Skills for Codex

## Key Features

<details>
<summary><strong>Any Codebase</strong></summary>

TypeScript, Python, Go, Rust, Java, Ruby, Terraform, and more. Language and framework detection is fully LLM-driven — no hardcoded mappings. Caliber works on any project.

</details>

<details>
<summary><strong>Any AI Tool</strong></summary>

Target a single platform or all three at once:
```bash
caliber init --agent claude        # Claude Code only
caliber init --agent cursor        # Cursor only
caliber init --agent codex         # Codex only
caliber init --agent all           # All three
caliber init --agent claude,cursor # Comma-separated
```

</details>

<details>
<summary><strong>Chat-Based Refinement</strong></summary>

Not happy with the generated output? During review, refine via natural language — describe what you want changed and Caliber iterates until you're satisfied.

</details>

<details>
<summary><strong>MCP Server Discovery</strong></summary>

Caliber detects the tools your project uses (databases, APIs, services) and auto-configures matching MCP servers for Claude Code and Cursor.

</details>

<details>
<summary><strong>Deterministic Scoring</strong></summary>

`caliber score` evaluates your config quality without any LLM calls — purely by cross-referencing config files against your actual project filesystem.

| Category | Points | What it checks |
|---|---|---|
| **Files & Setup** | 25 | Config files exist, skills present, MCP servers, cross-platform parity |
| **Quality** | 25 | Code blocks, concise token budget, concrete instructions, structured headings |
| **Grounding** | 20 | Config references actual project directories and files |
| **Accuracy** | 15 | Referenced paths exist on disk, config freshness vs. git history |
| **Freshness & Safety** | 10 | Recently updated, no leaked secrets, permissions configured |
| **Bonus** | 5 | Auto-refresh hooks, AGENTS.md, OpenSkills format |

Every failing check includes structured fix data — when `caliber init` runs, the LLM receives exactly what's wrong and how to fix it.

</details>

<details>
<summary><strong>Session Learning</strong></summary>

Caliber watches your AI coding sessions and learns from them. Hooks capture tool usage, failures, and your corrections — then an LLM distills operational patterns into `CALIBER_LEARNINGS.md`.

```bash
caliber learn install      # Install hooks for Claude Code and Cursor
caliber learn status       # View hook status, event count, and ROI summary
caliber learn finalize     # Manually trigger analysis (auto-runs on session end)
caliber learn remove       # Remove hooks
```

Learned items are categorized by type — **[correction]**, **[gotcha]**, **[fix]**, **[pattern]**, **[env]**, **[convention]** — and automatically deduplicated.

</details>

<details>
<summary><strong>Auto-Refresh</strong></summary>

Keep configs in sync with your codebase automatically:

| Hook | Trigger | What it does |
|---|---|---|
| **Git pre-commit** | Before each commit | Refreshes docs and stages updated files |
| **Claude Code session end** | End of each session | Runs `caliber refresh` and updates docs |
| **Learning hooks** | During each session | Captures events for session learning |

```bash
caliber hooks --install    # Enable refresh hooks
caliber hooks --remove     # Disable refresh hooks
```

The `refresh` command analyzes your git diff (committed, staged, and unstaged changes) and updates config files to reflect what changed.

</details>

<details>
<summary><strong>Fully Reversible</strong></summary>

- **Automatic backups** — originals saved to `.caliber/backups/` before every write
- **Score regression guard** — if a regeneration produces a lower score, changes are auto-reverted
- **Full undo** — `caliber undo` restores everything to its previous state
- **Dry run** — preview changes with `--dry-run` before applying

</details>

## Commands

| Command | Description |
|---|---|
| `caliber score` | Score config quality (deterministic, no LLM) |
| `caliber score --compare <ref>` | Compare current score against a git ref |
| `caliber init` | Full setup wizard — analyze, generate, review, install hooks |
| `caliber regenerate` | Re-analyze and regenerate configs (aliases: `regen`, `re`) |
| `caliber refresh` | Update docs based on recent code changes |
| `caliber skills` | Discover and install community skills |
| `caliber learn` | Session learning — install hooks, view status, finalize analysis |
| `caliber hooks` | Manage auto-refresh hooks |
| `caliber config` | Configure LLM provider, API key, and model |
| `caliber status` | Show current setup status |
| `caliber undo` | Revert all changes made by Caliber |

## FAQ

<details>
<summary><strong>Does it overwrite my existing configs?</strong></summary>

No. Caliber shows you a diff of every proposed change. You accept, refine, or decline each one. Originals are backed up automatically.

</details>

<details>
<summary><strong>Does it need an API key?</strong></summary>

**Scoring:** No. `caliber score` runs 100% locally with no LLM.

**Generation:** Uses your existing Claude Code or Cursor subscription (no API key needed), or bring your own key for Anthropic, OpenAI, or Vertex AI.

</details>

<details>
<summary><strong>What if I don't like what it generates?</strong></summary>

Refine it via chat during review, or decline the changes entirely. If you already accepted, `caliber undo` restores everything. You can also preview with `--dry-run`.

</details>

<details>
<summary><strong>Does it work with monorepos?</strong></summary>

Yes. Run `caliber init` from any directory. `caliber refresh` can update configs across multiple repos when run from a parent directory.

</details>

<details>
<summary><strong>Does it send my code anywhere?</strong></summary>

Scoring is fully local. Generation sends your project fingerprint (not source code) to whatever LLM provider you configure — the same provider your AI editor already uses. Anonymous usage analytics (no code, no file contents) can be disabled via `caliber config`.

</details>

## Add a Caliber badge to your repo

After scoring your project, add a badge to your README:

![Caliber Score](https://img.shields.io/badge/caliber-94%2F100-brightgreen)

Copy this markdown and replace `94` with your actual score:

```
![Caliber Score](https://img.shields.io/badge/caliber-SCORE%2F100-COLOR)
```

Color guide: `brightgreen` (90+), `green` (70-89), `yellow` (40-69), `red` (<40).

## LLM Providers

No API key? No problem. Caliber works with your existing AI tool subscription:

| Provider | Setup | Default Model |
|---|---|---|
| **Claude Code** (your seat) | `caliber config` → Claude Code | Inherited from Claude Code |
| **Cursor** (your seat) | `caliber config` → Cursor | Inherited from Cursor |
| **Anthropic** | `export ANTHROPIC_API_KEY=sk-ant-...` | `claude-sonnet-4-6` |
| **OpenAI** | `export OPENAI_API_KEY=sk-...` | `gpt-4.1` |
| **Vertex AI** | `export VERTEX_PROJECT_ID=my-project` | `claude-sonnet-4-6` |
| **Custom endpoint** | `OPENAI_API_KEY` + `OPENAI_BASE_URL` | `gpt-4.1` |

Override the model for any provider: `export CALIBER_MODEL=<model-name>` or use `caliber config`.

Caliber uses a **two-tier model system** — lightweight tasks (classification, scoring) auto-use a faster model, while heavy tasks (generation, refinement) use the default. This keeps costs low and speed high.

Configuration is stored in `~/.caliber/config.json` with restricted permissions (`0600`). API keys are never written to project files.

<details>
<summary>Vertex AI advanced setup</summary>

```bash
# Custom region
export VERTEX_PROJECT_ID=my-gcp-project
export VERTEX_REGION=europe-west1

# Service account credentials (inline JSON)
export VERTEX_PROJECT_ID=my-gcp-project
export VERTEX_SA_CREDENTIALS='{"type":"service_account",...}'

# Service account credentials (file path)
export VERTEX_PROJECT_ID=my-gcp-project
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

</details>

<details>
<summary>Environment variables reference</summary>

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible endpoint |
| `VERTEX_PROJECT_ID` | GCP project ID for Vertex AI |
| `VERTEX_REGION` | Vertex AI region (default: `us-east5`) |
| `VERTEX_SA_CREDENTIALS` | Service account JSON (inline) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service account JSON file path |
| `CALIBER_USE_CLAUDE_CLI` | Use Claude Code CLI (`1` to enable) |
| `CALIBER_USE_CURSOR_SEAT` | Use Cursor subscription (`1` to enable) |
| `CALIBER_MODEL` | Override model for any provider |
| `CALIBER_FAST_MODEL` | Override fast model for any provider |

</details>

## Requirements

- **Node.js** >= 20
- **One LLM provider:** your **Claude Code** or **Cursor** subscription (no API key), or an API key for Anthropic / OpenAI / Vertex AI

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for detailed guidelines.

```bash
git clone https://github.com/rely-ai-org/caliber.git
cd caliber
npm install
npm run dev      # Watch mode
npm run test     # Run tests
npm run build    # Compile
```

Uses [conventional commits](https://www.conventionalcommits.org/) — `feat:` for features, `fix:` for bug fixes.

## License

MIT

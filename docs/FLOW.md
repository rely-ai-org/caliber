# Caliber: Install and init flow

## How users run Caliber

- **Global install:** `npm install -g @rely-ai/caliber` then `caliber init` or `caliber config`
- **npx (no install):** `npx @rely-ai/caliber init` or `npx @rely-ai/caliber config`

---

## 1. After `npm install` (global)

When the package is installed globally, the **postinstall** script runs and prints:

```
Caliber installed successfully!

  Get started:
    caliber config   Set up LLM: Cursor (your seat), Anthropic, OpenAI, or Vertex
    caliber init     Analyze your project and generate agent configs

  Use your current seat: choose "Claude Code" or "Cursor" in caliber config (or set CALIBER_USE_CLAUDE_CLI=1 / CALIBER_USE_CURSOR_SEAT=1).
  Or set ANTHROPIC_API_KEY / OPENAI_API_KEY and run caliber init.
```

So the flow is: **install → postinstall message → user runs `caliber config` or sets env → user runs `caliber init`**.

With **npx**, there is no postinstall (npx runs the binary from cache). The user goes straight to `npx @caliber-ai/caliber init`; if no LLM is configured, init prints the same options and exits.

---

## 2. LLM config resolution (when `caliber init` or any command needs an LLM)

`loadConfig()` in `src/llm/config.ts` is used. Order:

1. **Environment variables** (first match wins):
   - `ANTHROPIC_API_KEY` → Anthropic provider
   - `VERTEX_PROJECT_ID` or `GCP_PROJECT_ID` → Vertex
   - `OPENAI_API_KEY` → OpenAI (or custom base URL)
   - `CALIBER_USE_CURSOR_SEAT=1` or `true` → Cursor (use Cursor Agent via ACP, no API key)
   - `CALIBER_USE_CLAUDE_CLI=1` or `true` → Claude Code (use `claude -p` with stored app login, no API key)

2. **Config file** `~/.caliber/config.json`  
   Written by `caliber config`. Can set `provider: "claude-cli" | "cursor" | "anthropic" | "vertex" | "openai"` and optionally `model`, `apiKey`, etc.

So a user can:

- Run **`caliber config`** once, choose e.g. **Cursor** or **Anthropic**, and from then on `caliber init` uses `~/.caliber/config.json` (unless env vars override).
- Or **skip config** and set `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `CALIBER_USE_CURSOR_SEAT=1` in the shell; init then works with no config file.

---

## 3. `caliber init` step-by-step

1. **Step 1 — Check LLM**  
   `loadConfig()`. If `null`, print:
   - Run `caliber config` and choose "Claude Code" or "Cursor" (no API key), or
   - Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `VERTEX_PROJECT_ID`, or
   - Set `CALIBER_USE_CLAUDE_CLI=1` or `CALIBER_USE_CURSOR_SEAT=1`  
   Then exit with `__exit__`.

2. **Step 2 — Scan**  
   Collect fingerprint (languages, frameworks, file tree, existing configs). Optionally enrich with LLM.

3. **Step 3 — Target agent**  
   User chooses Claude Code / Cursor / Both (or it’s passed as `--agent`).

4. **Step 4 — Generate**  
   `getProvider()` builds the LLM provider from config (**Claude Code CLI**, Cursor ACP, Anthropic, Vertex, or OpenAI). Generation uses that provider (streaming, retries, etc.).

5. **Step 5 — Review**  
   User accepts, refines, or declines. Then we write files and optionally install hooks.

---

## 4. “Current seat” vs API key

| Seat / provider | How it works |
|-----------------|--------------|
| **Claude Code** | No API key. We spawn `claude -p "<prompt>"`; the CLI uses the user's stored login (Pro/Max/Team). User must install the [Claude Code CLI](https://claude.ai/install) and run `claude` once to log in. |
| **Cursor**      | No API key. We spawn `agent acp`; Cursor Agent uses the user's Cursor subscription (user must run `agent login` once or set `CURSOR_API_KEY`). |
| **Claude (API key)** | Set `ANTHROPIC_API_KEY` in the environment. Get a key at [console.anthropic.com](https://console.anthropic.com); separate billing from Pro/Max/Team subscription. |

So **Claude Code** and **Cursor** can both use "current seat" without any API key. For API-based use, set `ANTHROPIC_API_KEY` yourself.

---
name: llm-provider
description: Multi-provider LLM layer patterns for @rely-ai/caliber. Use when calling llmCall/llmJsonCall, adding a new LLM provider, handling streaming responses, parsing JSON from LLM output, or configuring provider credentials.
---
# LLM Provider Layer

All LLM calls go through `src/llm/`. Never import provider SDKs (`@anthropic-ai/sdk`, `openai`, `@anthropic-ai/vertex-sdk`) directly in commands or AI logic — use the helpers.

## Core Helpers

```typescript
import { llmCall, llmJsonCall } from '../llm/index.js';

// Plain text response
const text = await llmCall({
  system: 'You are a code analyst.',
  prompt: 'Summarize this file: ...',
});

// Structured JSON response — parsed and typed
const result = await llmJsonCall<{ frameworks: string[] }>({
  system: 'Extract frameworks as JSON.',
  prompt: 'Here is the package.json: ...',
});
```

`llmCall()` and `llmJsonCall()` automatically:
- Resolve the active provider via `getProvider()`
- Retry on transient errors with exponential backoff (`TRANSIENT_ERRORS`)
- Parse JSON using `extractJson()` (bracket-balancing) or `parseJsonResponse()`

## Streaming

For streaming generation (like `caliber init`), use the provider directly:

```typescript
import { getProvider } from '../llm/index.js';

const provider = getProvider();
await provider.stream(
  { system, prompt },
  {
    onText: (chunk) => process.stdout.write(chunk),
    onComplete: (fullText) => { /* finalize */ },
    onError: (err) => { /* handle */ },
  }
);
```

## Adding a New Provider

1. Create `src/llm/<provider>.ts` implementing `LLMProvider` from `types.ts`:

```typescript
import type { LLMProvider, LLMCallOptions, LLMStreamOptions, LLMStreamCallbacks, LLMConfig } from './types.js';

export class MyProvider implements LLMProvider {
  constructor(private config: LLMConfig) {}
  async call(options: LLMCallOptions): Promise<string> { /* ... */ }
  async stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void> { /* ... */ }
}
```

2. Add a detection branch in `createProvider()` in `src/llm/index.ts`
3. Add env var detection in `resolveFromEnv()` in `src/llm/config.ts`
4. Add a default model entry to `DEFAULT_MODELS` in `src/llm/config.ts`

## Existing Providers

| Provider | Class | Trigger |
|----------|-------|--------|
| `anthropic` | `AnthropicProvider` | `ANTHROPIC_API_KEY` |
| `vertex` | `VertexProvider` | `VERTEX_PROJECT_ID` / `GCP_PROJECT_ID` |
| `openai` | `OpenAICompatProvider` | `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL`) |
| `cursor` | `CursorAcpProvider` | `CALIBER_USE_CURSOR_SEAT=1` or `caliber config` → Cursor |
| `claude-cli` | `ClaudeCliProvider` | `CALIBER_USE_CLAUDE_CLI=1` or `caliber config` → Claude Code |

The `cursor` and `claude-cli` providers require no API key — they use the user's existing subscription via the Cursor Agent CLI (`agent`) or Claude Code CLI (`claude -p`) respectively.

## JSON Parsing Utilities

```typescript
import { extractJson, stripMarkdownFences, parseJsonResponse, estimateTokens } from '../llm/utils.js';

// extractJson: bracket-balancing extraction from prose
// stripMarkdownFences: remove ```json ... ``` wrappers
// parseJsonResponse: full pipeline (strip → extract → JSON.parse)
// estimateTokens: rough char/4 token count
```
# LLM Provider Layer

## Critical

- **Never** import `@anthropic-ai/sdk`, `openai`, or `@anthropic-ai/vertex-sdk` in commands or `src/ai/`. All calls go through `src/llm/index.ts`.
- **JSON from LLM**: Use `parseJsonResponse<T>()` (or `extractJson()` + `JSON.parse`) from `src/llm/utils.ts`. Never raw `JSON.parse()` on LLM output.
- **Streaming**: Use `getProvider()` then `provider.stream(options, { onText, onEnd, onError })`. Callbacks are `onEnd` (not `onComplete`), with optional `meta?: { stopReason?, usage? }`.

## Instructions

1. **Non-streaming call (text)**  
   Import `llmCall` from `src/llm/index.js`. Call with `{ system, prompt, model?, maxTokens? }` (`LLMCallOptions`). Returns `Promise<string>`.  
   **Verify:** No direct SDK imports in the same file.

2. **Non-streaming call (JSON)**  
   Import `llmJsonCall` from `src/llm/index.js`. Same options; returns `Promise<T>`. Uses `parseJsonResponse()` internally.  
   **Verify:** Response shape matches the generic type `T`.

3. **Use fast model for lightweight tasks**  
   Import `getFastModel` from `src/llm/config.js`. Spread into options: `...(getFastModel() ? { model: getFastModel() } : {})`.  
   **Verify:** Used for detection, learn, refresh, skill generation — not for main init/regenerate stream.

4. **Streaming**  
   Import `getProvider` from `src/llm/index.js`. `provider.stream(options, { onText: (text) => void, onEnd: (meta?) => void, onError: (err: Error) => void })`. Options: `LLMStreamOptions` = `LLMCallOptions` + optional `messages?: { role, content }[]`.  
   **Verify:** Stream errors (e.g. transient) are handled in `onError`; retry logic lives in the caller (e.g. `generate.ts`).

5. **Validate model before long/streaming work**  
   In commands that stream or do long LLM work, call `await validateModel({ fast: true })` from `src/llm/index.js` early (e.g. in `init`, `regenerate`, `learn`, `refresh`).  
   **Verify:** Called before any `getProvider()` or `llmCall` in that command path.

6. **Adding a new provider**  
   (a) Add type to `ProviderType` in `src/llm/types.ts`. (b) Create `src/llm/<name>.ts` with a class implementing `LLMProvider`: `call(options: LLMCallOptions): Promise<string>` and `stream(options: LLMStreamOptions, callbacks: LLMStreamCallbacks): Promise<void>`; optional `listModels?(): Promise<string[]>`. (c) In `src/llm/index.ts`, add case in `createProvider(config)` and throw if runtime check fails (e.g. `isCursorAgentAvailable()`). (d) In `src/llm/config.ts`, add env branch in `resolveFromEnv()` and entry in `DEFAULT_MODELS` (and `DEFAULT_FAST_MODELS` if applicable).  
   **Verify:** `npx tsc --noEmit` and that `loadConfig()` can resolve the new provider from env or config file.

7. **Custom JSON parsing from raw text**  
   Use `stripMarkdownFences(raw)` then `extractJson(cleaned)`; if non-null, `JSON.parse(json)`. For full pipeline use `parseJsonResponse<T>(raw)` from `src/llm/utils.js`.  
   **Verify:** No `JSON.parse` on unsanitized LLM output.

## Examples

**User says:** "Use the LLM to classify the framework."  
**Actions:** Import `llmJsonCall` from `../llm/index.js` and `getFastModel` from `../llm/config.js`. Call `llmJsonCall<{ framework: string }>({ system: '...', prompt: projectSummary, ...(getFastModel() ? { model: getFastModel() } : {}) })`.  
**Result:** Typed object; transient errors retried by `llmCall`; model not available may trigger interactive recovery.

**User says:** "Stream the generation and show status updates."  
**Actions:** Import `getProvider` from `../llm/index.js`. Get `provider = getProvider()`, then `provider.stream({ system, prompt, maxTokens }, { onText, onEnd, onError })`. Buffer text in `onText`; in `onEnd` parse JSON from buffer with `extractJson` or `stripMarkdownFences` + slice; handle truncation/retry in caller.  
**Result:** Streaming with status; same callback pattern as `src/ai/generate.ts` and `src/ai/refine.ts`.

## Common Issues

- **"No LLM provider configured"**  
  Set one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VERTEX_PROJECT_ID`/`GCP_PROJECT_ID`, or `CALIBER_USE_CURSOR_SEAT=1` / `CALIBER_USE_CLAUDE_CLI=1`; or run `caliber config` and select a provider.

- **"No JSON found in LLM response"**  
  Use `parseJsonResponse()` or `extractJson()` from `src/llm/utils.js` on the raw string. If you already use `llmJsonCall`, the failure is from the model output; tighten the prompt (e.g. "Respond with only a JSON object") or add fallback handling.

- **"Unknown provider: X"**  
  Add the provider in `createProvider()` in `src/llm/index.ts`, in `resolveFromEnv()` and `DEFAULT_MODELS` in `src/llm/config.ts`, and to the `ProviderType` union in `src/llm/types.ts`.

- **Stream fails with "socket hang up" or "ECONNRESET"**  
  These are transient; `llmCall` retries automatically. For streaming, the caller must retry (e.g. `generate.ts` checks `isTransientError` in `onError` and retries with backoff).

- **"Model X is not available"**  
  `llmCall`/`validateModel` run `handleModelNotAvailable` when `isModelNotAvailableError` is true. In non-interactive mode, user must run `caliber config` to pick a different model; ensure error message suggests that.

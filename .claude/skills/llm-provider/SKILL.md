---
name: llm-provider
description: Multi-provider LLM layer with llmCall/llmJsonCall streaming and JSON parsing. Use when adding a provider, making LLM calls, handling streaming, or fixing retry logic. Supports Anthropic, Vertex, OpenAI-compatible, Claude CLI, Cursor ACP. Do NOT use for CLI config UI, scoring checks, or fingerprinting.
---
# LLM Provider Layer

## Critical

1. **Provider resolution order is hardcoded** in `src/llm/index.ts`:
   - `ANTHROPIC_API_KEY` → Anthropic (`claude-sonnet-4-6`)
   - `VERTEX_PROJECT_ID`/`GCP_PROJECT_ID` → Vertex (`us-east5`)
   - `OPENAI_API_KEY` → OpenAI (`gpt-4.1`; respects `OPENAI_BASE_URL`)
   - `CALIBER_USE_CURSOR_SEAT=1` → Cursor ACP (no API key)
   - Fallback: Claude CLI (`claude -p`, no API key)
   - **DO NOT change this order without updating all provider tests**

2. **Transient errors trigger automatic retry** via `TRANSIENT_ERRORS` constant in `src/llm/index.ts`. Check before implementing custom retry logic.

3. **Seat-based providers** (Cursor, Claude CLI) use `isSeatBased()` from `src/llm/types.ts`. Never prompt for API key if `isSeatBased()` returns true.

4. **JSON parsing uses `extractJson()`** from `src/llm/utils.ts`. Always pass raw LLM response through this; do not assume JSON in response body.

## Instructions

### Step 1: Use existing llmCall or llmJsonCall
**Verify before proceeding:** Check `src/llm/index.ts` exports.

For non-JSON responses:
```typescript
import { llmCall } from '@/llm';
const response = await llmCall({
  messages: [{ role: 'user', content: 'analyze this' }],
  system: 'You are an expert',
  model: getFastModel(), // or 'claude-sonnet-4-6'
});
```

For JSON responses:
```typescript
import { llmJsonCall } from '@/llm';
const result = await llmJsonCall<MyType>({
  messages: [...],
  system: 'Return valid JSON',
  schema: { type: 'object', properties: { ... } },
});
```

### Step 2: Implement streaming (if needed)
**Verify before proceeding:** Confirm caller needs real-time token output.

Use `provider.stream()` from resolved provider:
```typescript
const provider = await getProvider(); // auto-resolves from env
const stream = await provider.stream({ messages, system });
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

Pattern from `src/ai/generate.ts`: Initialize spinner, consume stream, update spinner with final text.

### Step 3: Handle JSON extraction from streaming
**Verify before proceeding:** Response contains JSON but mixed with markdown.

After consuming stream, pass to `extractJson()` from `src/llm/utils.ts`:
```typescript
import { extractJson } from '@/llm/utils';
const parsed = extractJson<T>(rawResponse);
// Returns { success: boolean, data?: T, raw: string }
```

Check `success` before using `data`. On failure, log `raw` for debugging.

### Step 4: Resolve model via getFastModel()
**Verify before proceeding:** Do not hardcode model names.

For fast/cheap operations (e.g., scoring, detection):
```typescript
import { getFastModel } from '@/llm/config';
const model = getFastModel(); // returns config-based fast model
await llmCall({ messages, model });
```

For primary generation, use explicit model from `DEFAULT_MODELS` in `src/llm/config.ts`.

### Step 5: Add new provider
**Verify before proceeding:** Understand LLM interface in `src/llm/types.ts`.

1. Create `src/llm/YOUR_PROVIDER.ts` implementing `LLMProvider` interface:
   ```typescript
   export interface LLMProvider {
     call(opts: LLMCallOptions): Promise<string>;
     stream(opts: LLMCallOptions): AsyncIterable<string>;
   }
   ```
2. Register in `src/llm/index.ts` `getProvider()` function **before Cursor/CLI fallback**.
3. Add tests in `src/llm/__tests__/YOUR_PROVIDER.test.ts` (use mocking; never hit real API in tests).
4. Update `CLAUDE.md` with new env var and model default in this file.

### Step 6: Fix retry/backoff issues
**Verify before proceeding:** Error is in `TRANSIENT_ERRORS` constant.

Transient errors auto-retry up to 3x with exponential backoff in `llmCall/llmJsonCall`. For permanent errors:
1. Check `src/llm/seat-based-errors.ts` for seat-based error parsing.
2. If new error type, add to constant and implement parser in provider file.
3. Test with: `npm run test -- src/llm/__tests__/YOUR_PROVIDER.test.ts`.

## Examples

### Example 1: Make a simple LLM call for analysis

**User says:** "Generate analysis of this code snippet."

**Actions:**
1. Import: `import { llmCall } from '@/llm';`
2. Call:
   ```typescript
   const analysis = await llmCall({
     messages: [{
       role: 'user',
       content: `Analyze this code: ${codeSnippet}`
     }],
     system: 'You are a code analyst.',
     model: 'claude-sonnet-4-6',
   });
   ```
3. Verify success: Check `analysis` is non-empty string.

**Result:** Plain text analysis returned; no retry overhead visible to caller (auto-handled by `llmCall`).

### Example 2: Stream skill generation with JSON extraction

**User says:** "Generate a skill file and stream output."

**Actions:**
1. Get provider:
   ```typescript
   const provider = await getProvider();
   ```
2. Stream to user:
   ```typescript
   const stream = await provider.stream({
     messages: [{ role: 'user', content: skillPrompt }],
     system: 'Generate a Markdown skill file.',
   });
   let fullText = '';
   for await (const chunk of stream) {
     process.stdout.write(chunk);
     fullText += chunk;
   }
   ```
3. Extract JSON from markdown:
   ```typescript
   const { success, data } = extractJson<SkillType>(fullText);
   if (!success) throw new Error(`Failed to parse skill: ${fullText}`);
   ```
4. Verify extraction succeeded before proceeding.

**Result:** User sees real-time tokens; parsed skill object ready for writing.

## Common Issues

### "No provider found"
**Cause:** No `ANTHROPIC_API_KEY`, `VERTEX_PROJECT_ID`, `OPENAI_API_KEY`, `CALIBER_USE_CURSOR_SEAT`, or Claude CLI installed.

**Fix:**
1. Check env vars: `echo $ANTHROPIC_API_KEY` (or `VERTEX_PROJECT_ID`, etc.)
2. If none set, install Claude CLI: `npm install -g @anthropic-ai/claude-cli`
3. Verify CLI works: `claude -v`
4. If still failing, error message will specify which provider failed last.

### "JSON parse failed"
**Cause:** `extractJson()` returned `{ success: false }`; LLM did not return valid JSON.

**Fix:**
1. Log `raw` from extraction result: `console.log(result.raw)`
2. Check if response is wrapped in markdown code block: `extractJson()` handles ` ```json ``` ` automatically.
3. If prompt issue, add `Return ONLY valid JSON, no markdown or explanation` to system prompt.
4. Retry with `getFastModel()` (cheaper) or explicit slower model if critical.

### "Transient error: rate_limit_exceeded (429)"
**Cause:** Provider API throttled; auto-retry should handle this.

**Fix:**
1. Verify error is in `TRANSIENT_ERRORS` in `src/llm/index.ts`: `'rate_limit_exceeded'` should be present.
2. Check retry count in error message: if "Attempt 3/3 failed", all retries exhausted.
3. Wait 30 seconds and retry manually; do not call LLM in a tight loop.
4. For production, increase backoff multiplier in `llmCall()` logic.

### "Cursor: agent --print failed"
**Cause:** Cursor ACP provider (`src/llm/cursor-acp.ts`) spawned process failed.

**Fix:**
1. Verify Cursor is installed: `which cursor` or `cursor --version`
2. Check if `CALIBER_USE_CURSOR_SEAT=1` is set: `echo $CALIBER_USE_CURSOR_SEAT`
3. Run manually: `cursor agent --print 'test'` to see raw error.
4. If "Cursor not found", remove `CALIBER_USE_CURSOR_SEAT` and fallback to next provider.

### "Model not found: xyz"
**Cause:** Hardcoded model name does not exist in provider's catalog.

**Fix:**
1. Check `src/llm/config.ts` `DEFAULT_MODELS` for correct name (e.g., `claude-sonnet-4-6`, not `claude-sonnet`).
2. For OpenAI-compatible endpoints, verify `OPENAI_BASE_URL` is set and model exists there: `curl -H "Authorization: Bearer $OPENAI_API_KEY" $OPENAI_BASE_URL/models | grep xyz`
3. Use `getFastModel()` instead of hardcoding if possible.
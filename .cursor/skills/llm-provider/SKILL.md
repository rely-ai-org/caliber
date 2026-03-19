---
name: llm-provider
description: Implements or modifies an LLM provider in src/llm/ implementing the LLMProvider interface from src/llm/types.ts. All calls go through src/llm/index.ts (llmCall, llmJsonCall). Use when user says 'add provider', 'new LLM', 'support model X', or modifies src/llm/. Do NOT use for calling LLM from commands—use llm-call skill instead.
---
# LLM Provider

## Critical

- **Must implement `LLMProvider` interface** from `src/llm/types.ts` — every provider exports `{ call, jsonCall, streamingCall, estimate }`
- **All provider calls flow through `src/llm/index.ts`** (`llmCall`, `llmJsonCall`, `streamingCall`) — never call provider directly from commands
- **Error handling is mandatory**: wrap calls in try/catch; return or re-throw `LLMError` with `code` and `message` matching `src/llm/types.ts`
- **Register new providers** in `src/llm/config.ts` and `src/llm/index.ts` detection logic before any usage
- **Model context windows** must be added to `MODEL_CONTEXT_WINDOWS` in `src/llm/config.ts` before `estimate()` is called

## Instructions

1. **Define provider interface compliance**
   - Study `src/llm/types.ts` — verify these exports exist: `LLMProvider`, `LLMCall`, `LLMError`, `StreamingCallOptions`
   - Ensure your provider will have: `call(req)`, `jsonCall(req)`, `streamingCall(req, onChunk)`, `estimate(text)`
   - Verify: "I can map my provider's request/response to `LLMCall` and return `{ content, model, stop_reason, usage }` format"

2. **Create provider file** (e.g., `src/llm/new-provider.ts`)
   - Copy structure from existing provider: `src/llm/anthropic.ts` or `src/llm/openai-compat.ts`
   - Import types: `import { LLMProvider, LLMCall, LLMError } from './types'`
   - Export a function `export const newProvider = (): LLMProvider => ({ ... })`
   - Validate: File compiles with `npx tsc --noEmit`

3. **Implement `call()` method**
   - Accept `LLMCall` request (model, messages, system, temperature, max_tokens)
   - Translate to provider's API format (headers, payload, auth)
   - Return `{ content: string, model: string, stop_reason: string, usage: { input_tokens, output_tokens } }`
   - Handle non-200 responses as `LLMError` with `code: 'invalid_request_error'` or `'rate_limit_error'` (from `src/llm/types.ts`)
   - Validate: Error has `message` and `code` fields matching provider's actual error

4. **Implement `jsonCall()` method**
   - Accept same `LLMCall` + add `schema?: z.ZodSchema` for structured output
   - Use `extractJson()` from `src/llm/utils.ts` if provider doesn't natively support JSON mode
   - Return same format as `call()` but content is valid JSON string
   - Validate: `JSON.parse(response.content)` succeeds

5. **Implement `streamingCall()` method**
   - Accept `LLMCall` + `onChunk: (chunk) => void` callback
   - Stream response token-by-token, calling `onChunk({ type: 'text', text })` for each token
   - On complete, call `onChunk({ type: 'message_stop' })` and return final `LLMCall` response
   - Validate: At least one `onChunk` callback fires; final return matches `call()` format

6. **Implement `estimate()` method**
   - Count tokens using provider's tokenizer or approximation (Claude ~4 chars/token)
   - Return `{ input_tokens: number, output_tokens: number }`
   - Validate: `estimate('hello')` returns object with both fields > 0

7. **Register provider in `src/llm/config.ts`**
   - Add model names to `DEFAULT_MODELS` or `DEFAULT_FAST_MODELS` array (e.g., `'gpt-4o'`)
   - Add context window to `MODEL_CONTEXT_WINDOWS`: `'gpt-4o': 128000`
   - Validate: Models appear in both places if they are new

8. **Register detection in `src/llm/index.ts`**
   - Add condition in `resolveProvider()` function (checks env vars, config, available auth)
   - Return provider instance: `return newProvider()`
   - Order matters: check most specific (env + key combo) before generic
   - Validate: `caliber score` or any command detects your provider without explicit `--provider` flag

9. **Test provider end-to-end**
   - Create `src/llm/__tests__/new-provider.test.ts` following `src/llm/__tests__/anthropic.test.ts` pattern
   - Test: `call()`, `jsonCall()`, `estimate()`, error scenarios
   - Run: `npx vitest run src/llm/__tests__/new-provider.test.ts`
   - Validate: All tests pass; no type errors from `npx tsc --noEmit`

10. **Integration test via llmCall**
    - In `src/llm/index.ts` tests or new command test, call `llmCall({ model: 'your-model', ... })`
    - Verify it routes to your provider and returns valid response
    - Validate: Response content is non-empty string; usage fields exist

## Examples

### Example: Add OpenAI-compatible provider

**User says:** "Add support for Together AI (openai-compatible)"

**Actions:**
1. Create `src/llm/together-ai.ts`:
```typescript
import { LLMProvider, LLMCall, LLMError } from './types';
import { estimateTokens } from './utils';

export const togetherAI = (): LLMProvider => ({
  call: async (req) => {
    const url = 'https://api.together.xyz/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}` },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.max_tokens,
      }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new LLMError(data.error?.message || 'API error', 'invalid_request_error');
    }
    const data = await res.json();
    return {
      content: data.choices[0].message.content,
      model: req.model,
      stop_reason: data.choices[0].finish_reason,
      usage: { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens },
    };
  },
  jsonCall: async (req) => {
    const res = await this.call(req);
    if (req.schema) {
      req.schema.parse(JSON.parse(res.content));
    }
    return res;
  },
  streamingCall: async (req, onChunk) => {
    // Implement streaming via SSE
    const res = await fetch('https://api.together.xyz/v1/chat/completions', { /* ... */ });
    const reader = res.body?.getReader();
    // ... parse SSE, call onChunk() per token
    return { content: '', model: req.model, stop_reason: 'stop', usage: { input_tokens: 0, output_tokens: 0 } };
  },
  estimate: (text) => estimateTokens(text),
});
```

2. In `src/llm/config.ts`:
```typescript
export const DEFAULT_MODELS = [
  'together-ai/mistral-7b',
  // ...
];
export const MODEL_CONTEXT_WINDOWS = {
  'together-ai/mistral-7b': 32768,
  // ...
};
```

3. In `src/llm/index.ts` `resolveProvider()`:
```typescript
if (process.env.TOGETHER_API_KEY) {
  return togetherAI();
}
```

**Result:** `caliber score` now auto-detects Together AI; `llmCall({ model: 'together-ai/mistral-7b' })` works end-to-end.

## Common Issues

**"Cannot find name 'LLMProvider'" or type errors**
- Verify import: `import { LLMProvider, LLMCall, LLMError } from './types'` exists in your file
- Run `npx tsc --noEmit` to confirm all imports resolve
- Check `src/llm/types.ts` was not renamed/moved

**"Provider not detected; falls back to default"**
- Verify env var is set: `echo $PROVIDER_API_KEY`
- Verify `resolveProvider()` in `src/llm/index.ts` checks that env var BEFORE other providers
- Check: Is your provider condition reachable? (No early `return` blocking it)
- Test: Call `caliber config` and check `Detected LLM provider` line

**"LLMError: 'X' is not assignable to type code"**
- Check `src/llm/types.ts` `LLMError` for allowed `code` values (e.g., `'invalid_request_error'`, `'rate_limit_error'`, `'auth_error'`)
- Use `code` that exactly matches the type union
- Example: `throw new LLMError(msg, 'auth_error')` ✓; `throw new LLMError(msg, 'bad_auth')` ✗

**"estimate() returns 0 tokens or crashes"**
- Verify provider's tokenizer is available (not just API-side)
- Fall back to `estimateTokens()` from `src/llm/utils.ts`: `return estimateTokens(text)`
- Check: `estimate('')` should return `{ input_tokens: 0, output_tokens: 0 }`; non-empty text should be > 0

**"jsonCall returns invalid JSON from provider"**
- Use `extractJson()` from `src/llm/utils.ts` to extract JSON from markdown blocks: `const json = extractJson(raw); return { ...res, content: json }`
- Verify schema with `schema?.parse(JSON.parse(content))` AFTER extraction
- Check: API might return `\`\`\`json { ... } \`\`\`` — strip before parsing

**"streamingCall() chunks never arrive; response hangs"**
- Check provider supports streaming (SSE, websocket, or delimited response)
- Verify `onChunk()` is called per token, not per message
- Test with small model + short prompt first (avoids timeout)
- Validate: At least one `onChunk({ type: 'text', ... })` fires before `message_stop`
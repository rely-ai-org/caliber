---
name: llm-provider
description: Implement or modify an LLM provider in src/llm/ by implementing the LLMProvider interface from src/llm/types.ts. All calls route through src/llm/index.ts (llmCall, llmJsonCall). Use when user says 'add provider', 'new LLM', 'support model X', or modifies src/llm/. Do NOT use for calling LLM from commands — use existing llmCall/llmJsonCall instead.
---
# LLM Provider

## Critical

- **Interface contract**: Every provider MUST implement `LLMProvider` from `src/llm/types.ts` with `call(request: LLMRequest): Promise<LLMResponse>` and `checkSeat(): Promise<boolean>`.
- **Integration point**: Providers are instantiated and called ONLY via `src/llm/index.ts` (`llmCall`, `llmJsonCall`). Never call a provider directly from commands.
- **Error handling**: Wrap all API calls in try/catch. Check `TRANSIENT_ERRORS` in `src/llm/index.ts` for retryable errors.
- **Provider resolution order**: `src/llm/config.ts` defines resolution (Anthropic → Vertex → OpenAI compat → Claude CLI → Cursor ACP).
- **Model defaults**: Add models to `DEFAULT_MODELS` and `DEFAULT_FAST_MODELS` in `src/llm/config.ts`. Add context window to `MODEL_CONTEXT_WINDOWS`.

## Instructions

1. **Create provider file** (e.g., `src/llm/openai-compat.ts` follows this pattern) importing from `src/llm/types.ts` and `src/llm/utils.ts`:

```typescript
import { LLMProvider, LLMRequest, LLMResponse } from './types.js';
import { extractJson, estimateTokens } from './utils.js';

export const createMyProvider: () => LLMProvider = () => ({
  call: async (req: LLMRequest): Promise<LLMResponse> => {
    try {
      const res = await fetch('https://api.example.com/v1/chat', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.MY_PROVIDER_API_KEY}` },
        body: JSON.stringify({ model: req.model, messages: req.messages }),
      });
      if (!res.ok) return { error: res.statusText, code: res.status };
      const data = await res.json();
      return { content: data.output, usage: { inputTokens: 0, outputTokens: 0 } };
    } catch (e: unknown) {
      return { error: (e as Error).message, code: 500 };
    }
  },
  checkSeat: async () => !!process.env.MY_PROVIDER_API_KEY,
});
```

2. **Register in `src/llm/config.ts`**:

```typescript
DEFAULT_MODELS['my-provider'] = 'my-provider/model-name';
MODEL_CONTEXT_WINDOWS['my-provider/model-name'] = 4096;
```

3. **Add detection in `src/llm/index.ts`**:

```typescript
import { createMyProvider } from './my-provider.js';

// Inside detectProvider():
const myProvider = createMyProvider();
if (await myProvider.checkSeat()) return myProvider;
```

4. **Write tests** colocated with the llm module (e.g., alongside `src/llm/openai-compat.ts`):

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createMyProvider } from '../my-provider.js';

describe('MyProvider', () => {
  it('checkSeat returns false when API key missing', async () => {
    delete process.env.MY_PROVIDER_API_KEY;
    const provider = createMyProvider();
    expect(await provider.checkSeat()).toBe(false);
  });
});
```

5. **Validate integration**:

```bash
npx tsc --noEmit
npx vitest run src/llm/
caliber init
```

## Common Issues

**"TypeError: call() is not a function"**
- Verify provider implements both `call` and `checkSeat` methods
- Check `src/llm/index.ts` returns provider instance, not class

**"TRANSIENT_ERRORS does not include provider 429"**
- Add rate-limit code to `TRANSIENT_ERRORS` in `src/llm/index.ts`

**"checkSeat() hangs on missing API key"**
- Check env var existence BEFORE making API call: `return !!process.env.MY_API_KEY;`

**"Provider works locally but fails in CI"**
- Verify CI env vars are set in GitHub Secrets (see `.github/workflows/`)
- Check `detectProvider()` order — provider must be checked before fallback

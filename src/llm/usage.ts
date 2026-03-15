import type { TokenUsage } from './types.js';

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  calls: number;
}

const usageByModel = new Map<string, ModelUsage>();

export function trackUsage(model: string, usage: TokenUsage): void {
  const existing = usageByModel.get(model);
  if (existing) {
    existing.inputTokens += usage.inputTokens;
    existing.outputTokens += usage.outputTokens;
    existing.cacheReadTokens += usage.cacheReadTokens ?? 0;
    existing.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
    existing.calls += 1;
  } else {
    usageByModel.set(model, {
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      calls: 1,
    });
  }
}

export function getUsageSummary(): ModelUsage[] {
  return Array.from(usageByModel.values());
}

export function resetUsage(): void {
  usageByModel.clear();
}

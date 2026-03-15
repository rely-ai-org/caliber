import { describe, it, expect, beforeEach } from 'vitest';
import { trackUsage, getUsageSummary, resetUsage } from '../usage.js';

describe('usage tracking', () => {
  beforeEach(() => resetUsage());

  it('tracks single model usage', () => {
    trackUsage('claude-sonnet-4-6', { inputTokens: 100, outputTokens: 50 });
    const summary = getUsageSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0]).toEqual({
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      calls: 1,
    });
  });

  it('accumulates usage for same model', () => {
    trackUsage('gpt-4o', { inputTokens: 100, outputTokens: 50 });
    trackUsage('gpt-4o', { inputTokens: 200, outputTokens: 75 });
    const summary = getUsageSummary();
    expect(summary).toHaveLength(1);
    expect(summary[0].inputTokens).toBe(300);
    expect(summary[0].outputTokens).toBe(125);
    expect(summary[0].calls).toBe(2);
  });

  it('tracks cache tokens when provided', () => {
    trackUsage('claude-sonnet-4-6', {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 25,
      cacheWriteTokens: 10,
    });
    const summary = getUsageSummary();
    expect(summary[0].cacheReadTokens).toBe(25);
    expect(summary[0].cacheWriteTokens).toBe(10);
  });

  it('defaults cache tokens to 0 when undefined', () => {
    trackUsage('claude-sonnet-4-6', { inputTokens: 100, outputTokens: 50 });
    const summary = getUsageSummary();
    expect(summary[0].cacheReadTokens).toBe(0);
    expect(summary[0].cacheWriteTokens).toBe(0);
  });

  it('tracks multiple models separately', () => {
    trackUsage('claude-sonnet-4-6', { inputTokens: 100, outputTokens: 50 });
    trackUsage('claude-haiku-4-5-20251001', { inputTokens: 200, outputTokens: 75 });
    const summary = getUsageSummary();
    expect(summary).toHaveLength(2);
    expect(summary.find(m => m.model === 'claude-sonnet-4-6')).toBeDefined();
    expect(summary.find(m => m.model === 'claude-haiku-4-5-20251001')).toBeDefined();
  });

  it('resets all usage', () => {
    trackUsage('claude-sonnet-4-6', { inputTokens: 100, outputTokens: 50 });
    trackUsage('gpt-4o', { inputTokens: 200, outputTokens: 75 });
    resetUsage();
    expect(getUsageSummary()).toHaveLength(0);
  });

  it('returns empty summary when nothing tracked', () => {
    expect(getUsageSummary()).toEqual([]);
  });
});

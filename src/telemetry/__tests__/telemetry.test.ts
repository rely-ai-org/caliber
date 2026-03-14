import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Mock posthog-node before importing modules
const mockCapture = vi.fn();
const mockIdentify = vi.fn();
const mockShutdown = vi.fn().mockResolvedValue(undefined);

vi.mock('posthog-node', () => ({
  PostHog: class MockPostHog {
    capture = mockCapture;
    identify = mockIdentify;
    shutdown = mockShutdown;
  },
}));

// Mock fs for config file operations
const mockConfig: Record<string, unknown> = {};
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn((p: string) => {
        if (p.includes('config.json')) return Object.keys(mockConfig).length > 0;
        return actual.existsSync(p);
      }),
      readFileSync: vi.fn((p: string, encoding?: string) => {
        if (p.includes('config.json')) return JSON.stringify(mockConfig);
        return actual.readFileSync(p, encoding as BufferEncoding);
      }),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('test@example.com\n'),
}));

describe('telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
    mockCapture.mockClear();
    mockIdentify.mockClear();
    mockShutdown.mockClear();
    delete process.env.CALIBER_TELEMETRY_DISABLED;
  });

  afterEach(() => {
    delete process.env.CALIBER_TELEMETRY_DISABLED;
  });

  describe('config', () => {
    it('getMachineId returns a UUID', async () => {
      const { getMachineId } = await import('../config.js');
      const id = getMachineId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('getGitEmailHash returns SHA-256 hash', async () => {
      const { getGitEmailHash } = await import('../config.js');
      const hash = getGitEmailHash();
      const expected = crypto.createHash('sha256').update('test@example.com').digest('hex');
      expect(hash).toBe(expected);
    });

    it('isTelemetryDisabled respects env var', async () => {
      process.env.CALIBER_TELEMETRY_DISABLED = '1';
      const { isTelemetryDisabled } = await import('../config.js');
      expect(isTelemetryDisabled()).toBe(true);
    });

    it('setTelemetryDisabled sets runtime flag', async () => {
      const { isTelemetryDisabled, setTelemetryDisabled } = await import('../config.js');
      setTelemetryDisabled(true);
      expect(isTelemetryDisabled()).toBe(true);
      setTelemetryDisabled(false);
    });
  });

  describe('trackEvent', () => {
    it('captures events after init', async () => {
      const { initTelemetry, trackEvent } = await import('../index.js');
      initTelemetry();
      trackEvent('test_event', { foo: 'bar' });
      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'test_event',
          properties: { foo: 'bar' },
        })
      );
    });

    it('is a no-op when disabled', async () => {
      process.env.CALIBER_TELEMETRY_DISABLED = '1';
      const { initTelemetry, trackEvent } = await import('../index.js');
      initTelemetry();
      trackEvent('test_event', { foo: 'bar' });
      expect(mockCapture).not.toHaveBeenCalled();
    });
  });

  describe('flushTelemetry', () => {
    it('calls shutdown on client', async () => {
      const { initTelemetry, flushTelemetry } = await import('../index.js');
      initTelemetry();
      await flushTelemetry();
      expect(mockShutdown).toHaveBeenCalled();
    });

    it('does not throw if shutdown fails', async () => {
      mockShutdown.mockRejectedValueOnce(new Error('network error'));
      const { initTelemetry, flushTelemetry } = await import('../index.js');
      initTelemetry();
      await expect(flushTelemetry()).resolves.toBeUndefined();
    });
  });

  describe('event helpers', () => {
    it('trackInitProviderSelected captures correct event', async () => {
      const { initTelemetry } = await import('../index.js');
      const { trackInitProviderSelected } = await import('../events.js');
      initTelemetry();
      trackInitProviderSelected('anthropic', 'claude-sonnet-4-6');
      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'init_provider_selected',
          properties: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
        })
      );
    });

    it('trackScoreComputed captures correct event', async () => {
      const { initTelemetry } = await import('../index.js');
      const { trackScoreComputed } = await import('../events.js');
      initTelemetry();
      trackScoreComputed(85, ['claude']);
      expect(mockCapture).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'score_computed',
          properties: { score: 85, agent: ['claude'] },
        })
      );
    });
  });
});

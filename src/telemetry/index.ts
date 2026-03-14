import { PostHog } from 'posthog-node';
import chalk from 'chalk';
import {
  getMachineId,
  getGitEmailHash,
  isTelemetryDisabled,
  wasNoticeShown,
  markNoticeShown,
} from './config.js';

const POSTHOG_KEY = 'phx_o1APdJxfIEvJ2RM0XyUX635wUms4mAWXNjPiIbLjGbU0lIi';

let client: PostHog | null = null;
let distinctId: string | null = null;

export function initTelemetry(): void {
  if (isTelemetryDisabled()) return;

  const machineId = getMachineId();
  distinctId = machineId;

  client = new PostHog(POSTHOG_KEY, {
    host: 'https://us.i.posthog.com',
    flushAt: 20,
    flushInterval: 0,
  });

  // Show first-run notice
  if (!wasNoticeShown()) {
    console.log(
      chalk.dim('  Caliber collects anonymous usage data to improve the product.') +
      '\n' +
      chalk.dim('  Disable with --no-traces or CALIBER_TELEMETRY_DISABLED=1\n')
    );
    markNoticeShown();
  }

  // Identify user
  const gitEmailHash = getGitEmailHash();
  client.identify({
    distinctId: machineId,
    properties: {
      ...(gitEmailHash ? { git_email_hash: gitEmailHash } : {}),
    },
  });
}

export function trackEvent(name: string, properties?: Record<string, unknown>): void {
  if (!client || !distinctId || isTelemetryDisabled()) return;
  client.capture({
    distinctId,
    event: name,
    properties: properties ?? {},
  });
}

export async function flushTelemetry(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch {
    // never throw — fire-and-forget
  }
  client = null;
}

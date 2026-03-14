import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.caliber');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

let runtimeDisabled = false;

interface CaliberConfig {
  machineId?: string;
  telemetryNoticeShown?: boolean;
  [key: string]: unknown;
}

function readConfig(): CaliberConfig {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as CaliberConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: CaliberConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

export function getMachineId(): string {
  const config = readConfig();
  if (config.machineId) return config.machineId;

  const machineId = crypto.randomUUID();
  writeConfig({ ...config, machineId });
  return machineId;
}

export function getGitEmailHash(): string | undefined {
  try {
    const email = execSync('git config user.email', { encoding: 'utf-8' }).trim();
    if (!email) return undefined;
    return crypto.createHash('sha256').update(email).digest('hex');
  } catch {
    return undefined;
  }
}

export function isTelemetryDisabled(): boolean {
  if (runtimeDisabled) return true;
  const envVal = process.env.CALIBER_TELEMETRY_DISABLED;
  return envVal === '1' || envVal === 'true';
}

export function setTelemetryDisabled(disabled: boolean): void {
  runtimeDisabled = disabled;
}

export function wasNoticeShown(): boolean {
  return readConfig().telemetryNoticeShown === true;
}

export function markNoticeShown(): void {
  const config = readConfig();
  writeConfig({ ...config, telemetryNoticeShown: true });
}

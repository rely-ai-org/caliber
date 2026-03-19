import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

function isInsideGitRepo(): boolean {
  let dir = process.cwd();
  while (true) {
    if (existsSync(resolve(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export function getGitRemoteUrl(cwd?: string): string | undefined {
  if (!cwd && !isInsideGitRepo()) return undefined;
  try {
    return execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(cwd ? { cwd, timeout: 3000 } : {}),
    }).trim();
  } catch {
    return undefined;
  }
}

export function isGitRepo(): boolean {
  return isInsideGitRepo();
}

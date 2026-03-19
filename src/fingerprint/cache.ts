import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import type { CodeAnalysis } from './code-analysis.js';

const CACHE_VERSION = 1;
const CACHE_DIR = '.caliber/cache';
const CACHE_FILE = 'fingerprint.json';

interface FingerprintCache {
  version: number;
  gitHead: string;
  treeSignature: string;
  codeAnalysis: CodeAnalysis;
  languages: string[];
  frameworks: string[];
  tools: string[];
  workspaces?: string[];
}

function getCachePath(dir: string): string {
  return path.join(dir, CACHE_DIR, CACHE_FILE);
}

function getGitHead(dir: string): string {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();
  } catch {
    return '';
  }
}

function getDirtySignature(dir: string): string {
  try {
    const output = execSync('git diff --name-only HEAD', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    }).trim();
    return output.split('\n').slice(0, 100).join('\n');
  } catch {
    return '';
  }
}

export function computeTreeSignature(fileTree: string[], dir: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fileTree.join('\0'));
  hash.update('\n');
  hash.update(getDirtySignature(dir));
  return hash.digest('hex').slice(0, 16);
}

export function loadFingerprintCache(dir: string, fileTree: string[]): {
  codeAnalysis: CodeAnalysis;
  languages: string[];
  frameworks: string[];
  tools: string[];
  workspaces?: string[];
} | null {
  const cachePath = getCachePath(dir);
  try {
    if (!fs.existsSync(cachePath)) return null;
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const cache = JSON.parse(raw) as FingerprintCache;

    if (cache.version !== CACHE_VERSION) return null;

    const currentHead = getGitHead(dir);
    if (currentHead && cache.gitHead !== currentHead) return null;

    const currentSig = computeTreeSignature(fileTree, dir);
    if (cache.treeSignature !== currentSig) return null;

    return {
      codeAnalysis: cache.codeAnalysis,
      languages: cache.languages,
      frameworks: cache.frameworks,
      tools: cache.tools,
      workspaces: cache.workspaces,
    };
  } catch {
    return null;
  }
}

export function saveFingerprintCache(
  dir: string,
  fileTree: string[],
  codeAnalysis: CodeAnalysis,
  languages: string[],
  frameworks: string[],
  tools: string[],
  workspaces?: string[],
): void {
  const cachePath = getCachePath(dir);
  try {
    const cacheDir = path.dirname(cachePath);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cache: FingerprintCache = {
      version: CACHE_VERSION,
      gitHead: getGitHead(dir),
      treeSignature: computeTreeSignature(fileTree, dir),
      codeAnalysis,
      languages,
      frameworks,
      tools,
      workspaces,
    };

    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
  } catch {
    // Cache write failure is non-fatal
  }
}

export function getDetectedWorkspaces(dir: string): string[] {
  const cachePath = getCachePath(dir);
  try {
    if (!fs.existsSync(cachePath)) return [];
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const cache = JSON.parse(raw) as FingerprintCache;
    return cache.workspaces ?? [];
  } catch {
    return [];
  }
}

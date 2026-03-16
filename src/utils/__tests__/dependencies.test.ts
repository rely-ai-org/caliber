import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { normalize } from 'path';
import {
  extractNpmDeps,
  extractPythonDeps,
  extractGoDeps,
  extractRustDeps,
  extractAllDeps,
} from '../dependencies.js';

vi.mock('fs');

const mockFs = vi.mocked(fs);

function setupFs(files: Record<string, string>) {
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    normalized[normalize(k)] = v;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockFs.readFileSync.mockImplementation(((path: fs.PathLike) => {
    const content = normalized[String(path)];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }) as any);
}

describe('extractNpmDeps', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('extracts non-trivial dependencies', () => {
    setupFs({
      '/p/package.json': JSON.stringify({
        dependencies: { express: '4.0', zod: '3.0' },
        devDependencies: { vitest: '1.0' },
      }),
    });
    const deps = extractNpmDeps('/p');
    expect(deps).toContain('express');
    expect(deps).toContain('zod');
    expect(deps).toContain('vitest');
  });

  it('filters out @types packages', () => {
    setupFs({
      '/p/package.json': JSON.stringify({
        devDependencies: { '@types/node': '20.0', '@types/express': '4.0' },
      }),
    });
    expect(extractNpmDeps('/p')).toEqual([]);
  });

  it('filters out trivial build tools', () => {
    setupFs({
      '/p/package.json': JSON.stringify({
        devDependencies: {
          typescript: '5.0', prettier: '3.0', eslint: '9.0',
          husky: '9.0', 'lint-staged': '15.0',
        },
      }),
    });
    expect(extractNpmDeps('/p')).toEqual([]);
  });

  it('filters out trivial patterns', () => {
    setupFs({
      '/p/package.json': JSON.stringify({
        dependencies: {
          '@rely-ai/caliber': '1.0',
          '@caliber-ai/core': '1.0',
          'eslint-plugin-foo': '1.0',
          '@typescript-eslint/parser': '7.0',
        },
      }),
    });
    expect(extractNpmDeps('/p')).toEqual([]);
  });

  it('limits to 30 dependencies', () => {
    const deps: Record<string, string> = {};
    for (let i = 0; i < 40; i++) deps[`pkg-${i}`] = '1.0';
    setupFs({ '/p/package.json': JSON.stringify({ dependencies: deps }) });
    expect(extractNpmDeps('/p')).toHaveLength(30);
  });

  it('returns empty array for missing package.json', () => {
    setupFs({});
    expect(extractNpmDeps('/p')).toEqual([]);
  });
});

describe('extractPythonDeps', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('parses requirements.txt', () => {
    setupFs({
      '/p/requirements.txt': 'flask==2.0\nrequests>=2.28\n# comment\nsqlalchemy',
    });
    const deps = extractPythonDeps('/p');
    expect(deps).toContain('flask');
    expect(deps).toContain('requests');
    expect(deps).toContain('sqlalchemy');
    expect(deps).not.toContain('# comment');
  });

  it('parses pyproject.toml dependencies', () => {
    setupFs({
      '/p/pyproject.toml': `[project]
dependencies = [
  "fastapi>=0.100",
  "uvicorn",
]`,
    });
    const deps = extractPythonDeps('/p');
    expect(deps).toContain('fastapi');
    expect(deps).toContain('uvicorn');
  });

  it('returns empty for missing files', () => {
    setupFs({});
    expect(extractPythonDeps('/p')).toEqual([]);
  });
});

describe('extractGoDeps', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('extracts from go.mod require block', () => {
    setupFs({
      '/p/go.mod': `module myapp
require (
  github.com/gin-gonic/gin v1.9.0
  github.com/lib/pq v1.10.0
)`,
    });
    const deps = extractGoDeps('/p');
    expect(deps).toContain('gin');
    expect(deps).toContain('pq');
  });

  it('returns empty for missing go.mod', () => {
    setupFs({});
    expect(extractGoDeps('/p')).toEqual([]);
  });
});

describe('extractRustDeps', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('extracts from Cargo.toml', () => {
    setupFs({
      '/p/Cargo.toml': `[package]
name = "myapp"

[dependencies]
serde = "1.0"
tokio = { version = "1.0", features = ["full"] }
`,
    });
    const deps = extractRustDeps('/p');
    expect(deps).toContain('serde');
    expect(deps).toContain('tokio');
  });

  it('returns empty for missing Cargo.toml', () => {
    setupFs({});
    expect(extractRustDeps('/p')).toEqual([]);
  });
});

describe('extractAllDeps', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('aggregates deps from all ecosystems', () => {
    setupFs({
      '/p/package.json': JSON.stringify({ dependencies: { express: '4.0' } }),
      '/p/requirements.txt': 'flask==2.0',
    });
    const deps = extractAllDeps('/p');
    expect(deps).toContain('express');
    expect(deps).toContain('flask');
  });

  it('returns empty when no dep files exist', () => {
    setupFs({});
    expect(extractAllDeps('/p')).toEqual([]);
  });
});

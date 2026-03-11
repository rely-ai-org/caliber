import fs from 'fs';
import path from 'path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache',
  '.turbo', 'coverage', '.caliber', '__pycache__', '.venv',
  'vendor', 'target',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py']);

const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'Makefile', 'tsconfig.json', 'pyproject.toml', 'turbo.json',
  'requirements.txt', 'go.mod', 'Cargo.toml', 'Gemfile',
  'next.config.js', 'next.config.mjs', 'next.config.ts',
  'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
  'drizzle.config.ts', 'drizzle.config.js',
  'jest.config.ts', 'jest.config.js', 'jest.config.mjs',
  'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts',
  'alembic.ini', 'setup.cfg', 'tox.ini',
]);

const CONFIG_GLOBS_DIRS: Array<{ dir: string; pattern: RegExp }> = [
  { dir: '.github/workflows', pattern: /\.ya?ml$/ },
];

const TOTAL_BUDGET = 50_000;
const CONFIG_BUDGET = Math.floor(TOTAL_BUDGET * 0.3);
const SOURCE_BUDGET = Math.floor(TOTAL_BUDGET * 0.7);

export interface FileSummary {
  path: string;
  language: 'ts' | 'js' | 'py';
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
  types: string[];
  routes: string[];
}

export interface ConfigFileContent {
  path: string;
  content: string;
}

export interface CodeAnalysis {
  fileSummaries: FileSummary[];
  configFiles: ConfigFileContent[];
  truncated: boolean;
}

export function analyzeCode(dir: string): CodeAnalysis {
  const sourceFiles: string[] = [];
  const configFiles: ConfigFileContent[] = [];

  walkDir(dir, '', 0, 10, sourceFiles, configFiles, dir);

  sortByPriority(sourceFiles);

  let configChars = 0;
  const trimmedConfigs: ConfigFileContent[] = [];
  for (const cfg of configFiles) {
    const size = cfg.path.length + cfg.content.length;
    if (configChars + size > CONFIG_BUDGET) break;
    trimmedConfigs.push(cfg);
    configChars += size;
  }

  let sourceChars = 0;
  let truncated = false;
  const fileSummaries: FileSummary[] = [];

  for (const relPath of sourceFiles) {
    const fullPath = path.join(dir, relPath);
    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const lineCount = content.split('\n').length;
    if (lineCount > 500) continue;

    const ext = path.extname(relPath);
    const language = resolveLanguage(ext);
    if (!language) continue;

    const summary = language === 'py'
      ? extractPython(relPath, content)
      : extractTypeScriptJavaScript(relPath, content, language);

    const summarySize = estimateSummarySize(summary);
    if (sourceChars + summarySize > SOURCE_BUDGET) {
      truncated = true;
      break;
    }

    fileSummaries.push(summary);
    sourceChars += summarySize;
  }

  return { fileSummaries, configFiles: trimmedConfigs, truncated };
}

function walkDir(
  base: string,
  rel: string,
  depth: number,
  maxDepth: number,
  sourceFiles: string[],
  configFiles: ConfigFileContent[],
  rootDir: string
) {
  if (depth > maxDepth) return;
  const fullPath = path.join(base, rel);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fullPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && depth === 0 && entry.isDirectory()) continue;

    const relPath = rel ? `${rel}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const matchedGlobDir = CONFIG_GLOBS_DIRS.find(
        (g) => relPath === g.dir || relPath.endsWith(`/${g.dir}`)
      );
      if (matchedGlobDir) {
        collectConfigsFromDir(base, relPath, matchedGlobDir.pattern, configFiles);
      }
      walkDir(base, relPath, depth + 1, maxDepth, sourceFiles, configFiles, rootDir);
    } else {
      if (CONFIG_FILE_NAMES.has(entry.name)) {
        try {
          const content = fs.readFileSync(path.join(base, relPath), 'utf-8');
          configFiles.push({ path: relPath, content });
        } catch {}
      }

      const ext = path.extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext) && !entry.name.endsWith('.d.ts')) {
        sourceFiles.push(relPath);
      }
    }
  }
}

function collectConfigsFromDir(
  base: string,
  relDir: string,
  pattern: RegExp,
  configFiles: ConfigFileContent[]
) {
  const fullDir = path.join(base, relDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fullDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && pattern.test(entry.name)) {
      const relPath = `${relDir}/${entry.name}`;
      try {
        const content = fs.readFileSync(path.join(base, relPath), 'utf-8');
        configFiles.push({ path: relPath, content });
      } catch {}
    }
  }
}

function sortByPriority(files: string[]) {
  const entryPointNames = new Set(['index.ts', 'index.js', 'main.py', 'app.ts', 'app.js', 'server.ts', 'server.js']);
  const routePattern = /(route|api|controller)/i;
  const schemaPattern = /(types|schema|models)/i;
  const servicePattern = /(service|lib|utils)/i;
  const testPattern = /(test|spec|__tests__)/i;

  function priority(filePath: string): number {
    const base = path.basename(filePath);
    if (entryPointNames.has(base)) return 0;
    if (routePattern.test(filePath)) return 1;
    if (schemaPattern.test(filePath)) return 2;
    if (servicePattern.test(filePath)) return 3;
    if (testPattern.test(filePath)) return 5;
    return 4;
  }

  files.sort((a, b) => priority(a) - priority(b));
}

function resolveLanguage(ext: string): 'ts' | 'js' | 'py' | null {
  if (ext === '.ts' || ext === '.tsx') return 'ts';
  if (ext === '.js' || ext === '.jsx') return 'js';
  if (ext === '.py') return 'py';
  return null;
}

function extractTypeScriptJavaScript(
  filePath: string,
  content: string,
  language: 'ts' | 'js'
): FileSummary {
  const lines = content.split('\n');
  const imports: string[] = [];
  const exports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const types: string[] = [];
  const routes: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^import\s+/.test(trimmed)) {
      imports.push(trimmed);
      continue;
    }

    const exportMatch = trimmed.match(
      /^export\s+(?:default\s+)?(?:async\s+)?(function|const|class|interface|type|enum)\s+(\w+)/
    );
    if (exportMatch) {
      exports.push(`${exportMatch[1]} ${exportMatch[2]}`);
      if (exportMatch[1] === 'class') classes.push(exportMatch[2]);
      if (exportMatch[1] === 'interface' || exportMatch[1] === 'type') types.push(exportMatch[2]);
      if (exportMatch[1] === 'function') functions.push(exportMatch[2]);
      continue;
    }

    const fnMatch = trimmed.match(/^(?:async\s+)?function\s+(\w+)/);
    if (fnMatch && !trimmed.startsWith('export')) {
      functions.push(fnMatch[1]);
      continue;
    }

    const arrowMatch = trimmed.match(/^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (arrowMatch && !exports.some((e) => e.endsWith(arrowMatch[1]))) {
      functions.push(arrowMatch[1]);
    }

    const classMatch = trimmed.match(/^class\s+(\w+)/);
    if (classMatch && !trimmed.startsWith('export')) {
      classes.push(classMatch[1]);
      continue;
    }

    const ifaceMatch = trimmed.match(/^(?:interface|type)\s+(\w+)/);
    if (ifaceMatch && !trimmed.startsWith('export')) {
      types.push(ifaceMatch[1]);
      continue;
    }

    const routeMatch = trimmed.match(
      /(?:router|app|server)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"`]([^'"`]+)['"`]/
    );
    if (routeMatch) {
      routes.push(`${routeMatch[1].toUpperCase()} ${routeMatch[2]}`);
    }
  }

  return { path: filePath, language, imports, exports, functions, classes, types, routes };
}

function extractPython(filePath: string, content: string): FileSummary {
  const lines = content.split('\n');
  const imports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];
  const routes: string[] = [];

  let prevLine = '';
  for (const line of lines) {
    const trimmed = line.trim();

    if (/^import\s+/.test(trimmed) || /^from\s+/.test(trimmed)) {
      imports.push(trimmed);
      continue;
    }

    const defMatch = trimmed.match(/^def\s+(\w+)\s*\(([^)]*)\)/);
    if (defMatch) {
      functions.push(`${defMatch[1]}(${defMatch[2]})`);
    }

    const classMatch = trimmed.match(/^class\s+(\w+)/);
    if (classMatch) {
      classes.push(classMatch[1]);
    }

    const decoratorRoute = prevLine.match(
      /@(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]+)['"]/
    );
    if (decoratorRoute && defMatch) {
      routes.push(`${decoratorRoute[1].toUpperCase()} ${decoratorRoute[2]}`);
    }

    const includeRouter = trimmed.match(
      /include_router\s*\([^,]+,\s*prefix\s*=\s*['"]([^'"]+)['"]/
    );
    if (includeRouter) {
      routes.push(`ROUTER ${includeRouter[1]}`);
    }

    prevLine = trimmed;
  }

  return {
    path: filePath,
    language: 'py',
    imports,
    exports: [],
    functions,
    classes,
    types: [],
    routes,
  };
}

function estimateSummarySize(summary: FileSummary): number {
  return (
    summary.path.length +
    summary.imports.reduce((s, i) => s + i.length, 0) +
    summary.exports.reduce((s, e) => s + e.length, 0) +
    summary.functions.reduce((s, f) => s + f.length, 0) +
    summary.classes.reduce((s, c) => s + c.length, 0) +
    summary.types.reduce((s, t) => s + t.length, 0) +
    summary.routes.reduce((s, r) => s + r.length, 0)
  );
}

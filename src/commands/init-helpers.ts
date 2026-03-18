import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { getFastModel } from '../llm/config.js';
import { llmJsonCall } from '../llm/index.js';
import type { Check } from '../scoring/index.js';
import type { DismissedCheck } from '../scoring/dismissed.js';

export function isFirstRun(dir: string): boolean {
  const caliberDir = path.join(dir, '.caliber');
  try {
    const stat = fs.statSync(caliberDir);
    return !stat.isDirectory();
  } catch {
    return true;
  }
}

export function summarizeSetup(action: string, setup: Record<string, unknown>): string {
  const descriptions = setup.fileDescriptions as Record<string, string> | undefined;
  const files = descriptions
    ? Object.entries(descriptions).map(([p, desc]) => `  ${p}: ${desc}`).join('\n')
    : Object.keys(setup).filter(k => k !== 'targetAgent' && k !== 'fileDescriptions').join(', ');
  return `${action}. Files:\n${files}`;
}

export function derivePermissions(fingerprint: { languages: string[]; tools: string[]; fileTree: string[] }): string[] {
  const perms: string[] = ['Bash(git *)'];
  const langs = new Set(fingerprint.languages.map(l => l.toLowerCase()));
  const tools = new Set(fingerprint.tools.map(t => t.toLowerCase()));
  const hasFile = (name: string) => fingerprint.fileTree.some(f => f === name || f === `./${name}`);

  if (langs.has('typescript') || langs.has('javascript') || hasFile('package.json')) {
    perms.push('Bash(npm run *)', 'Bash(npx *)');
  }
  if (langs.has('python') || hasFile('pyproject.toml') || hasFile('requirements.txt')) {
    perms.push('Bash(python *)', 'Bash(pip *)', 'Bash(pytest *)');
  }
  if (langs.has('go') || hasFile('go.mod')) {
    perms.push('Bash(go *)');
  }
  if (langs.has('rust') || hasFile('Cargo.toml')) {
    perms.push('Bash(cargo *)');
  }
  if (langs.has('java') || langs.has('kotlin')) {
    if (hasFile('gradlew')) perms.push('Bash(./gradlew *)');
    if (hasFile('mvnw')) perms.push('Bash(./mvnw *)');
    if (hasFile('pom.xml')) perms.push('Bash(mvn *)');
    if (hasFile('build.gradle') || hasFile('build.gradle.kts')) perms.push('Bash(gradle *)');
  }
  if (langs.has('ruby') || hasFile('Gemfile')) {
    perms.push('Bash(bundle *)', 'Bash(rake *)');
  }
  if (tools.has('terraform') || hasFile('main.tf')) {
    perms.push('Bash(terraform *)');
  }
  if (tools.has('docker') || hasFile('Dockerfile') || hasFile('docker-compose.yml')) {
    perms.push('Bash(docker *)');
  }
  if (hasFile('Makefile')) {
    perms.push('Bash(make *)');
  }

  return [...new Set(perms)];
}

export function ensurePermissions(fingerprint: { languages: string[]; tools: string[]; fileTree: string[] }): void {
  const settingsPath = '.claude/settings.json';
  let settings: Record<string, unknown> = {};

  try {
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch { /* not valid JSON, start fresh */ }

  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  const allow = permissions.allow as unknown[] | undefined;

  if (Array.isArray(allow) && allow.length > 0) return;

  permissions.allow = derivePermissions(fingerprint);
  settings.permissions = permissions;

  if (!fs.existsSync('.claude')) fs.mkdirSync('.claude', { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

export function writeErrorLog(
  config: { provider: string; model: string },
  rawOutput: string | undefined,
  error?: string,
  stopReason?: string,
): void {
  try {
    const logPath = path.join(process.cwd(), '.caliber', 'error-log.md');
    const lines = [
      `# Generation Error — ${new Date().toISOString()}`,
      '',
      `**Provider**: ${config.provider}`,
      `**Model**: ${config.model}`,
      `**Stop reason**: ${stopReason || 'unknown'}`,
      '',
    ];
    if (error) {
      lines.push('## Error', '```', error, '```', '');
    }
    lines.push('## Raw LLM Output', '```', rawOutput || '(empty)', '```');

    fs.mkdirSync(path.join(process.cwd(), '.caliber'), { recursive: true });
    fs.writeFileSync(logPath, lines.join('\n'));
    console.log(chalk.dim(`\n  Error log written to .caliber/error-log.md`));
  } catch {
    // best effort
  }
}

export async function evaluateDismissals(
  failingChecks: readonly Check[],
  fingerprint: { languages: string[]; frameworks: string[]; fileTree: string[]; tools: string[] },
): Promise<DismissedCheck[]> {
  if (failingChecks.length === 0) return [];
  const fastModel = getFastModel();
  const checkList = failingChecks.map(c => ({
    id: c.id,
    name: c.name,
    suggestion: c.suggestion,
  }));

  const hasBuildFiles = fingerprint.fileTree.some(f =>
    /^(package\.json|Makefile|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|build\.gradle|pom\.xml)$/i.test(f.split('/').pop() || '')
  );
  const topFiles = fingerprint.fileTree.slice(0, 30).join(', ');

  try {
    const result = await llmJsonCall<{ dismissed: Array<{ id: string; reason: string }> }>({
      system: `You evaluate whether scoring checks are applicable to a project.
Given the project context and a list of failing checks, return which checks are NOT applicable.

Only dismiss checks that truly don't apply. Examples:
- "Build/test/lint commands" for a GitOps/Helm/Terraform/config repo with no build system
- "Build/test/lint commands" for a repo with only YAML, HCL, or config files and no package.json/Makefile
- "Dependency coverage" for a repo with no package manager

Do NOT dismiss checks that could reasonably apply even if the project doesn't use them yet.

Return {"dismissed": [{"id": "check_id", "reason": "brief reason"}]} or {"dismissed": []} if all apply.`,
      prompt: `Languages: ${fingerprint.languages.join(', ') || 'none'}
Frameworks: ${fingerprint.frameworks.join(', ') || 'none'}
Tools: ${fingerprint.tools.join(', ') || 'none'}
Has build files (package.json, Makefile, etc.): ${hasBuildFiles ? 'yes' : 'no'}
Top files: ${topFiles}

Failing checks:
${JSON.stringify(checkList, null, 2)}`,
      maxTokens: 300,
      ...(fastModel ? { model: fastModel } : {}),
    });

    if (!Array.isArray(result.dismissed)) return [];
    return result.dismissed
      .filter(d => d.id && d.reason && failingChecks.some(c => c.id === d.id))
      .map(d => ({ id: d.id, reason: d.reason, dismissedAt: new Date().toISOString() }));
  } catch {
    return [];
  }
}

import fs from 'fs';
import { writeClaudeConfig } from './claude/index.js';
import { writeCursorConfig } from './cursor/index.js';
import { writeCodexConfig } from './codex/index.js';
import { writeGithubCopilotConfig } from './github-copilot/index.js';
import { createBackup, restoreBackup } from './backup.js';
import {
  readManifest,
  writeManifest,
  fileChecksum,
  type Manifest,
  type ManifestEntry,
} from './manifest.js';

interface AgentSetup {
  targetAgent: ('claude' | 'cursor' | 'codex' | 'github-copilot')[];
  deletions?: Array<{ filePath: string; reason: string }>;
  claude?: Parameters<typeof writeClaudeConfig>[0];
  cursor?: Parameters<typeof writeCursorConfig>[0];
  codex?: Parameters<typeof writeCodexConfig>[0];
  copilot?: Parameters<typeof writeGithubCopilotConfig>[0];
}

export function writeSetup(setup: AgentSetup): { written: string[]; deleted: string[]; backupDir?: string } {
  const filesToWrite = getFilesToWrite(setup);
  const filesToDelete = (setup.deletions || [])
    .map(d => d.filePath)
    .filter(f => fs.existsSync(f));

  const existingFiles = [
    ...filesToWrite.filter(f => fs.existsSync(f)),
    ...filesToDelete,
  ];
  const backupDir = existingFiles.length > 0 ? createBackup(existingFiles) : undefined;

  const written: string[] = [];

  if (setup.targetAgent.includes('claude') && setup.claude) {
    written.push(...writeClaudeConfig(setup.claude));
  }

  if (setup.targetAgent.includes('cursor') && setup.cursor) {
    written.push(...writeCursorConfig(setup.cursor));
  }

  if (setup.targetAgent.includes('codex') && setup.codex) {
    written.push(...writeCodexConfig(setup.codex));
  }

  if (setup.targetAgent.includes('github-copilot') && setup.copilot) {
    written.push(...writeGithubCopilotConfig(setup.copilot));
  }

  const deleted: string[] = [];
  for (const filePath of filesToDelete) {
    fs.unlinkSync(filePath);
    deleted.push(filePath);
  }

  ensureGitignore();

  const entries: ManifestEntry[] = [
    ...written.map(file => ({
      path: file,
      action: existingFiles.includes(file) ? 'modified' as const : 'created' as const,
      checksum: fileChecksum(file),
      timestamp: new Date().toISOString(),
    })),
    ...deleted.map(file => ({
      path: file,
      action: 'deleted' as const,
      checksum: '',
      timestamp: new Date().toISOString(),
    })),
  ];

  writeManifest({ version: 1, backupDir, entries });

  return { written, deleted, backupDir };
}

export function undoSetup(): { restored: string[]; removed: string[] } {
  const manifest = readManifest();
  if (!manifest) {
    throw new Error('No manifest found. Nothing to undo.');
  }

  const restored: string[] = [];
  const removed: string[] = [];

  for (const entry of manifest.entries) {
    if (entry.action === 'created') {
      if (fs.existsSync(entry.path)) {
        fs.unlinkSync(entry.path);
        removed.push(entry.path);
      }
    } else if ((entry.action === 'modified' || entry.action === 'deleted') && manifest.backupDir) {
      if (restoreBackup(manifest.backupDir, entry.path)) {
        restored.push(entry.path);
      }
    }
  }

  const { MANIFEST_FILE } = require('../constants.js');
  if (fs.existsSync(MANIFEST_FILE)) {
    fs.unlinkSync(MANIFEST_FILE);
  }

  return { restored, removed };
}

function getFilesToWrite(setup: AgentSetup): string[] {
  const files: string[] = [];

  if (setup.targetAgent.includes('claude') && setup.claude) {
    files.push('CLAUDE.md');
    if (setup.claude.mcpServers) files.push('.mcp.json');
    if (setup.claude.skills) {
      for (const s of setup.claude.skills) {
        files.push(`.claude/skills/${s.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.md`);
      }
    }
  }

  if (setup.targetAgent.includes('cursor') && setup.cursor) {
    if (setup.cursor.cursorrules) files.push('.cursorrules');
    if (setup.cursor.rules) {
      for (const r of setup.cursor.rules) files.push(`.cursor/rules/${r.filename}`);
    }
    if (setup.cursor.skills) {
      for (const s of setup.cursor.skills) files.push(`.cursor/skills/${s.name}/SKILL.md`);
    }
    if (setup.cursor.mcpServers) files.push('.cursor/mcp.json');
  }

  if (setup.targetAgent.includes('codex') && setup.codex) {
    files.push('AGENTS.md');
    if (setup.codex.skills) {
      for (const s of setup.codex.skills) files.push(`.agents/skills/${s.name}/SKILL.md`);
    }
  }

  if (setup.targetAgent.includes('github-copilot') && setup.copilot) {
    if (setup.copilot.instructions) files.push('.github/copilot-instructions.md');
    if (setup.copilot.instructionFiles) {
      for (const f of setup.copilot.instructionFiles) files.push(`.github/instructions/${f.filename}`);
    }
  }

  return files;
}

function ensureGitignore() {
  const gitignorePath = '.gitignore';
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes('.caliber/')) {
      fs.appendFileSync(gitignorePath, '\n# Caliber local state\n.caliber/\n');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# Caliber local state\n.caliber/\n');
  }
}

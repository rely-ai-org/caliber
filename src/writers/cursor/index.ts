import fs from 'fs';
import path from 'path';
import { getCursorPreCommitRule } from '../pre-commit-block.js';

interface CursorConfig {
  cursorrules?: string;
  rules?: Array<{ filename: string; content: string }>;
  skills?: Array<{ name: string; description: string; content: string }>;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export function writeCursorConfig(config: CursorConfig): string[] {
  const written: string[] = [];

  if (config.cursorrules) {
    fs.writeFileSync('.cursorrules', config.cursorrules);
    written.push('.cursorrules');
  }

  const preCommitRule = getCursorPreCommitRule();
  const allRules = [...(config.rules || []), preCommitRule];
  const rulesDir = path.join('.cursor', 'rules');
  if (!fs.existsSync(rulesDir)) fs.mkdirSync(rulesDir, { recursive: true });

  for (const rule of allRules) {
    const rulePath = path.join(rulesDir, rule.filename);
    fs.writeFileSync(rulePath, rule.content);
    written.push(rulePath);
  }

  if (config.skills?.length) {
    for (const skill of config.skills) {
      const skillDir = path.join('.cursor', 'skills', skill.name);
      if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
      const skillPath = path.join(skillDir, 'SKILL.md');
      const frontmatter = [
        '---',
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        '---',
        '',
      ].join('\n');
      fs.writeFileSync(skillPath, frontmatter + skill.content);
      written.push(skillPath);
    }
  }

  if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
    const cursorDir = '.cursor';
    if (!fs.existsSync(cursorDir)) fs.mkdirSync(cursorDir, { recursive: true });

    const mcpPath = path.join(cursorDir, 'mcp.json');
    let existingServers: Record<string, unknown> = {};
    try {
      if (fs.existsSync(mcpPath)) {
        const existing = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
        if (existing.mcpServers) existingServers = existing.mcpServers;
      }
    } catch {}
    const mergedServers = { ...existingServers, ...config.mcpServers };
    fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: mergedServers }, null, 2));
    written.push(mcpPath);
  }

  return written;
}

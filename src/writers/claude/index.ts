import fs from 'fs';
import path from 'path';
import { appendPreCommitBlock } from '../pre-commit-block.js';

interface ClaudeConfig {
  claudeMd: string;
  skills?: Array<{ name: string; description: string; content: string }>;
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

export function writeClaudeConfig(config: ClaudeConfig): string[] {
  const written: string[] = [];

  fs.writeFileSync('CLAUDE.md', appendPreCommitBlock(config.claudeMd));
  written.push('CLAUDE.md');

  if (config.skills?.length) {
    for (const skill of config.skills) {
      const skillDir = path.join('.claude', 'skills', skill.name);
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
    let existingServers: Record<string, unknown> = {};
    try {
      if (fs.existsSync('.mcp.json')) {
        const existing = JSON.parse(fs.readFileSync('.mcp.json', 'utf-8'));
        if (existing.mcpServers) existingServers = existing.mcpServers;
      }
    } catch {}
    const mergedServers = { ...existingServers, ...config.mcpServers };
    fs.writeFileSync('.mcp.json', JSON.stringify({ mcpServers: mergedServers }, null, 2));
    written.push('.mcp.json');
  }

  return written;
}

import fs from 'fs';
import path from 'path';
import { appendPreCommitBlock } from '../pre-commit-block.js';

interface CodexConfig {
  agentsMd: string;
  skills?: Array<{ name: string; description: string; content: string }>;
}

export function writeCodexConfig(config: CodexConfig): string[] {
  const written: string[] = [];

  fs.writeFileSync('AGENTS.md', appendPreCommitBlock(config.agentsMd));
  written.push('AGENTS.md');

  if (config.skills?.length) {
    for (const skill of config.skills) {
      const skillDir = path.join('.agents', 'skills', skill.name);
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

  return written;
}

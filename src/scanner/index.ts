import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export interface LocalItem {
  type: 'mcp' | 'rule' | 'skill' | 'config';
  platform: 'claude' | 'cursor' | 'codex';
  name: string;
  contentHash: string;
  path: string;
}

export interface PlatformDetection {
  claude: boolean;
  cursor: boolean;
  codex: boolean;
}

export function detectPlatforms(): PlatformDetection {
  const home = os.homedir();
  return {
    claude: fs.existsSync(path.join(home, '.claude')),
    cursor: fs.existsSync(getCursorConfigDir()),
    codex: fs.existsSync(path.join(home, '.codex')),
  };
}

export function scanLocalState(dir: string): LocalItem[] {
  const items: LocalItem[] = [];

  // Claude: CLAUDE.md
  const claudeMdPath = path.join(dir, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    items.push({
      type: 'rule',
      platform: 'claude',
      name: 'CLAUDE.md',
      contentHash: hashFile(claudeMdPath),
      path: claudeMdPath,
    });
  }

  // Claude: .claude/skills/*.md
  const skillsDir = path.join(dir, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const file of fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'))) {
      const filePath = path.join(skillsDir, file);
      items.push({
        type: 'skill',
        platform: 'claude',
        name: file,
        contentHash: hashFile(filePath),
        path: filePath,
      });
    }
  }

  // Claude: .mcp.json mcpServers
  const mcpJsonPath = path.join(dir, '.mcp.json');
  if (fs.existsSync(mcpJsonPath)) {
    try {
      const mcpJson = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      if (mcpJson.mcpServers) {
        for (const name of Object.keys(mcpJson.mcpServers)) {
          items.push({
            type: 'mcp',
            platform: 'claude',
            name,
            contentHash: hashJson(mcpJson.mcpServers[name]),
            path: mcpJsonPath,
          });
        }
      }
    } catch (err) {
      process.stderr.write(`Warning: ${mcpJsonPath} could not be parsed (${err instanceof Error ? err.message : String(err)}) — skipping MCP scan\n`);
    }
  }

  // Codex: AGENTS.md (when used as primary instructions)
  const agentsMdPath = path.join(dir, 'AGENTS.md');
  if (fs.existsSync(agentsMdPath)) {
    items.push({
      type: 'rule',
      platform: 'codex',
      name: 'AGENTS.md',
      contentHash: hashFile(agentsMdPath),
      path: agentsMdPath,
    });
  }

  // Codex: .agents/skills/*/SKILL.md
  const codexSkillsDir = path.join(dir, '.agents', 'skills');
  if (fs.existsSync(codexSkillsDir)) {
    try {
      for (const name of fs.readdirSync(codexSkillsDir)) {
        const skillFile = path.join(codexSkillsDir, name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          items.push({
            type: 'skill',
            platform: 'codex',
            name: `${name}/SKILL.md`,
            contentHash: hashFile(skillFile),
            path: skillFile,
          });
        }
      }
    } catch (err) {
      process.stderr.write(`Warning: ${codexSkillsDir} could not be read (${err instanceof Error ? err.message : String(err)}) — skipping Codex skills scan\n`);
    }
  }

  // Cursor: .cursorrules
  const cursorrulesPath = path.join(dir, '.cursorrules');
  if (fs.existsSync(cursorrulesPath)) {
    items.push({
      type: 'rule',
      platform: 'cursor',
      name: '.cursorrules',
      contentHash: hashFile(cursorrulesPath),
      path: cursorrulesPath,
    });
  }

  // Cursor: .cursor/rules/*.mdc
  const cursorRulesDir = path.join(dir, '.cursor', 'rules');
  if (fs.existsSync(cursorRulesDir)) {
    for (const file of fs.readdirSync(cursorRulesDir).filter(f => f.endsWith('.mdc'))) {
      const filePath = path.join(cursorRulesDir, file);
      items.push({
        type: 'rule',
        platform: 'cursor',
        name: file,
        contentHash: hashFile(filePath),
        path: filePath,
      });
    }
  }

  // Cursor: .cursor/skills/*/SKILL.md
  const cursorSkillsDir = path.join(dir, '.cursor', 'skills');
  if (fs.existsSync(cursorSkillsDir)) {
    try {
      for (const name of fs.readdirSync(cursorSkillsDir)) {
        const skillFile = path.join(cursorSkillsDir, name, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          items.push({
            type: 'skill',
            platform: 'cursor',
            name: `${name}/SKILL.md`,
            contentHash: hashFile(skillFile),
            path: skillFile,
          });
        }
      }
    } catch (err) {
      process.stderr.write(`Warning: ${cursorSkillsDir} could not be read (${err instanceof Error ? err.message : String(err)}) — skipping Cursor skills scan\n`);
    }
  }

  // Cursor: .cursor/mcp.json mcpServers
  const cursorMcpPath = path.join(dir, '.cursor', 'mcp.json');
  if (fs.existsSync(cursorMcpPath)) {
    try {
      const mcpJson = JSON.parse(fs.readFileSync(cursorMcpPath, 'utf-8'));
      if (mcpJson.mcpServers) {
        for (const name of Object.keys(mcpJson.mcpServers)) {
          items.push({
            type: 'mcp',
            platform: 'cursor',
            name,
            contentHash: hashJson(mcpJson.mcpServers[name]),
            path: cursorMcpPath,
          });
        }
      }
    } catch (err) {
      process.stderr.write(`Warning: ${cursorMcpPath} could not be parsed (${err instanceof Error ? err.message : String(err)}) — skipping Cursor MCP scan\n`);
    }
  }

  return items;
}

export interface ServerItem {
  id: string;
  type: string;
  platform: string;
  name: string;
  content_hash: string;
  content: Record<string, unknown>;
}

export function compareState(
  serverItems: ServerItem[],
  localItems: LocalItem[]
) {
  const installed: Array<{ server: ServerItem; local: LocalItem }> = [];
  const missing: ServerItem[] = [];
  const outdated: Array<{ server: ServerItem; local: LocalItem }> = [];
  const extra: LocalItem[] = [];

  const localMap = new Map<string, LocalItem>();
  for (const item of localItems) {
    localMap.set(`${item.type}:${item.platform}:${item.name}`, item);
  }

  for (const server of serverItems) {
    const key = `${server.type}:${server.platform}:${server.name}`;
    const local = localMap.get(key);
    localMap.delete(key);

    if (!local) {
      missing.push(server);
    } else if (local.contentHash !== server.content_hash) {
      outdated.push({ server, local });
    } else {
      installed.push({ server, local });
    }
  }

  for (const local of localMap.values()) {
    extra.push(local);
  }

  return { installed, missing, outdated, extra };
}

function hashFile(filePath: string): string {
  const text = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(JSON.stringify({ text })).digest('hex');
}

function hashJson(obj: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

function getCursorConfigDir(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Cursor');
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming', 'Cursor');
  }
  return path.join(home, '.config', 'Cursor');
}

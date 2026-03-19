import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Check } from '../index.js';
import {
  POINTS_CLAUDE_MD_EXISTS,
  POINTS_CURSOR_RULES_EXIST,
  POINTS_SKILLS_EXIST,
  POINTS_SKILLS_BONUS_PER_EXTRA,
  POINTS_SKILLS_BONUS_CAP,
  POINTS_CURSOR_MDC_RULES,
  POINTS_MCP_SERVERS,
  POINTS_CROSS_PLATFORM_PARITY,
} from '../constants.js';

function countFiles(dir: string, pattern: RegExp): string[] {
  try {
    return readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => pattern.test(f));
  } catch {
    return [];
  }
}

function hasMcpServers(dir: string): { count: number; sources: string[] } {
  const sources: string[] = [];
  let count = 0;

  const mcpFiles = [
    '.mcp.json',
    '.cursor/mcp.json',
    '.claude/settings.local.json',
    '.claude/settings.json',
  ];

  for (const rel of mcpFiles) {
    try {
      const content = readFileSync(join(dir, rel), 'utf-8');
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const servers = parsed.mcpServers as Record<string, unknown> | undefined;
      if (servers && Object.keys(servers).length > 0) {
        count += Object.keys(servers).length;
        sources.push(rel);
      }
    } catch {
      // file doesn't exist or isn't valid JSON
    }
  }

  return { count, sources };
}

export function checkExistence(dir: string): Check[] {
  const checks: Check[] = [];

  // 1. CLAUDE.md exists
  const claudeMdExists = existsSync(join(dir, 'CLAUDE.md'));
  checks.push({
    id: 'claude_md_exists',
    name: 'CLAUDE.md exists',
    category: 'existence',
    maxPoints: POINTS_CLAUDE_MD_EXISTS,
    earnedPoints: claudeMdExists ? POINTS_CLAUDE_MD_EXISTS : 0,
    passed: claudeMdExists,
    detail: claudeMdExists ? 'Found at project root' : 'Not found',
    suggestion: claudeMdExists ? undefined : 'Create a CLAUDE.md with project context and commands',
    fix: claudeMdExists ? undefined : {
      action: 'create_file',
      data: { file: 'CLAUDE.md' },
      instruction: 'Create CLAUDE.md with project context, commands, architecture, and conventions.',
    },
  });

  // 2. .cursorrules or .cursor/rules/ exists
  const hasCursorrules = existsSync(join(dir, '.cursorrules'));
  const cursorRulesDir = existsSync(join(dir, '.cursor', 'rules'));
  const cursorRulesExist = hasCursorrules || cursorRulesDir;
  checks.push({
    id: 'cursor_rules_exist',
    name: 'Cursor rules exist',
    category: 'existence',
    maxPoints: POINTS_CURSOR_RULES_EXIST,
    earnedPoints: cursorRulesExist ? POINTS_CURSOR_RULES_EXIST : 0,
    passed: cursorRulesExist,
    detail: hasCursorrules
      ? '.cursorrules found'
      : cursorRulesDir
        ? '.cursor/rules/ found'
        : 'No Cursor rules',
    suggestion: cursorRulesExist ? undefined : 'Add .cursor/rules/ for Cursor users on your team',
    fix: cursorRulesExist ? undefined : {
      action: 'create_file',
      data: { file: '.cursor/rules/' },
      instruction: 'Create .cursor/rules/ with project-specific Cursor rules.',
    },
  });

  // 2b. AGENTS.md exists (primary config for Codex)
  const agentsMdExists = existsSync(join(dir, 'AGENTS.md'));
  checks.push({
    id: 'codex_agents_md_exists',
    name: 'AGENTS.md exists',
    category: 'existence',
    maxPoints: POINTS_CLAUDE_MD_EXISTS,
    earnedPoints: agentsMdExists ? POINTS_CLAUDE_MD_EXISTS : 0,
    passed: agentsMdExists,
    detail: agentsMdExists ? 'Found at project root' : 'Not found',
    suggestion: agentsMdExists ? undefined : 'Create AGENTS.md with project context for Codex',
    fix: agentsMdExists ? undefined : {
      action: 'create_file',
      data: { file: 'AGENTS.md' },
      instruction: 'Create AGENTS.md with project context for Codex.',
    },
  });

  // 2c. copilot-instructions.md exists
  const copilotInstructionsExists = existsSync(join(dir, '.github', 'copilot-instructions.md'));
  checks.push({
    id: 'copilot_instructions_exists',
    name: 'Copilot instructions exist',
    category: 'existence',
    maxPoints: POINTS_CLAUDE_MD_EXISTS,
    earnedPoints: copilotInstructionsExists ? POINTS_CLAUDE_MD_EXISTS : 0,
    passed: copilotInstructionsExists,
    detail: copilotInstructionsExists ? 'Found at .github/copilot-instructions.md' : 'Not found',
    suggestion: copilotInstructionsExists ? undefined : 'Create .github/copilot-instructions.md with project context for GitHub Copilot',
    fix: copilotInstructionsExists ? undefined : {
      action: 'create_file',
      data: { file: '.github/copilot-instructions.md' },
      instruction: 'Create .github/copilot-instructions.md with project context for GitHub Copilot.',
    },
  });

  // 3. Skills exist (.claude/skills/ or .agents/skills/)
  const claudeSkills = countFiles(join(dir, '.claude', 'skills'), /\.(md|SKILL\.md)$/);
  const codexSkills = countFiles(join(dir, '.agents', 'skills'), /SKILL\.md$/);
  const skillCount = claudeSkills.length + codexSkills.length;
  const skillBase = skillCount >= 1 ? POINTS_SKILLS_EXIST : 0;
  const skillBonus = Math.min((skillCount - 1) * POINTS_SKILLS_BONUS_PER_EXTRA, POINTS_SKILLS_BONUS_CAP);
  const skillPoints = skillCount >= 1 ? skillBase + Math.max(0, skillBonus) : 0;
  const maxSkillPoints = POINTS_SKILLS_EXIST + POINTS_SKILLS_BONUS_CAP;
  checks.push({
    id: 'skills_exist',
    name: 'Skills configured',
    category: 'existence',
    maxPoints: maxSkillPoints,
    earnedPoints: Math.min(skillPoints, maxSkillPoints),
    passed: skillCount >= 1,
    detail: skillCount === 0
      ? 'No skills found'
      : `${skillCount} skill${skillCount === 1 ? '' : 's'} found`,
    suggestion: skillCount === 0
      ? 'Add .claude/skills/ with project-specific workflows'
      : skillCount < 3
        ? 'Optimal is 2-3 focused skills'
        : undefined,
    fix: skillCount === 0
      ? {
          action: 'create_skills',
          data: { currentCount: 0 },
          instruction: 'Create .claude/skills/ with 2-3 project-specific workflow skills.',
        }
      : undefined,
  });

  // 4. Cursor .mdc rules
  const mdcFiles = countFiles(join(dir, '.cursor', 'rules'), /\.mdc$/);
  const mdcCount = mdcFiles.length;
  checks.push({
    id: 'cursor_mdc_rules',
    name: 'Cursor .mdc rules',
    category: 'existence',
    maxPoints: POINTS_CURSOR_MDC_RULES,
    earnedPoints: mdcCount >= 1 ? POINTS_CURSOR_MDC_RULES : 0,
    passed: mdcCount >= 1,
    detail: mdcCount === 0
      ? 'No .mdc rule files'
      : `${mdcCount} .mdc rule${mdcCount === 1 ? '' : 's'} found`,
    suggestion: mdcCount === 0
      ? 'Add .cursor/rules/*.mdc with frontmatter for Cursor'
      : undefined,
    fix: mdcCount === 0
      ? {
          action: 'create_mdc_rules',
          data: {},
          instruction: 'Create .cursor/rules/*.mdc files with YAML frontmatter for Cursor.',
        }
      : undefined,
  });

  // 5. MCP servers configured (no penalty if not configured — just bonus)
  const mcp = hasMcpServers(dir);
  checks.push({
    id: 'mcp_servers',
    name: 'MCP servers configured',
    category: 'existence',
    maxPoints: POINTS_MCP_SERVERS,
    earnedPoints: mcp.count >= 1 ? POINTS_MCP_SERVERS : 0,
    passed: mcp.count >= 1,
    detail: mcp.count > 0
      ? `${mcp.count} server${mcp.count === 1 ? '' : 's'} in ${mcp.sources.join(', ')}`
      : 'No MCP servers configured',
    suggestion: mcp.count === 0
      ? 'Configure MCP servers in .mcp.json for external service access'
      : undefined,
    fix: mcp.count === 0
      ? {
          action: 'configure_mcp',
          data: {},
          instruction: 'Add MCP server configurations in .mcp.json for any external services the project uses.',
        }
      : undefined,
  });

  // 6. Cross-platform parity
  const hasClaudeConfigs = claudeMdExists || skillCount > 0;
  const hasCursorConfigs = cursorRulesExist || mdcCount > 0;
  const hasParity = hasClaudeConfigs && hasCursorConfigs;
  checks.push({
    id: 'cross_platform_parity',
    name: 'Cross-platform parity',
    category: 'existence',
    maxPoints: POINTS_CROSS_PLATFORM_PARITY,
    earnedPoints: hasParity ? POINTS_CROSS_PLATFORM_PARITY : 0,
    passed: hasParity,
    detail: hasParity
      ? 'Both Claude Code and Cursor configured'
      : hasClaudeConfigs
        ? 'Only Claude Code — no Cursor configs'
        : hasCursorConfigs
          ? 'Only Cursor — no Claude Code configs'
          : 'Neither platform configured',
    suggestion: hasParity ? undefined : 'Add configs for both platforms so all teammates get context',
    fix: hasParity ? undefined : {
      action: 'add_platform',
      data: { hasClaude: hasClaudeConfigs, hasCursor: hasCursorConfigs },
      instruction: hasClaudeConfigs
        ? 'Add Cursor rules (.cursor/rules/) for cross-platform support.'
        : 'Add CLAUDE.md for cross-platform support.',
    },
  });

  return checks;
}

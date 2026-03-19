import { existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import type { Check } from '../index.js';
import {
  POINTS_HOOKS,
  POINTS_AGENTS_MD,
  POINTS_OPEN_SKILLS_FORMAT,
  POINTS_LEARNED_CONTENT,
} from '../constants.js';
import { readFileOrNull } from '../utils.js';
import { hasPreCommitBlock as checkPreCommitBlock } from '../../writers/pre-commit-block.js';

function hasPreCommitHook(dir: string): boolean {
  try {
    const gitDir = execSync('git rev-parse --git-dir', { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const hookPath = join(gitDir, 'hooks', 'pre-commit');
    const content = readFileOrNull(hookPath);
    return content ? content.includes('caliber') : false;
  } catch {
    return false;
  }
}

export function checkBonus(dir: string): Check[] {
  const checks: Check[] = [];

  // 1. Hooks configured
  let hasClaudeHooks = false;
  let hasPrecommit = false;
  const hookSources: string[] = [];

  const settingsContent = readFileOrNull(join(dir, '.claude', 'settings.json'));
  if (settingsContent) {
    try {
      const settings = JSON.parse(settingsContent) as Record<string, unknown>;
      const hooks = settings.hooks as Record<string, unknown> | undefined;
      if (hooks && Object.keys(hooks).length > 0) {
        hasClaudeHooks = true;
        hookSources.push(`Claude Code: ${Object.keys(hooks).join(', ')}`);
      }
    } catch { /* invalid JSON */ }
  }

  hasPrecommit = hasPreCommitHook(dir);
  if (hasPrecommit) {
    hookSources.push('git pre-commit');
  }

  const claudeMd = readFileOrNull(join(dir, 'CLAUDE.md'));
  const hasPreCommitBlock = claudeMd ? checkPreCommitBlock(claudeMd) : false;
  if (hasPreCommitBlock) {
    hookSources.push('config pre-commit instruction');
  }

  const hasHooks = hasClaudeHooks || hasPrecommit || hasPreCommitBlock;
  checks.push({
    id: 'hooks_configured',
    name: 'Hooks configured',
    category: 'bonus',
    maxPoints: POINTS_HOOKS,
    earnedPoints: hasHooks ? POINTS_HOOKS : 0,
    passed: hasHooks,
    detail: hasHooks
      ? hookSources.join(', ')
      : 'No hooks configured',
    suggestion: hasHooks ? undefined : 'Run `caliber init` to add pre-commit instructions',
    fix: hasHooks ? undefined : {
      action: 'install_hooks',
      data: {},
      instruction: 'Run caliber init to add pre-commit refresh instructions to config files.',
    },
  });

  // 2. AGENTS.md exists (bonus for non-codex targets — codex has its own existence check)
  const agentsMdExists = existsSync(join(dir, 'AGENTS.md'));
  checks.push({
    id: 'agents_md_exists',
    name: 'AGENTS.md exists',
    category: 'bonus',
    maxPoints: POINTS_AGENTS_MD,
    earnedPoints: agentsMdExists ? POINTS_AGENTS_MD : 0,
    passed: agentsMdExists,
    detail: agentsMdExists ? 'Found at project root' : 'Not found',
    suggestion: agentsMdExists ? undefined : 'Add AGENTS.md — the emerging cross-agent standard',
    fix: agentsMdExists ? undefined : {
      action: 'create_file',
      data: { file: 'AGENTS.md' },
      instruction: 'Create AGENTS.md with project context for cross-agent compatibility.',
    },
  });

  // 3. Skills use OpenSkills format
  const skillsDir = join(dir, '.claude', 'skills');
  let openSkillsCount = 0;
  let totalSkillFiles = 0;

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = readFileOrNull(join(skillsDir, entry.name, 'SKILL.md'));
        if (skillMd) {
          totalSkillFiles++;
          if (skillMd.trimStart().startsWith('---')) {
            openSkillsCount++;
          }
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        totalSkillFiles++;
      }
    }
  } catch { /* skills dir doesn't exist */ }

  const allOpenSkills = totalSkillFiles > 0 && openSkillsCount === totalSkillFiles;
  checks.push({
    id: 'open_skills_format',
    name: 'Skills use OpenSkills format',
    category: 'bonus',
    maxPoints: POINTS_OPEN_SKILLS_FORMAT,
    earnedPoints: allOpenSkills ? POINTS_OPEN_SKILLS_FORMAT : 0,
    passed: allOpenSkills,
    detail: totalSkillFiles === 0
      ? 'No skills to check'
      : allOpenSkills
        ? `All ${totalSkillFiles} skill${totalSkillFiles === 1 ? '' : 's'} use SKILL.md with frontmatter`
        : `${openSkillsCount}/${totalSkillFiles} use OpenSkills format`,
    suggestion: totalSkillFiles > 0 && !allOpenSkills
      ? 'Migrate skills to .claude/skills/{name}/SKILL.md with YAML frontmatter'
      : undefined,
    fix: totalSkillFiles > 0 && !allOpenSkills
      ? {
          action: 'migrate_skills',
          data: { openSkills: openSkillsCount, total: totalSkillFiles },
          instruction: 'Migrate flat skill files to .claude/skills/{name}/SKILL.md with YAML frontmatter.',
        }
      : undefined,
  });

  // 4. Learned content present
  const learningsContent = readFileOrNull(join(dir, 'CALIBER_LEARNINGS.md'));
  const hasLearned = learningsContent
    ? learningsContent.split('\n').filter(l => l.startsWith('- ')).length > 0
    : false;

  checks.push({
    id: 'learned_content',
    name: 'Learned content present',
    category: 'bonus',
    maxPoints: POINTS_LEARNED_CONTENT,
    earnedPoints: hasLearned ? POINTS_LEARNED_CONTENT : 0,
    passed: hasLearned,
    detail: hasLearned ? 'Session learnings found in CALIBER_LEARNINGS.md' : 'No learned content',
    suggestion: hasLearned ? undefined : 'Install learning hooks: `caliber learn install`',
  });

  return checks;
}

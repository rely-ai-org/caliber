import chalk from 'chalk';
import fs from 'fs';
import { getUsageSummary } from '../llm/index.js';
import type { Fingerprint } from '../fingerprint/index.js';

export function formatProjectPreview(fingerprint: Fingerprint): string {
  const parts: string[] = [];

  if (fingerprint.languages.length > 0 || fingerprint.frameworks.length > 0) {
    const stack = [...fingerprint.languages, ...fingerprint.frameworks];
    parts.push(stack.join(' · '));
  }

  const fileCount = fingerprint.fileTree.length;
  if (fileCount > 0) {
    parts.push(`${fileCount.toLocaleString()} files`);
  } else {
    parts.push('empty project');
  }

  return parts.join(' · ');
}

export function formatWhatChanged(setup: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const claude = setup.claude as Record<string, unknown> | undefined;
  const codex = setup.codex as Record<string, unknown> | undefined;
  const cursor = setup.cursor as Record<string, unknown> | undefined;

  if (claude?.claudeMd) {
    const action = fs.existsSync('CLAUDE.md') ? 'Updated' : 'Created';
    lines.push(`${action} CLAUDE.md`);
  }

  if (codex?.agentsMd) {
    const action = fs.existsSync('AGENTS.md') ? 'Updated' : 'Created';
    lines.push(`${action} AGENTS.md`);
  }

  const allSkills: string[] = [];
  for (const [platform, obj] of [['claude', claude], ['codex', codex], ['cursor', cursor]] as const) {
    const skills = (obj as Record<string, unknown> | undefined)?.skills as Array<{ name: string }> | undefined;
    if (Array.isArray(skills)) {
      for (const s of skills) allSkills.push(s.name);
    }
  }
  if (allSkills.length > 0) {
    const names = allSkills.length <= 4
      ? allSkills.join(', ')
      : `${allSkills.slice(0, 3).join(', ')} +${allSkills.length - 3} more`;
    lines.push(`${allSkills.length} skill${allSkills.length === 1 ? '' : 's'}: ${names}`);
  }

  const rules = (cursor as Record<string, unknown> | undefined)?.rules as Array<{ filename: string }> | undefined;
  if (Array.isArray(rules) && rules.length > 0) {
    const names = rules.length <= 3
      ? rules.map(r => r.filename.replace('.mdc', '')).join(', ')
      : `${rules.slice(0, 2).map(r => r.filename.replace('.mdc', '')).join(', ')} +${rules.length - 2} more`;
    lines.push(`${rules.length} cursor rule${rules.length === 1 ? '' : 's'}: ${names}`);
  }

  const deletions = setup.deletions as Array<{ filePath: string }> | undefined;
  if (Array.isArray(deletions) && deletions.length > 0) {
    lines.push(`Removing ${deletions.length} file${deletions.length === 1 ? '' : 's'}: ${deletions.map(d => d.filePath).join(', ')}`);
  }

  return lines;
}

export function printSetupSummary(setup: Record<string, unknown>) {
  const claude = setup.claude as Record<string, unknown> | undefined;
  const cursor = setup.cursor as Record<string, unknown> | undefined;
  const fileDescriptions = setup.fileDescriptions as Record<string, string> | undefined;
  const deletions = setup.deletions as Array<{ filePath: string; reason: string }> | undefined;

  console.log('');
  console.log(chalk.bold('  Your tailored setup:\n'));

  const getDescription = (filePath: string): string | undefined => {
    return fileDescriptions?.[filePath];
  };

  if (claude) {
    if (claude.claudeMd) {
      const icon = fs.existsSync('CLAUDE.md') ? chalk.yellow('~') : chalk.green('+');
      const desc = getDescription('CLAUDE.md');
      console.log(`  ${icon} ${chalk.bold('CLAUDE.md')}`);
      if (desc) console.log(chalk.dim(`    ${desc}`));
      console.log('');
    }

    const skills = claude.skills as Array<{ name: string; description: string; content: string }> | undefined;
    if (Array.isArray(skills) && skills.length > 0) {
      for (const skill of skills) {
        const skillPath = `.claude/skills/${skill.name}/SKILL.md`;
        const icon = fs.existsSync(skillPath) ? chalk.yellow('~') : chalk.green('+');
        const desc = getDescription(skillPath);
        console.log(`  ${icon} ${chalk.bold(skillPath)}`);
        console.log(chalk.dim(`    ${desc || skill.description || skill.name}`));
        console.log('');
      }
    }
  }

  const codex = setup.codex as Record<string, unknown> | undefined;

  if (codex) {
    if (codex.agentsMd) {
      const icon = fs.existsSync('AGENTS.md') ? chalk.yellow('~') : chalk.green('+');
      const desc = getDescription('AGENTS.md');
      console.log(`  ${icon} ${chalk.bold('AGENTS.md')}`);
      if (desc) console.log(chalk.dim(`    ${desc}`));
      console.log('');
    }

    const codexSkills = codex.skills as Array<{ name: string; description: string; content: string }> | undefined;
    if (Array.isArray(codexSkills) && codexSkills.length > 0) {
      for (const skill of codexSkills) {
        const skillPath = `.agents/skills/${skill.name}/SKILL.md`;
        const icon = fs.existsSync(skillPath) ? chalk.yellow('~') : chalk.green('+');
        const desc = getDescription(skillPath);
        console.log(`  ${icon} ${chalk.bold(skillPath)}`);
        console.log(chalk.dim(`    ${desc || skill.description || skill.name}`));
        console.log('');
      }
    }
  }

  if (cursor) {
    if (cursor.cursorrules) {
      const icon = fs.existsSync('.cursorrules') ? chalk.yellow('~') : chalk.green('+');
      const desc = getDescription('.cursorrules');
      console.log(`  ${icon} ${chalk.bold('.cursorrules')}`);
      if (desc) console.log(chalk.dim(`    ${desc}`));
      console.log('');
    }

    const cursorSkills = cursor.skills as Array<{ name: string; description: string; content: string }> | undefined;
    if (Array.isArray(cursorSkills) && cursorSkills.length > 0) {
      for (const skill of cursorSkills) {
        const skillPath = `.cursor/skills/${skill.name}/SKILL.md`;
        const icon = fs.existsSync(skillPath) ? chalk.yellow('~') : chalk.green('+');
        const desc = getDescription(skillPath);
        console.log(`  ${icon} ${chalk.bold(skillPath)}`);
        console.log(chalk.dim(`    ${desc || skill.description || skill.name}`));
        console.log('');
      }
    }

    const rulesArr = cursor.rules as Array<{ filename: string; content: string }> | undefined;
    if (Array.isArray(rulesArr) && rulesArr.length > 0) {
      for (const rule of rulesArr) {
        const rulePath = `.cursor/rules/${rule.filename}`;
        const icon = fs.existsSync(rulePath) ? chalk.yellow('~') : chalk.green('+');
        const desc = getDescription(rulePath);
        console.log(`  ${icon} ${chalk.bold(rulePath)}`);
        if (desc) {
          console.log(chalk.dim(`    ${desc}`));
        } else {
          const firstLine = rule.content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))[0];
          if (firstLine) console.log(chalk.dim(`    ${firstLine.trim().slice(0, 80)}`));
        }
        console.log('');
      }
    }
  }

  if (Array.isArray(deletions) && deletions.length > 0) {
    for (const del of deletions) {
      console.log(`  ${chalk.red('-')} ${chalk.bold(del.filePath)}`);
      console.log(chalk.dim(`    ${del.reason}`));
      console.log('');
    }
  }

  console.log(`  ${chalk.green('+')} ${chalk.dim('new')}  ${chalk.yellow('~')} ${chalk.dim('modified')}  ${chalk.red('-')} ${chalk.dim('removed')}`);
  console.log('');
}

export function displayTokenUsage(): void {
  const summary = getUsageSummary();
  if (summary.length === 0) {
    console.log(chalk.dim('  Token tracking not available for this provider.\n'));
    return;
  }

  console.log(chalk.bold('  Token usage:\n'));
  let totalIn = 0;
  let totalOut = 0;
  for (const m of summary) {
    totalIn += m.inputTokens;
    totalOut += m.outputTokens;
    const cacheInfo = m.cacheReadTokens > 0 || m.cacheWriteTokens > 0
      ? chalk.dim(` (cache: ${m.cacheReadTokens.toLocaleString()} read, ${m.cacheWriteTokens.toLocaleString()} write)`)
      : '';
    console.log(`    ${chalk.dim(m.model)}: ${m.inputTokens.toLocaleString()} in / ${m.outputTokens.toLocaleString()} out  (${m.calls} call${m.calls === 1 ? '' : 's'})${cacheInfo}`);
  }
  if (summary.length > 1) {
    console.log(`    ${chalk.dim('Total')}: ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out`);
  }
  console.log('');
}

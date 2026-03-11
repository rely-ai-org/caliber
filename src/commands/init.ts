import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import select from '@inquirer/select';
import fs from 'fs';
import { collectFingerprint, enrichFingerprintWithLLM } from '../fingerprint/index.js';
import { generateSetup } from '../ai/generate.js';
import { refineSetup } from '../ai/refine.js';
import { writeSetup } from '../writers/index.js';
import { stageFiles, cleanupStaging } from '../writers/staging.js';
import type { StagedFile } from '../writers/staging.js';
import { detectAvailableEditors, openDiffsInEditor } from '../utils/editor.js';
import type { ReviewMethod } from '../utils/editor.js';
import { createTwoFilesPatch } from 'diff';
import { installHook, installPreCommitHook } from '../lib/hooks.js';
import { installLearningHooks } from '../lib/learning-hooks.js';
import { writeState, getCurrentHeadSha } from '../lib/state.js';
import { SpinnerMessages, GENERATION_MESSAGES, REFINE_MESSAGES } from '../utils/spinner-messages.js';
import { loadConfig } from '../llm/config.js';
import { computeLocalScore } from '../scoring/index.js';
import { displayScoreDelta } from '../scoring/display.js';

type TargetAgent = 'claude' | 'cursor' | 'both';

interface InitOptions {
  agent?: TargetAgent;
  dryRun?: boolean;
  force?: boolean;
}

export async function initCommand(options: InitOptions) {
  console.log(chalk.bold.hex('#6366f1')(`
   ██████╗ █████╗ ██╗     ██╗██████╗ ███████╗██████╗
  ██╔════╝██╔══██╗██║     ██║██╔══██╗██╔════╝██╔══██╗
  ██║     ███████║██║     ██║██████╔╝█████╗  ██████╔╝
  ██║     ██╔══██║██║     ██║██╔══██╗██╔══╝  ██╔══██╗
  ╚██████╗██║  ██║███████╗██║██████╔╝███████╗██║  ██║
   ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
  `));
  console.log(chalk.dim('  Configure your coding agent environment\n'));

  console.log(chalk.bold('  What is Caliber?\n'));
  console.log(chalk.dim('  Caliber audits your AI agent configurations and suggests targeted'));
  console.log(chalk.dim('  improvements. It analyzes CLAUDE.md, .cursorrules, and skills'));
  console.log(chalk.dim('  against your actual codebase — keeping what works, fixing'));
  console.log(chalk.dim('  what\'s stale, and adding what\'s missing.\n'));

  console.log(chalk.bold('  How it works:\n'));
  console.log(chalk.dim('  1. Scan      Analyze your code, dependencies, and existing configs'));
  console.log(chalk.dim('  2. Generate  AI creates or improves config files for your project'));
  console.log(chalk.dim('  3. Review    You accept, refine, or decline the proposed changes'));
  console.log(chalk.dim('  4. Apply     Config files are written with backups\n'));

  // Step 1: Check LLM config
  console.log(chalk.hex('#6366f1').bold('  Step 1/4 — Check LLM provider\n'));
  const config = loadConfig();
  if (!config) {
    console.log(chalk.red('  No LLM provider configured.\n'));
    console.log(chalk.dim('  Set one of these environment variables:'));
    console.log(chalk.dim('    ANTHROPIC_API_KEY    — for Anthropic Claude'));
    console.log(chalk.dim('    OPENAI_API_KEY       — for OpenAI or compatible endpoints'));
    console.log(chalk.dim('    VERTEX_PROJECT_ID    — for Google Vertex AI\n'));
    console.log(chalk.dim('  Or run `caliber config` for interactive setup.\n'));
    throw new Error('__exit__');
  }
  console.log(chalk.dim(`  Provider: ${config.provider} | Model: ${config.model}\n`));

  // Step 2: Collect fingerprint
  console.log(chalk.hex('#6366f1').bold('  Step 2/4 — Scan project\n'));
  console.log(chalk.dim('  Detecting languages, dependencies, file structure, and existing configs.\n'));
  const spinner = ora('Analyzing project...').start();
  const fingerprint = collectFingerprint(process.cwd());
  await enrichFingerprintWithLLM(fingerprint, process.cwd());
  spinner.succeed('Project analyzed');

  console.log(chalk.dim(`  Languages: ${fingerprint.languages.join(', ') || 'none detected'}`));
  console.log(chalk.dim(`  Files: ${fingerprint.fileTree.length} found\n`));

  // Step 3: Determine target agent
  const targetAgent = options.agent || await promptAgent();

  // Baseline score before generation
  const baselineScore = computeLocalScore(process.cwd(), targetAgent);

  // Get project description if empty directory
  const isEmpty = fingerprint.fileTree.length < 3;
  if (isEmpty) {
    fingerprint.description = await promptInput('What will you build in this project?');
  }

  // Step 4: Generate setup via AI
  const hasExistingConfig = !!(
    fingerprint.existingConfigs.claudeMd || fingerprint.existingConfigs.claudeSettings ||
    fingerprint.existingConfigs.claudeSkills?.length ||
    fingerprint.existingConfigs.cursorrules || fingerprint.existingConfigs.cursorRules?.length
  );

  if (hasExistingConfig) {
    console.log(chalk.hex('#6366f1').bold('  Step 3/4 — Auditing your configs\n'));
    console.log(chalk.dim('  AI is reviewing your existing configs against your codebase'));
    console.log(chalk.dim('  and suggesting improvements.\n'));
  } else {
    console.log(chalk.hex('#6366f1').bold('  Step 3/4 — Generating configs\n'));
    console.log(chalk.dim('  AI is creating agent config files tailored to your project.\n'));
  }
  console.log(chalk.dim('  This usually takes 1–3 minutes.\n'));

  const genStartTime = Date.now();
  const genSpinner = ora('Generating setup...').start();
  const genMessages = new SpinnerMessages(genSpinner, GENERATION_MESSAGES, { showElapsedTime: true });
  genMessages.start();

  let generatedSetup: Record<string, unknown> | null = null;
  let rawOutput: string | undefined;

  try {
    const result = await generateSetup(
      fingerprint,
      targetAgent,
      fingerprint.description,
      {
        onStatus: (status) => { genMessages.handleServerStatus(status); },
        onComplete: (setup) => { generatedSetup = setup; },
        onError: (error) => {
          genMessages.stop();
          genSpinner.fail(`Generation error: ${error}`);
        },
      }
    );

    if (!generatedSetup) {
      generatedSetup = result.setup;
      rawOutput = result.raw;
    }
  } catch (err) {
    genMessages.stop();
    const msg = err instanceof Error ? err.message : 'Unknown error';
    genSpinner.fail(`Generation failed: ${msg}`);
    throw new Error('__exit__');
  }

  genMessages.stop();

  if (!generatedSetup) {
    genSpinner.fail('Failed to generate setup.');
    if (rawOutput) {
      console.log(chalk.dim('\nRaw LLM output (JSON parse failed):'));
      console.log(chalk.dim(rawOutput.slice(0, 500)));
    }
    throw new Error('__exit__');
  }

  const elapsedMs = Date.now() - genStartTime;
  const mins = Math.floor(elapsedMs / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  genSpinner.succeed(`Setup generated ${chalk.dim(`in ${timeStr}`)}`);
  printSetupSummary(generatedSetup);

  // Step 5: Accept / Refine / Decline with staging
  console.log(chalk.hex('#6366f1').bold('  Step 4/4 — Review\n'));

  const setupFiles = collectSetupFiles(generatedSetup);
  const staged = stageFiles(setupFiles, process.cwd());

  console.log(chalk.dim(`  ${chalk.green(`${staged.newFiles} new`)} / ${chalk.yellow(`${staged.modifiedFiles} modified`)} file${staged.newFiles + staged.modifiedFiles !== 1 ? 's' : ''}\n`));

  const wantsReview = await promptWantsReview();
  if (wantsReview) {
    const reviewMethod = await promptReviewMethod();
    openReview(reviewMethod, staged.stagedFiles);
  }

  let action = await promptReviewAction();

  while (action === 'refine') {
    generatedSetup = await refineLoop(generatedSetup, targetAgent);
    if (!generatedSetup) {
      cleanupStaging();
      console.log(chalk.dim('Refinement cancelled. No files were modified.'));
      return;
    }
    const updatedFiles = collectSetupFiles(generatedSetup);
    const restaged = stageFiles(updatedFiles, process.cwd());
    console.log(chalk.dim(`  ${chalk.green(`${restaged.newFiles} new`)} / ${chalk.yellow(`${restaged.modifiedFiles} modified`)} file${restaged.newFiles + restaged.modifiedFiles !== 1 ? 's' : ''}\n`));
    printSetupSummary(generatedSetup);
    const wantsReviewAgain = await promptWantsReview();
    if (wantsReviewAgain) {
      const reviewMethod = await promptReviewMethod();
      openReview(reviewMethod, restaged.stagedFiles);
    }
    action = await promptReviewAction();
  }

  cleanupStaging();

  if (action === 'decline') {
    console.log(chalk.dim('Setup declined. No files were modified.'));
    return;
  }

  // Write files
  if (options.dryRun) {
    console.log(chalk.yellow('\n[Dry run] Would write the following files:'));
    console.log(JSON.stringify(generatedSetup, null, 2));
    return;
  }

  const writeSpinner = ora('Writing config files...').start();
  try {
    const result = writeSetup(generatedSetup as unknown as Parameters<typeof writeSetup>[0]);
    writeSpinner.succeed('Config files written');

    console.log(chalk.bold('\nFiles created/updated:'));
    for (const file of result.written) {
      console.log(`  ${chalk.green('✓')} ${file}`);
    }
    if (result.deleted.length > 0) {
      console.log(chalk.bold('\nFiles removed:'));
      for (const file of result.deleted) {
        console.log(`  ${chalk.red('✗')} ${file}`);
      }
    }
    if (result.backupDir) {
      console.log(chalk.dim(`\n  Backups saved to ${result.backupDir}`));
    }
  } catch (err) {
    writeSpinner.fail('Failed to write files');
    console.error(chalk.red(err instanceof Error ? err.message : 'Unknown error'));
    throw new Error('__exit__');
  }

  // Generate AGENTS.md if it doesn't exist
  if (!fs.existsSync('AGENTS.md')) {
    const agentsContent = '# AGENTS.md\n\nThis project uses AI coding agents. See CLAUDE.md for Claude Code configuration and .cursor/rules/ for Cursor rules.\n';
    fs.writeFileSync('AGENTS.md', agentsContent);
    console.log(`  ${chalk.green('✓')} AGENTS.md`);
  }

  // Ensure permissions.allow exists in .claude/settings.json
  ensurePermissions();

  // Save target agent to state
  const sha = getCurrentHeadSha();
  writeState({
    lastRefreshSha: sha ?? '',
    lastRefreshTimestamp: new Date().toISOString(),
    targetAgent,
  });

  // Prompt user for auto-refresh hook preference
  const hookChoice = await promptHookType(targetAgent);

  if (hookChoice === 'claude' || hookChoice === 'both') {
    const hookResult = installHook();
    if (hookResult.installed) {
      console.log(`  ${chalk.green('✓')} Claude Code hook installed — docs update on session end`);
      console.log(chalk.dim('    Run `caliber hooks remove` to disable'));
    } else if (hookResult.alreadyInstalled) {
      console.log(chalk.dim('  Claude Code hook already installed'));
    }

    const learnResult = installLearningHooks();
    if (learnResult.installed) {
      console.log(`  ${chalk.green('✓')} Learning hooks installed — session insights captured automatically`);
      console.log(chalk.dim('    Run `caliber learn remove` to disable'));
    } else if (learnResult.alreadyInstalled) {
      console.log(chalk.dim('  Learning hooks already installed'));
    }
  }

  if (hookChoice === 'precommit' || hookChoice === 'both') {
    const precommitResult = installPreCommitHook();
    if (precommitResult.installed) {
      console.log(`  ${chalk.green('✓')} Pre-commit hook installed — docs refresh before each commit`);
      console.log(chalk.dim('    Run `caliber hooks remove-precommit` to disable'));
    } else if (precommitResult.alreadyInstalled) {
      console.log(chalk.dim('  Pre-commit hook already installed'));
    } else {
      console.log(chalk.yellow('  Could not install pre-commit hook (not a git repository?)'));
    }
  }

  if (hookChoice === 'skip') {
    console.log(chalk.dim('  Skipped auto-refresh hooks. Run `caliber hooks install` later to enable.'));
  }

  // Show score improvement
  const afterScore = computeLocalScore(process.cwd(), targetAgent);
  displayScoreDelta(baselineScore, afterScore);

  console.log(chalk.bold.green('  Setup complete! Your coding agent is now configured.'));
  console.log(chalk.dim('  Run `caliber undo` to revert changes.\n'));

  console.log(chalk.bold('  Next steps:\n'));
  console.log(`    ${chalk.hex('#6366f1')('caliber undo')}         Revert all changes from this run`);
  console.log('');
}

async function refineLoop(
  currentSetup: Record<string, unknown>,
  _targetAgent: string
): Promise<Record<string, unknown> | null> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  while (true) {
    const message = await promptInput('\nWhat would you like to change?');
    if (!message || message.toLowerCase() === 'done' || message.toLowerCase() === 'accept') {
      return currentSetup;
    }
    if (message.toLowerCase() === 'cancel') {
      return null;
    }

    const refineSpinner = ora('Refining setup...').start();
    const refineMessages = new SpinnerMessages(refineSpinner, REFINE_MESSAGES);
    refineMessages.start();

    const refined = await refineSetup(
      currentSetup,
      message,
      history,
    );

    refineMessages.stop();

    if (refined) {
      currentSetup = refined;
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: JSON.stringify(refined) });
      refineSpinner.succeed('Setup updated');
      printSetupSummary(refined);
      console.log(chalk.dim('Type "done" to accept, or describe more changes.'));
    } else {
      refineSpinner.fail('Refinement failed — could not parse AI response.');
      console.log(chalk.dim('Try rephrasing your request, or type "done" to keep the current setup.'));
    }
  }
}

function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(chalk.cyan(`${question} `), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptAgent(): Promise<TargetAgent> {
  return select({
    message: 'Which coding agent are you using?',
    choices: [
      { name: 'Claude Code', value: 'claude' as const },
      { name: 'Cursor', value: 'cursor' as const },
      { name: 'Both', value: 'both' as const },
    ],
  });
}

type HookChoice = 'claude' | 'precommit' | 'both' | 'skip';

async function promptHookType(targetAgent: TargetAgent): Promise<HookChoice> {
  const choices: Array<{ name: string; value: HookChoice }> = [];

  if (targetAgent === 'claude' || targetAgent === 'both') {
    choices.push({ name: 'Claude Code hook (auto-refresh on session end)', value: 'claude' });
  }
  choices.push({ name: 'Git pre-commit hook (refresh before each commit)', value: 'precommit' });
  if (targetAgent === 'claude' || targetAgent === 'both') {
    choices.push({ name: 'Both (Claude Code + pre-commit)', value: 'both' });
  }
  choices.push({ name: 'Skip for now', value: 'skip' });

  return select({
    message: 'How would you like to auto-refresh your docs?',
    choices,
  });
}

async function promptWantsReview(): Promise<boolean> {
  const answer = await select({
    message: 'Would you like to review the diffs before deciding?',
    choices: [
      { name: 'Yes, show me the diffs', value: true },
      { name: 'No, continue', value: false },
    ],
  });
  return answer;
}

async function promptReviewMethod(): Promise<ReviewMethod> {
  const available = detectAvailableEditors();
  if (available.length === 1) return 'terminal';

  const choices = available.map(method => {
    switch (method) {
      case 'cursor': return { name: 'Cursor (diff view)', value: 'cursor' as const };
      case 'vscode': return { name: 'VS Code (diff view)', value: 'vscode' as const };
      case 'terminal': return { name: 'Terminal', value: 'terminal' as const };
    }
  });

  return select({ message: 'How would you like to review the changes?', choices });
}

function openReview(method: ReviewMethod, stagedFiles: StagedFile[]): void {
  if (method === 'cursor' || method === 'vscode') {
    openDiffsInEditor(method, stagedFiles.map(f => ({
      originalPath: f.originalPath,
      proposedPath: f.proposedPath,
    })));
    console.log(chalk.dim('  Diffs opened in your editor.\n'));
  } else {
    for (const file of stagedFiles) {
      if (file.currentPath) {
        const currentLines = fs.readFileSync(file.currentPath, 'utf-8').split('\n');
        const proposedLines = fs.readFileSync(file.proposedPath, 'utf-8').split('\n');
        const patch = createTwoFilesPatch(file.relativePath, file.relativePath, currentLines.join('\n'), proposedLines.join('\n'));
        let added = 0, removed = 0;
        for (const line of patch.split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) added++;
          if (line.startsWith('-') && !line.startsWith('---')) removed++;
        }
        console.log(`    ${chalk.yellow('~')} ${file.relativePath}  ${chalk.green(`+${added}`)} ${chalk.red(`-${removed}`)}`);
      } else {
        const lines = fs.readFileSync(file.proposedPath, 'utf-8').split('\n').length;
        console.log(`    ${chalk.green('+')} ${file.relativePath}  ${chalk.dim(`${lines} lines`)}`);
      }
    }
    console.log('');
    console.log(chalk.dim(`  Files staged at .caliber/staged/ for manual inspection.\n`));
  }
}

async function promptReviewAction(): Promise<'accept' | 'refine' | 'decline'> {
  return select({
    message: 'What would you like to do?',
    choices: [
      { name: 'Accept and apply', value: 'accept' as const },
      { name: 'Refine via chat', value: 'refine' as const },
      { name: 'Decline', value: 'decline' as const },
    ],
  });
}

function printSetupSummary(setup: Record<string, unknown>) {
  const claude = setup.claude as Record<string, unknown> | undefined;
  const cursor = setup.cursor as Record<string, unknown> | undefined;
  const fileDescriptions = setup.fileDescriptions as Record<string, string> | undefined;
  const deletions = setup.deletions as Array<{ filePath: string; reason: string }> | undefined;

  console.log('');
  console.log(chalk.bold('  Proposed changes:\n'));

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

    const rules = cursor.rules as Array<{ filename: string; content: string }> | undefined;
    if (Array.isArray(rules) && rules.length > 0) {
      for (const rule of rules) {
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

function buildSkillContent(skill: { name: string; description: string; content: string }): string {
  const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`;
  return frontmatter + skill.content;
}

function ensurePermissions(): void {
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

  permissions.allow = [
    'Bash(npm run *)',
    'Bash(npx vitest *)',
    'Bash(npx tsc *)',
    'Bash(git *)',
  ];
  settings.permissions = permissions;

  if (!fs.existsSync('.claude')) fs.mkdirSync('.claude', { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

function collectSetupFiles(setup: Record<string, unknown>): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const claude = setup.claude as Record<string, unknown> | undefined;
  const cursor = setup.cursor as Record<string, unknown> | undefined;

  if (claude) {
    if (claude.claudeMd) files.push({ path: 'CLAUDE.md', content: claude.claudeMd as string });
    const skills = claude.skills as Array<{ name: string; description: string; content: string }> | undefined;
    if (Array.isArray(skills)) {
      for (const skill of skills) {
        files.push({ path: `.claude/skills/${skill.name}/SKILL.md`, content: buildSkillContent(skill) });
      }
    }
  }

  if (cursor) {
    if (cursor.cursorrules) files.push({ path: '.cursorrules', content: cursor.cursorrules as string });
    const cursorSkills = cursor.skills as Array<{ name: string; description: string; content: string }> | undefined;
    if (Array.isArray(cursorSkills)) {
      for (const skill of cursorSkills) {
        files.push({ path: `.cursor/skills/${skill.name}/SKILL.md`, content: buildSkillContent(skill) });
      }
    }
    const rules = cursor.rules as Array<{ filename: string; content: string }> | undefined;
    if (Array.isArray(rules)) {
      for (const rule of rules) {
        files.push({ path: `.cursor/rules/${rule.filename}`, content: rule.content });
      }
    }
  }

  return files;
}

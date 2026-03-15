import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import select from '@inquirer/select';
import checkbox from '@inquirer/checkbox';
import fs from 'fs';
import { collectFingerprint } from '../fingerprint/index.js';
import { generateSetup } from '../ai/generate.js';
import { refineSetup } from '../ai/refine.js';
import { writeSetup, undoSetup } from '../writers/index.js';
import { stageFiles, cleanupStaging } from '../writers/staging.js';
import { promptWantsReview, promptReviewMethod, openReview } from '../utils/review.js';
import { collectSetupFiles } from './setup-files.js';
import { installHook, installPreCommitHook } from '../lib/hooks.js';
import { installLearningHooks } from '../lib/learning-hooks.js';
import { writeState, getCurrentHeadSha } from '../lib/state.js';
import { SpinnerMessages, GENERATION_MESSAGES, REFINE_MESSAGES } from '../utils/spinner-messages.js';
import { loadConfig, getFastModel } from '../llm/config.js';
import { llmJsonCall, validateModel, getUsageSummary } from '../llm/index.js';
import { runInteractiveProviderSetup } from './interactive-provider-setup.js';
import { computeLocalScore } from '../scoring/index.js';
import type { Check } from '../scoring/index.js';
import { displayScoreSummary, displayScoreDelta } from '../scoring/display.js';
import { readDismissedChecks, writeDismissedChecks } from '../scoring/dismissed.js';
import type { DismissedCheck } from '../scoring/dismissed.js';
import { searchAndInstallSkills } from './recommend.js';
import type { FailingCheck, PassingCheck } from '../ai/generate.js';
import { buildGeneratePrompt } from '../ai/generate.js';
import { DebugReport } from '../lib/debug-report.js';
import {
  trackInitProviderSelected,
  trackInitProjectDiscovered,
  trackInitAgentSelected,
  trackInitScoreComputed,
  trackInitGenerationStarted,
  trackInitGenerationCompleted,
  trackInitReviewAction,
  trackInitRefinementRound,
  trackInitFilesWritten,
  trackInitHookSelected,
  trackInitSkillsSearch,
  trackInitScoreRegression,
} from '../telemetry/events.js';

type TargetAgent = ('claude' | 'cursor' | 'codex')[];

interface InitOptions {
  agent?: TargetAgent;
  dryRun?: boolean;
  force?: boolean;
  debugReport?: boolean;
  showTokens?: boolean;
}

export async function initCommand(options: InitOptions) {
  const brand = chalk.hex('#EB9D83');
  const title = chalk.hex('#83D1EB');
  console.log(brand.bold(`
   ██████╗ █████╗ ██╗     ██╗██████╗ ███████╗██████╗
  ██╔════╝██╔══██╗██║     ██║██╔══██╗██╔════╝██╔══██╗
  ██║     ███████║██║     ██║██████╔╝█████╗  ██████╔╝
  ██║     ██╔══██║██║     ██║██╔══██╗██╔══╝  ██╔══██╗
  ╚██████╗██║  ██║███████╗██║██████╔╝███████╗██║  ██║
   ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
  `));
  console.log(chalk.dim('  Initialize your project for AI-assisted development\n'));

  console.log(title.bold('  Welcome to Caliber\n'));
  console.log(chalk.dim('  Caliber analyzes your codebase and creates tailored config files'));
  console.log(chalk.dim('  so your AI coding agents understand your project from day one.\n'));

  const report = options.debugReport ? new DebugReport() : null;

  console.log(title.bold('  How it works:\n'));
  console.log(chalk.dim('  1. Connect    Set up your LLM provider'));
  console.log(chalk.dim('  2. Discover   Analyze your code, dependencies, and structure'));
  console.log(chalk.dim('  3. Generate   Create config files tailored to your project'));
  console.log(chalk.dim('  4. Review     Preview, refine, and apply the changes'));
  console.log(chalk.dim('  5. Enhance    Discover MCP servers for your tools'));
  console.log(chalk.dim('  6. Skills     Browse community skills for your stack\n'));

  // Step 1: Connect LLM provider
  console.log(title.bold('  Step 1/6 — Connect your LLM\n'));
  let config = loadConfig();
  if (!config) {
    console.log(chalk.dim('  No LLM provider set yet. Choose how to run Caliber:\n'));
    try {
      await runInteractiveProviderSetup({
        selectMessage: 'How do you want to use Caliber? (choose LLM provider)',
      });
    } catch (err) {
      if ((err as Error).message === '__exit__') throw err;
      throw err;
    }
    config = loadConfig();
    if (!config) {
      console.log(chalk.red('  Setup was cancelled or failed.\n'));
      throw new Error('__exit__');
    }
    console.log(chalk.green('  ✓ Provider saved. Let\'s continue.\n'));
  }
  trackInitProviderSelected(config.provider, config.model);
  const displayModel = config.model === 'default' && config.provider === 'claude-cli'
    ? process.env.ANTHROPIC_MODEL || 'default (inherited from Claude Code)'
    : config.model;
  const fastModel = getFastModel();
  const modelLine = fastModel
    ? `  Provider: ${config.provider} | Model: ${displayModel} | Scan: ${fastModel}`
    : `  Provider: ${config.provider} | Model: ${displayModel}`;
  console.log(chalk.dim(modelLine + '\n'));

  if (report) {
    report.markStep('Provider setup');
    report.addSection('LLM Provider', `- **Provider**: ${config.provider}\n- **Model**: ${displayModel}\n- **Fast model**: ${fastModel || 'none'}`);
  }

  // Verify configured model is reachable before starting heavy work
  await validateModel({ fast: true });

  // Step 2: Discover project
  console.log(title.bold('  Step 2/6 — Discover your project\n'));
  console.log(chalk.dim('  Learning about your languages, dependencies, structure, and existing configs.\n'));
  const spinner = ora('Analyzing project...').start();
  const fingerprint = await collectFingerprint(process.cwd());
  spinner.succeed('Project analyzed');

  trackInitProjectDiscovered(fingerprint.languages.length, fingerprint.frameworks.length, fingerprint.fileTree.length);
  console.log(chalk.dim(`  Languages: ${fingerprint.languages.join(', ') || 'none detected'}`));
  console.log(chalk.dim(`  Files: ${fingerprint.fileTree.length} found\n`));

  if (report) {
    report.markStep('Fingerprint');
    report.addJson('Fingerprint: Git', { remote: fingerprint.gitRemoteUrl, packageName: fingerprint.packageName });
    report.addCodeBlock('Fingerprint: File Tree', fingerprint.fileTree.join('\n'));
    report.addJson('Fingerprint: Detected Stack', { languages: fingerprint.languages, frameworks: fingerprint.frameworks, tools: fingerprint.tools });
    report.addJson('Fingerprint: Existing Configs', fingerprint.existingConfigs);
    if (fingerprint.codeAnalysis) {
      report.addJson('Fingerprint: Code Analysis', fingerprint.codeAnalysis);
    }
  }

  // Step 3: Determine target agent
  const targetAgent = options.agent || await promptAgent();
  trackInitAgentSelected(targetAgent);

  // Evaluate which failing checks aren't applicable to this project
  const preScore = computeLocalScore(process.cwd(), targetAgent);
  const failingForDismissal = preScore.checks.filter(c => !c.passed && c.maxPoints > 0);
  if (failingForDismissal.length > 0) {
    const newDismissals = await evaluateDismissals(failingForDismissal, fingerprint);
    if (newDismissals.length > 0) {
      const existing = readDismissedChecks();
      const existingIds = new Set(existing.map(d => d.id));
      const merged = [...existing, ...newDismissals.filter(d => !existingIds.has(d.id))];
      writeDismissedChecks(merged);
    }
  }

  // Baseline score (after dismissals applied)
  const baselineScore = computeLocalScore(process.cwd(), targetAgent);
  displayScoreSummary(baselineScore);
  const passingCount = baselineScore.checks.filter(c => c.passed).length;
  const failingCount = baselineScore.checks.filter(c => !c.passed).length;

  if (report) {
    report.markStep('Baseline scoring');
    report.addSection('Scoring: Baseline', `**Score**: ${baselineScore.score}/100\n\n| Check | Passed | Points | Max |\n|-------|--------|--------|-----|\n` +
      baselineScore.checks.map(c => `| ${c.name} | ${c.passed ? 'Yes' : 'No'} | ${c.earnedPoints} | ${c.maxPoints} |`).join('\n'));
    report.addSection('Generation: Target Agents', targetAgent.join(', '));
  }

  const hasExistingConfig = !!(
    fingerprint.existingConfigs.claudeMd || fingerprint.existingConfigs.claudeSettings ||
    fingerprint.existingConfigs.claudeSkills?.length ||
    fingerprint.existingConfigs.cursorrules || fingerprint.existingConfigs.cursorRules?.length ||
    fingerprint.existingConfigs.agentsMd
  );

  // Checks the LLM cannot fix — they require CLI actions, not config changes
  const NON_LLM_CHECKS = new Set([
    'hooks_configured',
    'agents_md_exists',
    'permissions_configured',
    'mcp_servers',
    'service_coverage',
    'mcp_completeness',
  ]);

  // Score gating: skip generation if already perfect, targeted fix if close
  if (hasExistingConfig && baselineScore.score === 100) {
    trackInitScoreComputed(baselineScore.score, passingCount, failingCount, true);
    console.log(chalk.bold.green('  Your setup is already optimal — nothing to change.\n'));
    console.log(chalk.dim('  Run ') + chalk.hex('#83D1EB')('caliber init --force') + chalk.dim(' to regenerate anyway.\n'));
    if (!options.force) return;
  }

  // If the only failing checks are non-LLM-fixable, skip generation and show actionable hints
  const allFailingChecks = baselineScore.checks.filter(c => !c.passed && c.maxPoints > 0);
  const llmFixableChecks = allFailingChecks.filter(c => !NON_LLM_CHECKS.has(c.id));

  trackInitScoreComputed(baselineScore.score, passingCount, failingCount, false);

  if (hasExistingConfig && llmFixableChecks.length === 0 && allFailingChecks.length > 0 && !options.force) {
    console.log(chalk.bold.green('\n  Your config is fully optimized for LLM generation.\n'));
    console.log(chalk.dim('  Remaining items need CLI actions:\n'));
    for (const check of allFailingChecks) {
      console.log(chalk.dim(`    • ${check.name}`));
      if (check.suggestion) {
        console.log(`      ${chalk.hex('#83D1EB')(check.suggestion)}`);
      }
    }
    console.log('');
    console.log(chalk.dim('  Run ') + chalk.hex('#83D1EB')('caliber init --force') + chalk.dim(' to regenerate anyway.\n'));
    return;
  }

  // Get project description if empty directory
  const isEmpty = fingerprint.fileTree.length < 3;
  if (isEmpty) {
    fingerprint.description = await promptInput('What will you build in this project?');
  }

  // Determine if this should be a targeted fix (score >= 95 with existing configs)
  let failingChecks: FailingCheck[] | undefined;
  let passingChecks: PassingCheck[] | undefined;
  let currentScore: number | undefined;

  if (hasExistingConfig && baselineScore.score >= 95 && !options.force) {
    failingChecks = llmFixableChecks
      .map(c => ({ name: c.name, suggestion: c.suggestion }));
    passingChecks = baselineScore.checks
      .filter(c => c.passed)
      .map(c => ({ name: c.name }));
    currentScore = baselineScore.score;

    if (failingChecks.length > 0) {
      console.log(title.bold('  Step 3/6 — Fine-tuning\n'));
      console.log(chalk.dim(`  Your setup scores ${baselineScore.score}/100 — fixing ${failingChecks.length} remaining issue${failingChecks.length === 1 ? '' : 's'}:\n`));
      for (const check of failingChecks) {
        console.log(chalk.dim(`    • ${check.name}`));
      }
      console.log('');
    }
  } else if (hasExistingConfig) {
    console.log(title.bold('  Step 3/6 — Improve your setup\n'));
    console.log(chalk.dim('  Reviewing your existing configs against your codebase'));
    console.log(chalk.dim('  and preparing improvements.\n'));
  } else {
    console.log(title.bold('  Step 3/6 — Build your agent setup\n'));
    console.log(chalk.dim('  Creating config files tailored to your project.\n'));
  }
  console.log(chalk.dim('  This can take a couple of minutes depending on your model and provider.\n'));

  if (report) {
    report.markStep('Generation');
    const fullPrompt = buildGeneratePrompt(fingerprint, targetAgent, fingerprint.description, failingChecks, currentScore, passingChecks);
    report.addCodeBlock('Generation: Full LLM Prompt', fullPrompt);
  }

  trackInitGenerationStarted(!!failingChecks);
  const genStartTime = Date.now();
  const genSpinner = ora('Generating setup...').start();
  const genMessages = new SpinnerMessages(genSpinner, GENERATION_MESSAGES, { showElapsedTime: true });
  genMessages.start();

  let generatedSetup: Record<string, unknown> | null = null;
  let rawOutput: string | undefined;
  let genStopReason: string | undefined;

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
      },
      failingChecks,
      currentScore,
      passingChecks,
    );

    if (!generatedSetup) {
      generatedSetup = result.setup;
      rawOutput = result.raw;
    }
    genStopReason = result.stopReason;
  } catch (err) {
    genMessages.stop();
    const msg = err instanceof Error ? err.message : 'Unknown error';
    genSpinner.fail(`Generation failed: ${msg}`);
    writeErrorLog(config, undefined, msg, 'exception');
    throw new Error('__exit__');
  }

  genMessages.stop();

  if (!generatedSetup) {
    genSpinner.fail('Failed to generate setup.');
    writeErrorLog(config, rawOutput, undefined, genStopReason);
    if (rawOutput) {
      console.log(chalk.dim('\nRaw LLM output (JSON parse failed):'));
      console.log(chalk.dim(rawOutput.slice(0, 500)));
    }
    throw new Error('__exit__');
  }

  if (report) {
    if (rawOutput) report.addCodeBlock('Generation: Raw LLM Response', rawOutput);
    report.addJson('Generation: Parsed Setup', generatedSetup);
  }

  const elapsedMs = Date.now() - genStartTime;
  trackInitGenerationCompleted(elapsedMs, 0);
  const mins = Math.floor(elapsedMs / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  genSpinner.succeed(`Setup generated ${chalk.dim(`in ${timeStr}`)}`);
  printSetupSummary(generatedSetup);

  // Session context — carries through the entire init flow
  const sessionHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  sessionHistory.push({
    role: 'assistant',
    content: summarizeSetup('Initial generation', generatedSetup),
  });

  // Step 4: Review and apply
  console.log(title.bold('  Step 4/6 — Review and apply\n'));

  const setupFiles = collectSetupFiles(generatedSetup);
  const staged = stageFiles(setupFiles, process.cwd());

  const totalChanges = staged.newFiles + staged.modifiedFiles;
  console.log(chalk.dim(`  ${chalk.green(`${staged.newFiles} new`)} / ${chalk.yellow(`${staged.modifiedFiles} modified`)} file${totalChanges !== 1 ? 's' : ''}\n`));

  let action: 'accept' | 'refine' | 'decline';

  if (totalChanges === 0) {
    console.log(chalk.dim('  No changes needed — your configs are already up to date.\n'));
    cleanupStaging();
    action = 'accept';
  } else {
    const wantsReview = await promptWantsReview();
    if (wantsReview) {
      const reviewMethod = await promptReviewMethod();
      await openReview(reviewMethod, staged.stagedFiles);
    }

    action = await promptReviewAction();
    trackInitReviewAction(action, wantsReview ? 'reviewed' : 'skipped');
  }

  let refinementRound = 0;
  while (action === 'refine') {
    refinementRound++;
    generatedSetup = await refineLoop(generatedSetup, targetAgent, sessionHistory);
    trackInitRefinementRound(refinementRound, !!generatedSetup);
    if (!generatedSetup) {
      cleanupStaging();
      console.log(chalk.dim('Refinement cancelled. No files were modified.'));
      return;
    }
    const updatedFiles = collectSetupFiles(generatedSetup);
    const restaged = stageFiles(updatedFiles, process.cwd());
    console.log(chalk.dim(`  ${chalk.green(`${restaged.newFiles} new`)} / ${chalk.yellow(`${restaged.modifiedFiles} modified`)} file${restaged.newFiles + restaged.modifiedFiles !== 1 ? 's' : ''}\n`));
    printSetupSummary(generatedSetup);
    await openReview('terminal', restaged.stagedFiles);
    action = await promptReviewAction();
    trackInitReviewAction(action, 'terminal');
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
    trackInitFilesWritten(
      result.written.length + result.deleted.length,
      result.written.length,
      0,
      result.deleted.length,
    );

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
  console.log('');
  console.log(title.bold('  Keep your setup up-to-date as your code evolve\n'));
  console.log(chalk.dim('  Caliber can automatically update your agent configs when your code changes.\n'));
  const hookChoice = await promptHookType(targetAgent);
  trackInitHookSelected(hookChoice);

  if (hookChoice === 'claude' || hookChoice === 'both') {
    const hookResult = installHook();
    if (hookResult.installed) {
      console.log(`  ${chalk.green('✓')} Claude Code hook installed — docs update on session end`);
      console.log(chalk.dim('    Run ') + chalk.hex('#83D1EB')('caliber hooks --remove') + chalk.dim(' to disable'));
    } else if (hookResult.alreadyInstalled) {
      console.log(chalk.dim('  Claude Code hook already installed'));
    }

    const learnResult = installLearningHooks();
    if (learnResult.installed) {
      console.log(`  ${chalk.green('✓')} Learning hooks installed — session insights captured automatically`);
      console.log(chalk.dim('    Run ') + chalk.hex('#83D1EB')('caliber learn remove') + chalk.dim(' to disable'));
    } else if (learnResult.alreadyInstalled) {
      console.log(chalk.dim('  Learning hooks already installed'));
    }
  }

  if (hookChoice === 'precommit' || hookChoice === 'both') {
    const precommitResult = installPreCommitHook();
    if (precommitResult.installed) {
      console.log(`  ${chalk.green('✓')} Pre-commit hook installed — docs refresh before each commit`);
      console.log(chalk.dim('    Run ') + chalk.hex('#83D1EB')('caliber hooks --remove') + chalk.dim(' to disable'));
    } else if (precommitResult.alreadyInstalled) {
      console.log(chalk.dim('  Pre-commit hook already installed'));
    } else {
      console.log(chalk.yellow('  Could not install pre-commit hook (not a git repository?)'));
    }
  }

  if (hookChoice === 'skip') {
    console.log(chalk.dim('  Skipped auto-refresh hooks. Run ') + chalk.hex('#83D1EB')('caliber hooks --install') + chalk.dim(' later to enable.'));
  }

  // Show score improvement
  let afterScore = computeLocalScore(process.cwd(), targetAgent);

  // Score polish: if not 100, attempt one targeted fix pass
  if (afterScore.score < 100) {
    const polishFailingChecks = afterScore.checks
      .filter(c => !c.passed && c.maxPoints > 0)
      .filter(c => !NON_LLM_CHECKS.has(c.id));

    if (polishFailingChecks.length > 0) {
      console.log('');
      console.log(chalk.dim(`  Score: ${afterScore.score}/100 — polishing ${polishFailingChecks.length} remaining check${polishFailingChecks.length === 1 ? '' : 's'}...`));

      const polishFailing: FailingCheck[] = polishFailingChecks.map(c => ({
        name: c.name,
        suggestion: c.suggestion,
      }));
      const polishPassing: PassingCheck[] = afterScore.checks
        .filter(c => c.passed)
        .map(c => ({ name: c.name }));

      try {
        const polishResult = await generateSetup(
          fingerprint,
          targetAgent,
          undefined,
          {
            onStatus: () => {},
            onComplete: () => {},
            onError: () => {},
          },
          polishFailing,
          afterScore.score,
          polishPassing,
        );

        if (polishResult.setup) {
          const polishWriteResult = writeSetup(polishResult.setup as unknown as Parameters<typeof writeSetup>[0]);
          if (polishWriteResult.written.length > 0) {
            afterScore = computeLocalScore(process.cwd(), targetAgent);
          }
        }
      } catch {
        // Polish failed — continue with current score
      }
    }
  }

  // Guard: if score regressed, auto-undo
  if (afterScore.score < baselineScore.score) {
    trackInitScoreRegression(baselineScore.score, afterScore.score);
    console.log('');
    console.log(chalk.yellow(`  Score would drop from ${baselineScore.score} to ${afterScore.score} — reverting changes.`));
    try {
      const { restored, removed } = undoSetup();
      if (restored.length > 0 || removed.length > 0) {
        console.log(chalk.dim(`  Reverted ${restored.length + removed.length} file${restored.length + removed.length === 1 ? '' : 's'} from backup.`));
      }
    } catch { /* best effort */ }
    console.log(chalk.dim('  Run ') + chalk.hex('#83D1EB')('caliber init --force') + chalk.dim(' to override.\n'));
    return;
  }

  if (report) {
    report.markStep('Post-write scoring');
    report.addSection('Scoring: Post-Write', `**Score**: ${afterScore.score}/100 (delta: ${afterScore.score - baselineScore.score >= 0 ? '+' : ''}${afterScore.score - baselineScore.score})\n\n| Check | Passed | Points | Max |\n|-------|--------|--------|-----|\n` +
      afterScore.checks.map(c => `| ${c.name} | ${c.passed ? 'Yes' : 'No'} | ${c.earnedPoints} | ${c.maxPoints} |`).join('\n'));
  }

  displayScoreDelta(baselineScore, afterScore);

  // Step 6: Community skills
  console.log(title.bold('\n  Step 6/6 — Community skills\n'));
  console.log(chalk.dim('  Search public skill registries for skills that match your tech stack.\n'));

  const wantsSkills = await select({
    message: 'Search public repos for relevant skills to add to this project?',
    choices: [
      { name: 'Yes, find skills for my project', value: true },
      { name: 'Skip for now', value: false },
    ],
  });

  if (wantsSkills) {
    trackInitSkillsSearch(true, 0);
    try {
      await searchAndInstallSkills();
    } catch (err) {
      if ((err as Error).message !== '__exit__') {
        console.log(chalk.dim('  Skills search failed: ' + ((err as Error).message || 'unknown error')));
      }
      console.log(chalk.dim('  Run ') + chalk.hex('#83D1EB')('caliber skills') + chalk.dim(' later to try again.\n'));
    }
  } else {
    trackInitSkillsSearch(false, 0);
    console.log(chalk.dim('  Skipped. Run ') + chalk.hex('#83D1EB')('caliber skills') + chalk.dim(' later to browse.\n'));
  }

  console.log(chalk.bold.green('  Setup complete! Your project is ready for AI-assisted development.'));
  console.log(chalk.dim('  Run ') + chalk.hex('#83D1EB')('caliber undo') + chalk.dim(' to revert changes.\n'));

  console.log(chalk.bold('  Next steps:\n'));
  console.log(`    ${title('caliber score')}        See your full config breakdown`);
  console.log(`    ${title('caliber skills')}         Discover community skills for your stack`);
  console.log(`    ${title('caliber undo')}         Revert all changes from this run`);
  console.log('');

  if (options.showTokens) {
    displayTokenUsage();
  }

  if (report) {
    report.markStep('Finished');
    const reportPath = path.join(process.cwd(), '.caliber', 'debug-report.md');
    report.write(reportPath);
    console.log(chalk.dim(`  Debug report written to ${path.relative(process.cwd(), reportPath)}\n`));
  }
}

async function refineLoop(
  currentSetup: Record<string, unknown>,
  _targetAgent: TargetAgent,
  sessionHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<Record<string, unknown> | null> {
  while (true) {
    const message = await promptInput('\nWhat would you like to change?');
    if (!message || message.toLowerCase() === 'done' || message.toLowerCase() === 'accept') {
      return currentSetup;
    }
    if (message.toLowerCase() === 'cancel') {
      return null;
    }

    // Quick intent check — avoid sending non-refinement requests to the expensive model
    const isValid = await classifyRefineIntent(message);
    if (!isValid) {
      console.log(chalk.dim('  This doesn\'t look like a config change request.'));
      console.log(chalk.dim('  Describe what to add, remove, or modify in your configs.'));
      console.log(chalk.dim('  Type "done" to accept the current setup.\n'));
      continue;
    }

    const refineSpinner = ora('Refining setup...').start();
    const refineMessages = new SpinnerMessages(refineSpinner, REFINE_MESSAGES);
    refineMessages.start();

    const refined = await refineSetup(
      currentSetup,
      message,
      sessionHistory,
    );

    refineMessages.stop();

    if (refined) {
      currentSetup = refined;
      sessionHistory.push({ role: 'user', content: message });
      sessionHistory.push({
        role: 'assistant',
        content: summarizeSetup('Applied changes', refined),
      });
      refineSpinner.succeed('Setup updated');
      printSetupSummary(refined);
      console.log(chalk.dim('Type "done" to accept, or describe more changes.'));
    } else {
      refineSpinner.fail('Refinement failed — could not parse AI response.');
      console.log(chalk.dim('Try rephrasing your request, or type "done" to keep the current setup.'));
    }
  }
}

function summarizeSetup(action: string, setup: Record<string, unknown>): string {
  const descriptions = setup.fileDescriptions as Record<string, string> | undefined;
  const files = descriptions
    ? Object.entries(descriptions).map(([path, desc]) => `  ${path}: ${desc}`).join('\n')
    : Object.keys(setup).filter(k => k !== 'targetAgent' && k !== 'fileDescriptions').join(', ');
  return `${action}. Files:\n${files}`;
}

async function classifyRefineIntent(message: string): Promise<boolean> {
  const fastModel = getFastModel();
  try {
    const result = await llmJsonCall<{ valid: boolean }>({
      system: `You classify whether a user message is a valid request to modify AI agent config files (CLAUDE.md, .cursorrules, skills).
Valid: requests to add, remove, change, or restructure config content. Examples: "add testing commands", "remove the terraform section", "make CLAUDE.md shorter".
Invalid: questions, requests to show/display something, general chat, or anything that isn't a concrete config change.
Return {"valid": true} or {"valid": false}. Nothing else.`,
      prompt: message,
      maxTokens: 20,
      ...(fastModel ? { model: fastModel } : {}),
    });
    return result.valid === true;
  } catch {
    // If the check fails, let it through — better to try than block
    return true;
  }
}

async function evaluateDismissals(
  failingChecks: readonly Check[],
  fingerprint: { languages: string[]; frameworks: string[] },
): Promise<DismissedCheck[]> {
  const fastModel = getFastModel();
  const checkList = failingChecks.map(c => ({
    id: c.id,
    name: c.name,
    suggestion: c.suggestion,
  }));

  try {
    const result = await llmJsonCall<{ dismissed: Array<{ id: string; reason: string }> }>({
      system: `You evaluate whether scoring checks are applicable to a project.
Given the project's languages/frameworks and a list of failing checks, return which checks are NOT applicable.

Only dismiss checks that truly don't apply — e.g. "Build/test/lint commands" for a pure Terraform/HCL repo with no build system.
Do NOT dismiss checks that could reasonably apply even if the project doesn't use them yet.

Return {"dismissed": [{"id": "check_id", "reason": "brief reason"}]} or {"dismissed": []} if all apply.`,
      prompt: `Languages: ${fingerprint.languages.join(', ') || 'none'}
Frameworks: ${fingerprint.frameworks.join(', ') || 'none'}

Failing checks:
${JSON.stringify(checkList, null, 2)}`,
      maxTokens: 200,
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
  const selected = await checkbox({
    message: 'Which coding agents do you use? (toggle with space)',
    choices: [
      { name: 'Claude Code', value: 'claude' as const },
      { name: 'Cursor', value: 'cursor' as const },
      { name: 'Codex (OpenAI)', value: 'codex' as const },
    ],
    validate: (items) => {
      if (items.length === 0) return 'At least one agent must be selected';
      return true;
    },
  });
  return selected;
}

type HookChoice = 'claude' | 'precommit' | 'both' | 'skip';

async function promptHookType(targetAgent: TargetAgent): Promise<HookChoice> {
  const choices: Array<{ name: string; value: HookChoice }> = [];
  const hasClaude = targetAgent.includes('claude');

  if (hasClaude) {
    choices.push({ name: 'Claude Code hook (auto-refresh on session end)', value: 'claude' });
  }
  choices.push({ name: 'Git pre-commit hook (refresh before each commit)', value: 'precommit' });
  if (hasClaude) {
    choices.push({ name: 'Both (Claude Code + pre-commit)', value: 'both' });
  }
  choices.push({ name: 'Skip for now', value: 'skip' });

  return select({
    message: 'How would you like to auto-refresh your setup?',
    choices,
  });
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

  // AGENTS.md (added by collectSetupFiles if missing, or generated by codex)
  if (!codex && !fs.existsSync('AGENTS.md')) {
    console.log(`  ${chalk.green('+')} ${chalk.bold('AGENTS.md')}`);
    console.log(chalk.dim('    Cross-agent coordination file'));
    console.log('');
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

function displayTokenUsage(): void {
  const summary = getUsageSummary();
  if (summary.length === 0) return;

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

function writeErrorLog(
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


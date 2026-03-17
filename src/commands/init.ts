import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import select from '@inquirer/select';
import checkbox from '@inquirer/checkbox';
import fs from 'fs';
import { collectFingerprint, type Fingerprint } from '../fingerprint/index.js';
import { generateSetup, generateSkillsForSetup } from '../ai/generate.js';
import { refineSetup } from '../ai/refine.js';
import { writeSetup, undoSetup } from '../writers/index.js';
import { stageFiles, cleanupStaging } from '../writers/staging.js';
import { promptReviewMethod, openReview } from '../utils/review.js';
import { collectSetupFiles } from './setup-files.js';
import { installHook, installPreCommitHook } from '../lib/hooks.js';
import { installLearningHooks, installCursorLearningHooks } from '../lib/learning-hooks.js';
import { writeState, getCurrentHeadSha } from '../lib/state.js';
import { SpinnerMessages, REFINE_MESSAGES } from '../utils/spinner-messages.js';
import { promptInput } from '../utils/prompt.js';
import { loadConfig, getFastModel, getDisplayModel } from '../llm/config.js';
import { llmJsonCall, validateModel, getUsageSummary } from '../llm/index.js';
import { runInteractiveProviderSetup } from './interactive-provider-setup.js';
import { computeLocalScore } from '../scoring/index.js';
import type { Check } from '../scoring/index.js';
import { displayScoreSummary, displayScoreDelta } from '../scoring/display.js';
import { readDismissedChecks, writeDismissedChecks } from '../scoring/dismissed.js';
import type { DismissedCheck } from '../scoring/dismissed.js';
import { searchSkills, selectSkills, installSkills } from './recommend.js';
import type { SkillSearchResult } from './recommend.js';
import type { FailingCheck, PassingCheck } from '../ai/generate.js';
import { buildGeneratePrompt } from '../ai/generate.js';
import { scoreAndRefine } from '../ai/score-refine.js';
import { DebugReport } from '../lib/debug-report.js';
import { ParallelTaskDisplay } from '../utils/parallel-tasks.js';
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
  trackInitLearnEnabled,
} from '../telemetry/events.js';

type TargetAgent = ('claude' | 'cursor' | 'codex')[];

interface InitOptions {
  agent?: TargetAgent;
  dryRun?: boolean;
  force?: boolean;
  debugReport?: boolean;
  showTokens?: boolean;
  autoApprove?: boolean;
  verbose?: boolean;
}

function log(verbose: boolean | undefined, ...args: unknown[]): void {
  if (verbose) console.log(chalk.dim(`  [verbose] ${args.map(String).join(' ')}`));
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
  console.log(chalk.dim('  Scan your project and generate tailored config files for'));
  console.log(chalk.dim('  Claude Code, Cursor, and Codex.\n'));

  const report = options.debugReport ? new DebugReport() : null;

  console.log(title.bold('  How it works:\n'));
  console.log(chalk.dim('  1. Setup      Connect your LLM provider and select your agents'));
  console.log(chalk.dim('  2. Engine     Detect stack, generate configs & skills in parallel'));
  console.log(chalk.dim('  3. Review     See all changes — accept, refine, or decline'));
  console.log(chalk.dim('  4. Finalize   Score check and auto-sync hooks\n'));

  // ───────────────────────────────────────────────────────────────────────────
  // Step 1 — Setup
  // ───────────────────────────────────────────────────────────────────────────
  console.log(title.bold('  Step 1/4 — Setup\n'));

  // 1a. LLM provider
  let config = loadConfig();
  if (!config) {
    console.log(chalk.dim('  No LLM provider configured yet.\n'));
    await runInteractiveProviderSetup({
      selectMessage: 'How do you want to use Caliber? (choose LLM provider)',
    });
    config = loadConfig();
    if (!config) {
      console.log(chalk.red('  Setup was cancelled or failed.\n'));
      throw new Error('__exit__');
    }
    console.log(chalk.green('  ✓ Provider saved\n'));
  }
  trackInitProviderSelected(config.provider, config.model);
  const displayModel = getDisplayModel(config);
  const fastModel = getFastModel();
  const modelLine = fastModel
    ? `  Provider: ${config.provider} | Model: ${displayModel} | Scan: ${fastModel}`
    : `  Provider: ${config.provider} | Model: ${displayModel}`;
  console.log(chalk.dim(modelLine + '\n'));

  if (report) {
    report.markStep('Provider setup');
    report.addSection('LLM Provider', `- **Provider**: ${config.provider}\n- **Model**: ${displayModel}\n- **Fast model**: ${fastModel || 'none'}`);
  }

  await validateModel({ fast: true });

  // 1b. Pick target agents
  let targetAgent: TargetAgent;
  if (options.agent) {
    targetAgent = options.agent;
  } else if (options.autoApprove) {
    targetAgent = ['claude'];
    log(options.verbose, 'Auto-approve: defaulting to claude agent');
  } else {
    targetAgent = await promptAgent();
  }
  console.log(chalk.dim(`  Target: ${targetAgent.join(', ')}\n`));
  trackInitAgentSelected(targetAgent);

  // 1c. Community skills question
  let wantsSkills = false;
  if (!options.autoApprove) {
    wantsSkills = await select({
      message: 'Discover community-maintained skills that match your stack?',
      choices: [
        { name: 'Yes, find skills for my project', value: true },
        { name: 'Skip for now', value: false },
      ],
    });
  }

  // 1d. Compute & show initial score
  let baselineScore = computeLocalScore(process.cwd(), targetAgent);
  console.log(chalk.dim('\n  Current setup score:'));
  displayScoreSummary(baselineScore);
  if (options.verbose) {
    for (const c of baselineScore.checks) {
      log(options.verbose, `  ${c.passed ? '✓' : '✗'} ${c.name}: ${c.earnedPoints}/${c.maxPoints}${c.suggestion ? ` — ${c.suggestion}` : ''}`);
    }
  }

  if (report) {
    report.markStep('Baseline scoring');
    report.addSection('Scoring: Baseline', `**Score**: ${baselineScore.score}/100\n\n| Check | Passed | Points | Max |\n|-------|--------|--------|-----|\n` +
      baselineScore.checks.map(c => `| ${c.name} | ${c.passed ? 'Yes' : 'No'} | ${c.earnedPoints} | ${c.maxPoints} |`).join('\n'));
    report.addSection('Generation: Target Agents', targetAgent.join(', '));
  }

  const hasExistingConfig = !!(
    baselineScore.checks.some(c => c.id === 'claude_md_exists' && c.passed) ||
    baselineScore.checks.some(c => c.id === 'cursorrules_exists' && c.passed)
  );

  const NON_LLM_CHECKS = new Set([
    'hooks_configured',
    'agents_md_exists',
    'permissions_configured',
    'mcp_servers',
    'service_coverage',
    'mcp_completeness',
  ]);

  const passingCount = baselineScore.checks.filter(c => c.passed).length;
  const failingCount = baselineScore.checks.filter(c => !c.passed).length;

  // Score gating
  if (hasExistingConfig && baselineScore.score === 100) {
    trackInitScoreComputed(baselineScore.score, passingCount, failingCount, true);
    console.log(chalk.bold.green('  Your setup is already optimal — nothing to change.\n'));
    console.log(chalk.dim('  Run ') + chalk.hex('#83D1EB')('caliber init --force') + chalk.dim(' to regenerate anyway.\n'));
    if (!options.force) return;
  }

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

  // ───────────────────────────────────────────────────────────────────────────
  // Step 2 — Parallel Engine
  // ───────────────────────────────────────────────────────────────────────────
  console.log(title.bold('  Step 2/4 — Engine\n'));

  const genModelInfo = fastModel
    ? `  Using ${displayModel} for docs, ${fastModel} for skills`
    : `  Using ${displayModel}`;
  console.log(chalk.dim(genModelInfo + '\n'));

  if (report) report.markStep('Generation');

  trackInitGenerationStarted(false);
  const genStartTime = Date.now();

  let generatedSetup: Record<string, unknown> | null = null;
  let rawOutput: string | undefined;
  let genStopReason: string | undefined;
  let skillSearchResult: SkillSearchResult = { results: [], contentMap: new Map() };
  let fingerprint!: Fingerprint;

  const display = new ParallelTaskDisplay();
  const TASK_STACK = display.add('Detecting project stack');
  const TASK_CONFIG = display.add('Generating configs');
  const TASK_SKILLS_GEN = display.add('Generating skills', { depth: 1 });
  const TASK_SKILLS_SEARCH = wantsSkills ? display.add('Searching community skills') : -1;
  const TASK_SCORE_REFINE = display.add('Validating & refining setup');
  display.start();
  display.enableWaitingContent();

  try {
    // Phase A: Fingerprint
    display.update(TASK_STACK, 'running');
    fingerprint = await collectFingerprint(process.cwd());

    const stackSummary = [
      ...fingerprint.languages,
      ...fingerprint.frameworks,
    ].join(', ') || 'no languages';
    display.update(TASK_STACK, 'done', stackSummary);

    trackInitProjectDiscovered(fingerprint.languages.length, fingerprint.frameworks.length, fingerprint.fileTree.length);
    log(options.verbose, `Fingerprint: ${fingerprint.languages.length} languages, ${fingerprint.frameworks.length} frameworks, ${fingerprint.fileTree.length} files`);

    if (report) {
      report.addJson('Fingerprint: Git', { remote: fingerprint.gitRemoteUrl, packageName: fingerprint.packageName });
      report.addCodeBlock('Fingerprint: File Tree', fingerprint.fileTree.join('\n'));
      report.addJson('Fingerprint: Detected Stack', { languages: fingerprint.languages, frameworks: fingerprint.frameworks, tools: fingerprint.tools });
      report.addJson('Fingerprint: Existing Configs', fingerprint.existingConfigs);
      if (fingerprint.codeAnalysis) report.addJson('Fingerprint: Code Analysis', fingerprint.codeAnalysis);
    }

    // Get project description if empty
    const isEmpty = fingerprint.fileTree.length < 3;
    if (isEmpty) {
      display.stop();
      fingerprint.description = await promptInput('What will you build in this project?');
      display.start();
    }

    // Phase B: Generate (with dismissals) + search in parallel
    // Search is independent of dismissals so it starts immediately.
    // Dismissals fold into the "Generating configs" spinner as status text.
    display.update(TASK_CONFIG, 'running');

    const generatePromise = (async () => {
      // Evaluate dismissals (shown as config status, non-fatal)
      const failingForDismissal = baselineScore.checks.filter(c => !c.passed && c.maxPoints > 0);
      if (failingForDismissal.length > 0) {
        display.update(TASK_CONFIG, 'running', 'Evaluating baseline checks...');
        try {
          const newDismissals = await evaluateDismissals(failingForDismissal, fingerprint);
          if (newDismissals.length > 0) {
            const existing = readDismissedChecks();
            const existingIds = new Set(existing.map(d => d.id));
            const merged = [...existing, ...newDismissals.filter(d => !existingIds.has(d.id))];
            writeDismissedChecks(merged);
            baselineScore = computeLocalScore(process.cwd(), targetAgent);
          }
        } catch {
          display.update(TASK_CONFIG, 'running', 'Skipped dismissal evaluation');
        }
      }

      // Determine targeted fix mode
      let failingChecks: FailingCheck[] | undefined;
      let passingChecks: PassingCheck[] | undefined;
      let currentScore: number | undefined;

      if (hasExistingConfig && baselineScore.score >= 95 && !options.force) {
        const currentLlmFixable = baselineScore.checks
          .filter(c => !c.passed && c.maxPoints > 0 && !NON_LLM_CHECKS.has(c.id));
        failingChecks = currentLlmFixable
          .map(c => ({ name: c.name, suggestion: c.suggestion, fix: c.fix }));
        passingChecks = baselineScore.checks
          .filter(c => c.passed)
          .map(c => ({ name: c.name }));
        currentScore = baselineScore.score;
      }

      if (report) {
        const fullPrompt = buildGeneratePrompt(fingerprint, targetAgent, fingerprint.description, failingChecks, currentScore, passingChecks);
        report.addCodeBlock('Generation: Full LLM Prompt', fullPrompt);
      }

      const result = await generateSetup(
        fingerprint,
        targetAgent,
        fingerprint.description,
        {
          onStatus: (status) => display.update(TASK_CONFIG, 'running', status),
          onComplete: (setup) => { generatedSetup = setup; },
          onError: (error) => display.update(TASK_CONFIG, 'failed', error),
        },
        failingChecks,
        currentScore,
        passingChecks,
        { skipSkills: true },
      );

      if (!generatedSetup) generatedSetup = result.setup;
      rawOutput = result.raw;
      genStopReason = result.stopReason;

      if (!generatedSetup) {
        display.update(TASK_CONFIG, 'failed', 'Could not parse LLM response');
        display.update(TASK_SKILLS_GEN, 'failed', 'Skipped');
        return;
      }

      display.update(TASK_CONFIG, 'done');

      display.update(TASK_SKILLS_GEN, 'running');
      const skillCount = await generateSkillsForSetup(
        generatedSetup,
        fingerprint,
        targetAgent,
        (status) => display.update(TASK_SKILLS_GEN, 'running', status),
      );
      display.update(TASK_SKILLS_GEN, 'done', `${skillCount} skills`);
    })();

    const SEARCH_TIMEOUT_MS = 120_000;
    const searchPromise = wantsSkills ? (async () => {
      display.update(TASK_SKILLS_SEARCH, 'running');
      try {
        const searchWithTimeout = Promise.race([
          searchSkills(
            fingerprint,
            targetAgent,
            (status) => display.update(TASK_SKILLS_SEARCH, 'running', status),
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), SEARCH_TIMEOUT_MS)
          ),
        ]);
        skillSearchResult = await searchWithTimeout;
        const count = skillSearchResult.results.length;
        display.update(TASK_SKILLS_SEARCH, 'done', count > 0 ? `${count} found` : 'No matches');
      } catch (err) {
        const reason = err instanceof Error && err.message === 'timeout' ? 'Timed out' : 'Search failed';
        display.update(TASK_SKILLS_SEARCH, 'failed', reason);
      }
    })() : Promise.resolve();

    await Promise.all([generatePromise, searchPromise]);

    // Phase D: Score-based auto-refinement
    if (generatedSetup) {
      display.update(TASK_SCORE_REFINE, 'running');
      const sessionHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      sessionHistory.push({
        role: 'assistant',
        content: summarizeSetup('Initial generation', generatedSetup),
      });
      try {
        const refined = await scoreAndRefine(generatedSetup, process.cwd(), sessionHistory, {
          onStatus: (msg) => display.update(TASK_SCORE_REFINE, 'running', msg),
        });
        if (refined !== generatedSetup) {
          display.update(TASK_SCORE_REFINE, 'done', 'Refined');
          generatedSetup = refined;
        } else {
          display.update(TASK_SCORE_REFINE, 'done', 'Passed');
        }
      } catch {
        display.update(TASK_SCORE_REFINE, 'done', 'Skipped');
      }
    } else {
      display.update(TASK_SCORE_REFINE, 'failed', 'No setup to validate');
    }

  } catch (err) {
    display.stop();
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.log(chalk.red(`\n  Engine failed: ${msg}\n`));
    writeErrorLog(config, undefined, msg, 'exception');
    throw new Error('__exit__');
  }

  display.stop();

  const elapsedMs = Date.now() - genStartTime;
  trackInitGenerationCompleted(elapsedMs, 0);
  const mins = Math.floor(elapsedMs / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  console.log(chalk.dim(`\n  Done in ${timeStr}\n`));

  if (!generatedSetup) {
    console.log(chalk.red('  Failed to generate setup.'));
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

  log(options.verbose, `Generation completed: ${elapsedMs}ms, stopReason: ${genStopReason || 'end_turn'}`);

  const sessionHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  sessionHistory.push({
    role: 'assistant',
    content: summarizeSetup('Initial generation', generatedSetup),
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Step 3 — Review
  // ───────────────────────────────────────────────────────────────────────────
  console.log(title.bold('  Step 3/4 — Review\n'));

  const setupFiles = collectSetupFiles(generatedSetup, targetAgent);
  const staged = stageFiles(setupFiles, process.cwd());

  const totalChanges = staged.newFiles + staged.modifiedFiles;
  console.log(chalk.dim(`  ${chalk.green(`${staged.newFiles} new`)} / ${chalk.yellow(`${staged.modifiedFiles} modified`)} file${totalChanges !== 1 ? 's' : ''}`));

  if (skillSearchResult.results.length > 0) {
    console.log(chalk.dim(`  ${chalk.cyan(`${skillSearchResult.results.length}`)} community skills available to install\n`));
  } else {
    console.log('');
  }

  const hasSkillResults = skillSearchResult.results.length > 0;
  let action: 'accept' | 'refine' | 'decline';

  if (totalChanges === 0 && !hasSkillResults) {
    console.log(chalk.dim('  No changes needed — your configs are already up to date.\n'));
    cleanupStaging();
    action = 'accept';
  } else if (options.autoApprove) {
    log(options.verbose, 'Auto-approve: accepting changes without review');
    action = 'accept';
    trackInitReviewAction(action, 'auto-approved');
  } else {
    if (totalChanges > 0) {
      const reviewChoice = await select({
        message: 'Review your tailored setup?',
        choices: [
          { name: 'Yes, show me the diffs', value: 'review' as const },
          ...(hasSkillResults ? [{ name: `No, continue to community skills (${skillSearchResult.results.length} found)`, value: 'skip' as const }] : []),
          { name: 'No, continue', value: 'skip' as const },
        ],
      });
      if (reviewChoice === 'review') {
        const reviewMethod = await promptReviewMethod();
        await openReview(reviewMethod, staged.stagedFiles);
      }
    }

    action = await promptReviewAction(hasSkillResults);
    trackInitReviewAction(action, totalChanges > 0 ? 'reviewed' : 'skipped');
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
    const updatedFiles = collectSetupFiles(generatedSetup, targetAgent);
    const restaged = stageFiles(updatedFiles, process.cwd());
    console.log(chalk.dim(`  ${chalk.green(`${restaged.newFiles} new`)} / ${chalk.yellow(`${restaged.modifiedFiles} modified`)} file${restaged.newFiles + restaged.modifiedFiles !== 1 ? 's' : ''}\n`));
    printSetupSummary(generatedSetup);
    await openReview('terminal', restaged.stagedFiles);
    action = await promptReviewAction(hasSkillResults);
    trackInitReviewAction(action, 'terminal');
  }

  cleanupStaging();

  if (action === 'decline') {
    console.log(chalk.dim('Setup declined. No files were modified.'));
    return;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Step 4 — Finalize
  // ───────────────────────────────────────────────────────────────────────────
  console.log(title.bold('\n  Step 4/4 — Finalize\n'));

  // Write files
  if (options.dryRun) {
    console.log(chalk.yellow('\n[Dry run] Would write the following files:'));
    console.log(JSON.stringify(generatedSetup, null, 2));
    return;
  }

  const writeSpinner = ora('Writing config files...').start();
  try {
    if (targetAgent.includes('codex') && !fs.existsSync('AGENTS.md') && !generatedSetup.codex) {
      const claude = generatedSetup.claude as Record<string, unknown> | undefined;
      const cursor = generatedSetup.cursor as Record<string, unknown> | undefined;
      const agentRefs: string[] = [];
      if (claude) agentRefs.push('See `CLAUDE.md` for Claude Code configuration.');
      if (cursor) agentRefs.push('See `.cursor/rules/` for Cursor rules.');
      if (agentRefs.length === 0) agentRefs.push('See CLAUDE.md and .cursor/rules/ for agent configurations.');
      const stubContent = `# AGENTS.md\n\nThis project uses AI coding agents configured by [Caliber](https://github.com/rely-ai-org/caliber).\n\n${agentRefs.join(' ')}\n`;
      (generatedSetup as Record<string, unknown>).codex = { agentsMd: stubContent };
    }

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

  if (fingerprint) ensurePermissions(fingerprint);

  const sha = getCurrentHeadSha();
  writeState({
    lastRefreshSha: sha ?? '',
    lastRefreshTimestamp: new Date().toISOString(),
    targetAgent,
  });

  // Score regression check
  const afterScore = computeLocalScore(process.cwd(), targetAgent);

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
  if (options.verbose) {
    log(options.verbose, `Final score: ${afterScore.score}/100`);
    for (const c of afterScore.checks.filter(ch => !ch.passed)) {
      log(options.verbose, `  Still failing: ${c.name} (${c.earnedPoints}/${c.maxPoints})${c.suggestion ? ` — ${c.suggestion}` : ''}`);
    }
  }

  // Community skills selection (after score check passes)
  let communitySkillsInstalled = 0;
  if (skillSearchResult.results.length > 0 && !options.autoApprove) {
    console.log(chalk.dim('  Community skills matched to your project:\n'));
    const selected = await selectSkills(skillSearchResult.results);
    if (selected?.length) {
      await installSkills(selected, targetAgent, skillSearchResult.contentMap);
      trackInitSkillsSearch(true, selected.length);
      communitySkillsInstalled = selected.length;
    }
  }

  // Auto-sync hooks
  console.log('');
  let hookChoice: HookChoice;
  if (options.autoApprove) {
    hookChoice = 'skip';
    log(options.verbose, 'Auto-approve: skipping hook installation');
  } else {
    hookChoice = await promptHookType(targetAgent);
  }
  trackInitHookSelected(hookChoice);

  if (hookChoice === 'claude' || hookChoice === 'both') {
    const hookResult = installHook();
    if (hookResult.installed) {
      console.log(`  ${chalk.green('✓')} Claude Code hook installed — docs update on session end`);
      console.log(chalk.dim('    Run ') + chalk.hex('#83D1EB')('caliber hooks --remove') + chalk.dim(' to disable'));
    } else if (hookResult.alreadyInstalled) {
      console.log(chalk.dim('  Claude Code hook already installed'));
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
    console.log(chalk.dim('  Skipped auto-sync hooks. Run ') + chalk.hex('#83D1EB')('caliber hooks --install') + chalk.dim(' later to enable.'));
  }

  // Session Learning prompt (only for agents that support it)
  const hasLearnableAgent = targetAgent.includes('claude') || targetAgent.includes('cursor');
  let enableLearn = false;
  if (hasLearnableAgent) {
    if (!options.autoApprove) {
      enableLearn = await promptLearnInstall(targetAgent);
      trackInitLearnEnabled(enableLearn);
      if (enableLearn) {
        if (targetAgent.includes('claude')) {
          const r = installLearningHooks();
          if (r.installed) console.log(`  ${chalk.green('✓')} Learning hooks installed for Claude Code`);
          else if (r.alreadyInstalled) console.log(chalk.dim('  Claude Code learning hooks already installed'));
        }
        if (targetAgent.includes('cursor')) {
          const r = installCursorLearningHooks();
          if (r.installed) console.log(`  ${chalk.green('✓')} Learning hooks installed for Cursor`);
          else if (r.alreadyInstalled) console.log(chalk.dim('  Cursor learning hooks already installed'));
        }
        console.log(chalk.dim('    Run ') + chalk.hex('#83D1EB')('caliber learn status') + chalk.dim(' to see insights'));
      } else {
        console.log(chalk.dim('  Skipped. Run ') + chalk.hex('#83D1EB')('caliber learn install') + chalk.dim(' later to enable.'));
      }
    } else {
      enableLearn = true;
      if (targetAgent.includes('claude')) installLearningHooks();
      if (targetAgent.includes('cursor')) installCursorLearningHooks();
    }
  }

  // Done!
  console.log(chalk.bold.green('\n  Setup complete!'));
  console.log(chalk.dim('  Your AI agents now understand your project\'s architecture, build commands,'));
  console.log(chalk.dim('  testing patterns, and conventions. All changes are backed up automatically.\n'));

  const done = chalk.green('✓');
  const skip = chalk.dim('–');

  console.log(chalk.bold('  What was set up:\n'));

  // Score
  console.log(`    ${done}  Config generated          ${title('caliber score')} ${chalk.dim('for full breakdown')}`);

  // Hooks
  const hooksInstalled = hookChoice !== 'skip';
  if (hooksInstalled) {
    const hookLabel = hookChoice === 'both' ? 'pre-commit + Claude Code' : hookChoice === 'precommit' ? 'pre-commit' : 'Claude Code';
    console.log(`    ${done}  Auto-sync hooks           ${chalk.dim(hookLabel + ' — docs stay fresh automatically')}`);
  } else {
    console.log(`    ${skip}  Auto-sync hooks           ${title('caliber hooks --install')} to enable later`);
  }

  // Learning
  if (hasLearnableAgent) {
    if (enableLearn) {
      console.log(`    ${done}  Session learning          ${chalk.dim('agent learns from your feedback')}`);
    } else {
      console.log(`    ${skip}  Session learning          ${title('caliber learn install')} to enable later`);
    }
  }

  // Community skills
  if (communitySkillsInstalled > 0) {
    console.log(`    ${done}  Community skills          ${chalk.dim(`${communitySkillsInstalled} skill${communitySkillsInstalled > 1 ? 's' : ''} installed for your stack`)}`);
  } else if (skillSearchResult.results.length > 0) {
    console.log(`    ${skip}  Community skills          ${chalk.dim('available but skipped')}`);
  }

  console.log(chalk.bold('\n  Explore next:\n'));
  console.log(`    ${title('caliber skills')}       Find more community skills as your codebase evolves`);
  console.log(`    ${title('caliber score')}        See the full scoring breakdown with improvement tips`);
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
    return true;
  }
}

async function evaluateDismissals(
  failingChecks: readonly Check[],
  fingerprint: { languages: string[]; frameworks: string[]; fileTree: string[]; tools: string[] },
): Promise<DismissedCheck[]> {
  if (failingChecks.length === 0) return [];
  const fastModel = getFastModel();
  const checkList = failingChecks.map(c => ({
    id: c.id,
    name: c.name,
    suggestion: c.suggestion,
  }));

  const hasBuildFiles = fingerprint.fileTree.some(f =>
    /^(package\.json|Makefile|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|build\.gradle|pom\.xml)$/i.test(f.split('/').pop() || '')
  );
  const topFiles = fingerprint.fileTree.slice(0, 30).join(', ');

  try {
    const result = await llmJsonCall<{ dismissed: Array<{ id: string; reason: string }> }>({
      system: `You evaluate whether scoring checks are applicable to a project.
Given the project context and a list of failing checks, return which checks are NOT applicable.

Only dismiss checks that truly don't apply. Examples:
- "Build/test/lint commands" for a GitOps/Helm/Terraform/config repo with no build system
- "Build/test/lint commands" for a repo with only YAML, HCL, or config files and no package.json/Makefile
- "Dependency coverage" for a repo with no package manager

Do NOT dismiss checks that could reasonably apply even if the project doesn't use them yet.

Return {"dismissed": [{"id": "check_id", "reason": "brief reason"}]} or {"dismissed": []} if all apply.`,
      prompt: `Languages: ${fingerprint.languages.join(', ') || 'none'}
Frameworks: ${fingerprint.frameworks.join(', ') || 'none'}
Tools: ${fingerprint.tools.join(', ') || 'none'}
Has build files (package.json, Makefile, etc.): ${hasBuildFiles ? 'yes' : 'no'}
Top files: ${topFiles}

Failing checks:
${JSON.stringify(checkList, null, 2)}`,
      maxTokens: 300,
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

  choices.push({ name: 'Git pre-commit hook — refresh before each commit (recommended)', value: 'precommit' });
  if (hasClaude) {
    choices.push({ name: 'Claude Code hook — auto-refresh on session end', value: 'claude' });
    choices.push({ name: 'Both (pre-commit + Claude Code)', value: 'both' });
  }
  choices.push({ name: 'Skip for now', value: 'skip' });

  return select({
    message: 'Keep your AI docs & skills in sync as your code evolves?',
    choices,
  });
}

async function promptLearnInstall(targetAgent: TargetAgent): Promise<boolean> {
  const hasClaude = targetAgent.includes('claude');
  const hasCursor = targetAgent.includes('cursor');
  const agentName = hasClaude && hasCursor ? 'Claude and Cursor'
    : hasClaude ? 'Claude' : 'Cursor';

  console.log(chalk.bold(`\n  Session Learning\n`));
  console.log(chalk.dim(`  Caliber can learn from your ${agentName} sessions — when a tool fails`));
  console.log(chalk.dim(`  or you correct a mistake, it captures the lesson so it won't`));
  console.log(chalk.dim(`  happen again. Runs once at session end using the fast model.\n`));

  return select({
    message: 'Enable session learning?',
    choices: [
      { name: 'Enable session learning (recommended)', value: true },
      { name: 'Skip for now', value: false },
    ],
  });
}

async function promptReviewAction(hasSkillResults = false): Promise<'accept' | 'refine' | 'decline'> {
  const acceptLabel = hasSkillResults
    ? 'Accept and continue to community skills'
    : 'Accept and apply';

  return select({
    message: 'What would you like to do?',
    choices: [
      { name: acceptLabel, value: 'accept' as const },
      { name: 'Refine via chat', value: 'refine' as const },
      { name: 'Decline all changes', value: 'decline' as const },
    ],
  });
}

function printSetupSummary(setup: Record<string, unknown>) {
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

function derivePermissions(fingerprint: { languages: string[]; tools: string[]; fileTree: string[] }): string[] {
  const perms: string[] = ['Bash(git *)'];
  const langs = new Set(fingerprint.languages.map(l => l.toLowerCase()));
  const tools = new Set(fingerprint.tools.map(t => t.toLowerCase()));
  const hasFile = (name: string) => fingerprint.fileTree.some(f => f === name || f === `./${name}`);

  if (langs.has('typescript') || langs.has('javascript') || hasFile('package.json')) {
    perms.push('Bash(npm run *)', 'Bash(npx *)');
  }
  if (langs.has('python') || hasFile('pyproject.toml') || hasFile('requirements.txt')) {
    perms.push('Bash(python *)', 'Bash(pip *)', 'Bash(pytest *)');
  }
  if (langs.has('go') || hasFile('go.mod')) {
    perms.push('Bash(go *)');
  }
  if (langs.has('rust') || hasFile('Cargo.toml')) {
    perms.push('Bash(cargo *)');
  }
  if (langs.has('java') || langs.has('kotlin')) {
    if (hasFile('gradlew')) perms.push('Bash(./gradlew *)');
    if (hasFile('mvnw')) perms.push('Bash(./mvnw *)');
    if (hasFile('pom.xml')) perms.push('Bash(mvn *)');
    if (hasFile('build.gradle') || hasFile('build.gradle.kts')) perms.push('Bash(gradle *)');
  }
  if (langs.has('ruby') || hasFile('Gemfile')) {
    perms.push('Bash(bundle *)', 'Bash(rake *)');
  }
  if (tools.has('terraform') || hasFile('main.tf')) {
    perms.push('Bash(terraform *)');
  }
  if (tools.has('docker') || hasFile('Dockerfile') || hasFile('docker-compose.yml')) {
    perms.push('Bash(docker *)');
  }
  if (hasFile('Makefile')) {
    perms.push('Bash(make *)');
  }

  return [...new Set(perms)];
}

function ensurePermissions(fingerprint: { languages: string[]; tools: string[]; fileTree: string[] }): void {
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

  permissions.allow = derivePermissions(fingerprint);
  settings.permissions = permissions;

  if (!fs.existsSync('.claude')) fs.mkdirSync('.claude', { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

function displayTokenUsage(): void {
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

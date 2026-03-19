import path from 'path';
import chalk from 'chalk';
import fs from 'fs';
import { collectFingerprint, type Fingerprint } from '../fingerprint/index.js';
import { resolveAllSources } from '../fingerprint/sources.js';
import { getDetectedWorkspaces } from '../fingerprint/cache.js';
import { generateSetup, generateSkillsForSetup } from '../ai/generate.js';
import { writeSetup, undoSetup } from '../writers/index.js';
import { stageFiles, cleanupStaging } from '../writers/staging.js';
import { collectSetupFiles } from './setup-files.js';
import { installHook, installPreCommitHook } from '../lib/hooks.js';
import { installLearningHooks, installCursorLearningHooks } from '../lib/learning-hooks.js';
import { writeState, getCurrentHeadSha } from '../lib/state.js';
import { promptInput } from '../utils/prompt.js';
import { loadConfig, getFastModel, getDisplayModel } from '../llm/config.js';
import { validateModel } from '../llm/index.js';
import { runInteractiveProviderSetup } from './interactive-provider-setup.js';
import { computeLocalScore } from '../scoring/index.js';
import { displayScoreSummary, displayScoreDelta } from '../scoring/display.js';
import { readDismissedChecks, writeDismissedChecks } from '../scoring/dismissed.js';
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

import { detectAgents, promptAgent, promptHookType, promptLearnInstall, promptReviewAction, refineLoop } from './init-prompts.js';
import type { TargetAgent, HookChoice } from './init-prompts.js';
import { formatProjectPreview, formatWhatChanged, printSetupSummary, displayTokenUsage } from './init-display.js';
import { isFirstRun, summarizeSetup, ensurePermissions, writeErrorLog, evaluateDismissals } from './init-helpers.js';

export type { TargetAgent };

interface InitOptions {
  agent?: TargetAgent;
  source?: string[];
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
  const firstRun = isFirstRun(process.cwd());

  if (firstRun) {
    console.log(brand.bold(`
   ██████╗ █████╗ ██╗     ██╗██████╗ ███████╗██████╗
  ██╔════╝██╔══██╗██║     ██║██╔══██╗██╔════╝██╔══██╗
  ██║     ███████║██║     ██║██████╔╝█████╗  ██████╔╝
  ██║     ██╔══██║██║     ██║██╔══██╗██╔══╝  ██╔══██╗
  ╚██████╗██║  ██║███████╗██║██████╔╝███████╗██║  ██║
   ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝
  `));
    console.log(chalk.dim('  Scan your project and generate tailored config files for'));
    console.log(chalk.dim('  Claude Code, Cursor, Codex, and GitHub Copilot.\n'));

    console.log(title.bold('  How it works:\n'));
    console.log(chalk.dim('  1. Setup      Connect your LLM provider and select your agents'));
    console.log(chalk.dim('  2. Engine     Detect stack, generate configs & skills in parallel'));
    console.log(chalk.dim('  3. Review     See all changes — accept, refine, or decline'));
    console.log(chalk.dim('  4. Finalize   Score check and auto-sync hooks\n'));
  } else {
    console.log(brand.bold('\n  CALIBER') + chalk.dim('  — regenerating config\n'));
  }

  const report = options.debugReport ? new DebugReport() : null;

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
  trackInitProviderSelected(config.provider, config.model, firstRun);
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

  // 1b. Pick target agents (auto-detect from existing dirs)
  let targetAgent: TargetAgent;
  const agentAutoDetected = !options.agent;
  if (options.agent) {
    targetAgent = options.agent;
  } else if (options.autoApprove) {
    targetAgent = ['claude'];
    log(options.verbose, 'Auto-approve: defaulting to claude agent');
  } else {
    const detected = detectAgents(process.cwd());
    targetAgent = await promptAgent(detected.length > 0 ? detected : undefined);
  }
  console.log(chalk.dim(`  Target: ${targetAgent.join(', ')}\n`));
  trackInitAgentSelected(targetAgent, agentAutoDetected);

  // 1c. Compute & show initial score
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
  const sessionHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const display = new ParallelTaskDisplay();
  const TASK_STACK = display.add('Detecting project stack', { pipelineLabel: 'Scan' });
  const TASK_CONFIG = display.add('Generating configs', { depth: 1, pipelineLabel: 'Generate' });
  const TASK_SKILLS_GEN = display.add('Generating skills', { depth: 2, pipelineLabel: 'Skills' });
  const TASK_SKILLS_SEARCH = display.add('Searching community skills', { depth: 1, pipelineLabel: 'Search', pipelineRow: 1 });
  const TASK_SCORE_REFINE = display.add('Validating & refining setup', { pipelineLabel: 'Validate' });
  display.start();
  display.enableWaitingContent();

  try {
    // Phase A: Fingerprint
    display.update(TASK_STACK, 'running');
    fingerprint = await collectFingerprint(process.cwd());

    const stackParts = [...fingerprint.languages, ...fingerprint.frameworks];
    const stackSummary = stackParts.join(', ') || 'no languages';
    const largeRepoNote = fingerprint.fileTree.length > 5000
      ? ` (${fingerprint.fileTree.length.toLocaleString()} files, smart sampling active)`
      : '';
    display.update(TASK_STACK, 'done', stackSummary + largeRepoNote);

    trackInitProjectDiscovered(fingerprint.languages.length, fingerprint.frameworks.length, fingerprint.fileTree.length);
    log(options.verbose, `Fingerprint: ${fingerprint.languages.length} languages, ${fingerprint.frameworks.length} frameworks, ${fingerprint.fileTree.length} files`);

    // Resolve external sources
    const cliSources = options.source || [];
    const workspaces = getDetectedWorkspaces(process.cwd());
    const sources = resolveAllSources(process.cwd(), cliSources, workspaces);
    if (sources.length > 0) {
      fingerprint.sources = sources;
      log(options.verbose, `Sources: ${sources.length} resolved (${sources.map(s => s.name).join(', ')})`);
    }

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

    // Phase B: Generate + search in parallel (search always runs)
    display.update(TASK_CONFIG, 'running');

    const generatePromise = (async () => {
      let localBaseline = baselineScore;
      const failingForDismissal = localBaseline.checks.filter(c => !c.passed && c.maxPoints > 0);
      if (failingForDismissal.length > 0) {
        display.update(TASK_CONFIG, 'running', 'Evaluating baseline checks...');
        try {
          const newDismissals = await evaluateDismissals(failingForDismissal, fingerprint);
          if (newDismissals.length > 0) {
            const existing = readDismissedChecks();
            const existingIds = new Set(existing.map(d => d.id));
            const merged = [...existing, ...newDismissals.filter(d => !existingIds.has(d.id))];
            writeDismissedChecks(merged);
            localBaseline = computeLocalScore(process.cwd(), targetAgent);
          }
        } catch {
          display.update(TASK_CONFIG, 'running', 'Skipped dismissal evaluation');
        }
      }

      let failingChecks: FailingCheck[] | undefined;
      let passingChecks: PassingCheck[] | undefined;
      let currentScore: number | undefined;

      if (hasExistingConfig && localBaseline.score >= 95 && !options.force) {
        const currentLlmFixable = localBaseline.checks
          .filter(c => !c.passed && c.maxPoints > 0 && !NON_LLM_CHECKS.has(c.id));
        failingChecks = currentLlmFixable
          .map(c => ({ name: c.name, suggestion: c.suggestion, fix: c.fix }));
        passingChecks = localBaseline.checks
          .filter(c => c.passed)
          .map(c => ({ name: c.name }));
        currentScore = localBaseline.score;
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
          onContent: (text) => {
            const lines = text.split('\n').filter(l => l.trim()).slice(-8);
            if (lines.length > 0) {
              display.setPreviewContent(lines.map(l => `  ${chalk.dim(l.slice(0, 80))}`));
            }
          },
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

    // Community skills search always runs in parallel (deferred — no upfront prompt)
    const SEARCH_TIMEOUT_MS = 120_000;
    const searchPromise = (async () => {
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
    })();

    await Promise.all([generatePromise, searchPromise]);

    // Phase D: Score-based auto-refinement
    if (generatedSetup) {
      display.update(TASK_SCORE_REFINE, 'running');
      display.setPreviewContent([]);
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

  // ───────────────────────────────────────────────────────────────────────────
  // Step 3 — Review
  // ───────────────────────────────────────────────────────────────────────────
  console.log(title.bold('  Step 3/4 — Review\n'));

  const setupFiles = collectSetupFiles(generatedSetup, targetAgent);
  const staged = stageFiles(setupFiles, process.cwd());

  const totalChanges = staged.newFiles + staged.modifiedFiles;

  // "What changed" summary
  const changes = formatWhatChanged(generatedSetup);
  if (changes.length > 0) {
    for (const line of changes) {
      console.log(`  ${chalk.dim('•')} ${line}`);
    }
    console.log('');
  }

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
    // Single consolidated review prompt
    printSetupSummary(generatedSetup);
    action = await promptReviewAction(hasSkillResults, totalChanges > 0, staged);
    trackInitReviewAction(action, totalChanges > 0 ? 'reviewed' : 'skipped');
  }

  let refinementRound = 0;
  while (action === 'refine') {
    refinementRound++;
    generatedSetup = await refineLoop(
      generatedSetup,
      sessionHistory,
      summarizeSetup,
      printSetupSummary,
    );
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

    const { openReview: openRev } = await import('../utils/review.js');
    await openRev('terminal', restaged.stagedFiles);
    action = await promptReviewAction(hasSkillResults, true, undefined);
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

  const { default: ora } = await import('ora');
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

  // Community skills selection (deferred — offered at end if results were found)
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

  // Auto-sync hooks (smart defaults: auto-install pre-commit on first run)
  console.log('');
  let hookChoice: HookChoice;
  if (options.autoApprove) {
    hookChoice = 'skip';
    log(options.verbose, 'Auto-approve: skipping hook installation');
  } else if (firstRun) {
    // Auto-install pre-commit hook on first run
    const precommitResult = installPreCommitHook();
    if (precommitResult.installed) {
      console.log(`  ${chalk.green('✓')} Pre-commit hook installed — docs refresh before each commit`);
      console.log(chalk.dim('    Run ') + chalk.hex('#83D1EB')('caliber hooks --remove') + chalk.dim(' to disable'));
      hookChoice = 'precommit';
    } else if (precommitResult.alreadyInstalled) {
      console.log(chalk.dim('  Pre-commit hook already installed'));
      hookChoice = 'precommit';
    } else {
      hookChoice = 'skip';
    }

    // Ask about Claude hook only if Claude is a target
    if (targetAgent.includes('claude')) {
      const { default: select } = await import('@inquirer/select');
      const wantsClaude = await select({
        message: 'Also install Claude Code session hook? (auto-refresh on session end)',
        choices: [
          { name: 'Yes', value: true },
          { name: 'No', value: false },
        ],
      });
      if (wantsClaude) {
        const hookResult = installHook();
        if (hookResult.installed) {
          console.log(`  ${chalk.green('✓')} Claude Code hook installed`);
        }
        hookChoice = hookChoice === 'precommit' ? 'both' : 'claude';
      }
    }
  } else {
    hookChoice = await promptHookType(targetAgent);
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
  }
  trackInitHookSelected(hookChoice);

  // Session Learning prompt
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

  console.log(`    ${done}  Config generated          ${title('caliber score')} ${chalk.dim('for full breakdown')}`);

  const hooksInstalled = hookChoice !== 'skip';
  if (hooksInstalled) {
    const hookLabel = hookChoice === 'both' ? 'pre-commit + Claude Code' : hookChoice === 'precommit' ? 'pre-commit' : 'Claude Code';
    console.log(`    ${done}  Auto-sync hooks           ${chalk.dim(hookLabel + ' — docs stay fresh automatically')}`);
  } else {
    console.log(`    ${skip}  Auto-sync hooks           ${title('caliber hooks --install')} to enable later`);
  }

  if (hasLearnableAgent) {
    if (enableLearn) {
      console.log(`    ${done}  Session learning          ${chalk.dim('agent learns from your feedback')}`);
    } else {
      console.log(`    ${skip}  Session learning          ${title('caliber learn install')} to enable later`);
    }
  }

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

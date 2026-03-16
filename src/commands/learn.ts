import fs from 'fs';
import chalk from 'chalk';
import { readStdin } from '../learner/stdin.js';
import {
  appendEvent,
  appendPromptEvent,
  readAllEvents,
  readState,
  writeState,
  clearSession,
  resetState,
  getEventCount,
  acquireFinalizeLock,
  releaseFinalizeLock,
} from '../learner/storage.js';
import type { ToolEvent, PromptEvent } from '../learner/storage.js';
import { writeLearnedContent, readLearnedSection, migrateInlineLearnings } from '../learner/writer.js';
import { sanitizeSecrets } from '../lib/sanitize.js';
import {
  areLearningHooksInstalled,
  installLearningHooks,
  removeLearningHooks,
  areCursorLearningHooksInstalled,
  installCursorLearningHooks,
  removeCursorLearningHooks,
} from '../lib/learning-hooks.js';
import { readExistingConfigs } from '../fingerprint/existing-config.js';
import { analyzeEvents, calculateSessionWaste } from '../ai/learn.js';
import { loadConfig } from '../llm/config.js';
import { validateModel } from '../llm/index.js';
import { recordSession, formatROISummary, readROIStats } from '../learner/roi.js';
import type { LearningCostEntry, SessionROISummary } from '../learner/roi.js';
import {
  trackLearnSessionAnalyzed,
  trackLearnROISnapshot,
  trackLearnNewLearning,
} from '../telemetry/events.js';

/** Minimum tool events required before running LLM analysis. */
const MIN_EVENTS_FOR_ANALYSIS = 25;

export async function learnObserveCommand(options: { failure?: boolean; prompt?: boolean }) {
  try {
    const raw = await readStdin();
    if (!raw.trim()) return;

    const hookData = JSON.parse(raw);
    const sessionId = hookData.session_id || hookData.conversation_id || 'unknown';

    if (options.prompt) {
      const event: PromptEvent = {
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        hook_event_name: 'UserPromptSubmit',
        prompt_content: sanitizeSecrets(String(hookData.prompt_content || hookData.content || hookData.prompt || '')),
        cwd: hookData.cwd || process.cwd(),
      };
      appendPromptEvent(event);

      const state = readState();
      state.eventCount++;
      if (!state.sessionId) state.sessionId = sessionId;
      writeState(state);
      return;
    }

    const event: ToolEvent = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      hook_event_name: options.failure ? 'PostToolUseFailure' : 'PostToolUse',
      tool_name: hookData.tool_name || 'unknown',
      tool_input: hookData.tool_input || {},
      tool_response: hookData.tool_response || hookData.tool_output || {},
      tool_use_id: hookData.tool_use_id || '',
      cwd: hookData.cwd || process.cwd(),
    };

    appendEvent(event);

    const state = readState();
    state.eventCount++;
    if (!state.sessionId) state.sessionId = sessionId;
    writeState(state);
  } catch {
    // Hook observers must never crash or produce output
  }
}

export async function learnFinalizeCommand(options?: { force?: boolean }) {
  if (!options?.force) {
    const { isCaliberRunning } = await import('../lib/lock.js');
    if (isCaliberRunning()) {
      console.log(chalk.dim('caliber: skipping finalize — another caliber process is running'));
      return;
    }
  }

  // Prevent concurrent finalize from parallel sessions
  if (!acquireFinalizeLock()) {
    console.log(chalk.dim('caliber: skipping finalize — another finalize is in progress'));
    return;
  }

  let analyzed = false;
  try {
    const config = loadConfig();
    if (!config) {
      console.log(chalk.yellow('caliber: no LLM provider configured — run `caliber config` first'));
      clearSession();
      resetState();
      return;
    }

    const events = readAllEvents();
    if (events.length < MIN_EVENTS_FOR_ANALYSIS) {
      console.log(chalk.dim(`caliber: ${events.length}/${MIN_EVENTS_FOR_ANALYSIS} events recorded — need more before analysis`));
      return;
    }

    await validateModel({ fast: true });

    migrateInlineLearnings();

    const existingConfigs = readExistingConfigs(process.cwd());
    const existingLearnedSection = readLearnedSection();
    const existingSkills = existingConfigs.claudeSkills || [];

    const response = await analyzeEvents(
      events,
      existingConfigs.claudeMd || '',
      existingLearnedSection,
      existingSkills,
    );

    analyzed = true;

    const waste = calculateSessionWaste(events);
    const existingLearnedItems = existingLearnedSection
      ? existingLearnedSection.split('\n').filter(l => l.startsWith('- ')).length
      : 0;
    const hadLearnings = existingLearnedItems > 0;
    let newLearningsProduced = 0;
    let roiLearningEntries: LearningCostEntry[] = [];

    if (response.claudeMdLearnedSection || response.skills?.length) {
      const result = writeLearnedContent({
        claudeMdLearnedSection: response.claudeMdLearnedSection,
        skills: response.skills,
      });
      newLearningsProduced = result.newItemCount;

      if (result.newItemCount > 0) {
        const wasteLabel = waste.totalWasteTokens > 0
          ? ` (~${waste.totalWasteTokens.toLocaleString()} wasted tokens captured)`
          : '';
        console.log(chalk.dim(`caliber: learned ${result.newItemCount} new pattern${result.newItemCount === 1 ? '' : 's'}${wasteLabel}`));
        for (const item of result.newItems) {
          console.log(chalk.dim(`  + ${item.replace(/^- /, '').slice(0, 80)}`));
        }

        // Record per-learning cost entries
        const wastePerLearning = Math.round(waste.totalWasteTokens / result.newItemCount);
        const TYPE_RE = /^\*\*\[([^\]]+)\]\*\*/;
        const learningEntries: LearningCostEntry[] = result.newItems.map(item => {
          const clean = item.replace(/^- /, '');
          const typeMatch = clean.match(TYPE_RE);
          return {
            timestamp: new Date().toISOString(),
            observationType: typeMatch ? typeMatch[1] : 'unknown',
            summary: clean.replace(TYPE_RE, '').trim().slice(0, 80),
            wasteTokens: wastePerLearning,
            sourceEventCount: events.length,
          };
        });

        for (const entry of learningEntries) {
          trackLearnNewLearning({
            observationType: entry.observationType,
            wasteTokens: entry.wasteTokens,
            sourceEventCount: entry.sourceEventCount,
          });
        }

        roiLearningEntries = learningEntries;
      }
    }

    // Record session ROI summary + learnings in a single write
    const sessionSummary: SessionROISummary = {
      timestamp: new Date().toISOString(),
      sessionId: readState().sessionId || 'unknown',
      eventCount: events.length,
      failureCount: waste.failureCount,
      promptCount: waste.promptCount,
      hadLearningsAvailable: hadLearnings,
      learningsCount: existingLearnedItems,
      newLearningsProduced,
    };
    const roiStats = recordSession(sessionSummary, roiLearningEntries);

    // Emit PostHog events
    trackLearnSessionAnalyzed({
      eventCount: events.length,
      failureCount: waste.failureCount,
      correctionCount: waste.promptCount,
      hadLearningsAvailable: hadLearnings,
      learningsAvailableCount: existingLearnedItems,
      newLearningsProduced,
      wasteTokens: waste.totalWasteTokens,
    });

    const t = roiStats.totals;
    const totalSessions = t.totalSessionsWithLearnings + t.totalSessionsWithoutLearnings;
    trackLearnROISnapshot({
      totalWasteTokens: t.totalWasteTokens,
      totalSessions,
      sessionsWithLearnings: t.totalSessionsWithLearnings,
      sessionsWithoutLearnings: t.totalSessionsWithoutLearnings,
      failureRateWithLearnings: t.totalSessionsWithLearnings > 0
        ? t.totalFailuresWithLearnings / t.totalSessionsWithLearnings
        : 0,
      failureRateWithoutLearnings: t.totalSessionsWithoutLearnings > 0
        ? t.totalFailuresWithoutLearnings / t.totalSessionsWithoutLearnings
        : 0,
      estimatedSavingsTokens: t.estimatedSavingsTokens,
      learningCount: roiStats.learnings.length,
    });

    // Show savings summary if we have history
    if (t.estimatedSavingsTokens > 0) {
      const totalLearnings = existingLearnedItems + newLearningsProduced;
      console.log(chalk.dim(`caliber: ${totalLearnings} learnings active — est. ~${t.estimatedSavingsTokens.toLocaleString()} tokens saved across ${t.totalSessionsWithLearnings} sessions`));
    }
  } catch (err) {
    if (options?.force) {
      console.error(chalk.red('caliber: finalize failed —'), err instanceof Error ? err.message : err);
    }
  } finally {
    if (analyzed) {
      clearSession();
      resetState();
    }
    releaseFinalizeLock();
  }
}

export async function learnInstallCommand() {
  let anyInstalled = false;

  if (fs.existsSync('.claude')) {
    const r = installLearningHooks();
    if (r.installed) {
      console.log(chalk.green('✓') + ' Claude Code learning hooks installed');
      anyInstalled = true;
    } else if (r.alreadyInstalled) {
      console.log(chalk.dim('  Claude Code hooks already installed'));
    }
  }

  if (fs.existsSync('.cursor')) {
    const r = installCursorLearningHooks();
    if (r.installed) {
      console.log(chalk.green('✓') + ' Cursor learning hooks installed');
      anyInstalled = true;
    } else if (r.alreadyInstalled) {
      console.log(chalk.dim('  Cursor hooks already installed'));
    }
  }

  if (!fs.existsSync('.claude') && !fs.existsSync('.cursor')) {
    console.log(chalk.yellow('No .claude/ or .cursor/ directory found.'));
    console.log(chalk.dim('  Run `caliber init` first, or create the directory manually.'));
    return;
  }

  if (anyInstalled) {
    console.log(chalk.dim(`  Tool usage will be recorded and learnings extracted after ≥${MIN_EVENTS_FOR_ANALYSIS} events.`));
    console.log(chalk.dim('  Learnings written to CALIBER_LEARNINGS.md.'));
  }
}

export async function learnRemoveCommand() {
  let anyRemoved = false;

  const r1 = removeLearningHooks();
  if (r1.removed) {
    console.log(chalk.green('✓') + ' Claude Code learning hooks removed');
    anyRemoved = true;
  }

  const r2 = removeCursorLearningHooks();
  if (r2.removed) {
    console.log(chalk.green('✓') + ' Cursor learning hooks removed');
    anyRemoved = true;
  }

  if (!anyRemoved) {
    console.log(chalk.dim('No learning hooks found.'));
  }
}

export async function learnStatusCommand() {
  const claudeInstalled = areLearningHooksInstalled();
  const cursorInstalled = areCursorLearningHooksInstalled();
  const state = readState();
  const eventCount = getEventCount();

  console.log(chalk.bold('Session Learning Status'));
  console.log();

  if (claudeInstalled) {
    console.log(chalk.green('✓') + ' Claude Code hooks ' + chalk.green('installed'));
  } else {
    console.log(chalk.dim('✗') + ' Claude Code hooks ' + chalk.dim('not installed'));
  }

  if (cursorInstalled) {
    console.log(chalk.green('✓') + ' Cursor hooks ' + chalk.green('installed'));
  } else {
    console.log(chalk.dim('✗') + ' Cursor hooks ' + chalk.dim('not installed'));
  }

  if (!claudeInstalled && !cursorInstalled) {
    console.log(chalk.dim('  Run `caliber learn install` to enable session learning.'));
  }

  console.log();
  console.log(`Events recorded: ${chalk.cyan(String(eventCount))}`);
  console.log(`Threshold for analysis: ${chalk.cyan(String(MIN_EVENTS_FOR_ANALYSIS))}`);

  if (state.lastAnalysisTimestamp) {
    console.log(`Last analysis: ${chalk.cyan(state.lastAnalysisTimestamp)}`);
  } else {
    console.log(`Last analysis: ${chalk.dim('none')}`);
  }

  const learnedSection = readLearnedSection();
  if (learnedSection) {
    const lineCount = learnedSection.split('\n').filter(Boolean).length;
    console.log(`\nLearned items in CALIBER_LEARNINGS.md: ${chalk.cyan(String(lineCount))}`);
  }

  const roiStats = readROIStats();
  const roiSummary = formatROISummary(roiStats);
  if (roiSummary) {
    console.log();
    console.log(chalk.bold(roiSummary.split('\n')[0]));
    for (const line of roiSummary.split('\n').slice(1)) {
      console.log(line);
    }
  }
}

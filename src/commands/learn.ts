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
import { writeLearnedContent, readLearnedSection, readPersonalLearnings, migrateInlineLearnings } from '../learner/writer.js';
import { sanitizeSecrets } from '../lib/sanitize.js';
import { writeFinalizeSummary } from '../lib/notifications.js';
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
import { recordSession, formatROISummary, readROIStats, writeROIStats } from '../learner/roi.js';
import type { LearningCostEntry, SessionROISummary } from '../learner/roi.js';
import { matchLearningsToFailures, semanticMatchFallback, updateActivations, findStaleLearnings } from '../learner/attribution.js';
import { PERSONAL_LEARNINGS_FILE } from '../constants.js';
import {
  trackLearnSessionAnalyzed,
  trackLearnROISnapshot,
  trackLearnNewLearning,
} from '../telemetry/events.js';

/** Minimum tool events required before running LLM analysis. */
const MIN_EVENTS_FOR_ANALYSIS = 25;
const MIN_EVENTS_AUTO = 10;
const AUTO_SETTLE_MS = 200;
const INCREMENTAL_INTERVAL = 50;

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

    // Trigger incremental learning mid-session every INCREMENTAL_INTERVAL events
    const eventsSinceLastAnalysis = state.eventCount - (state.lastAnalysisEventCount || 0);
    if (eventsSinceLastAnalysis >= INCREMENTAL_INTERVAL) {
      try {
        const { resolveCaliber } = await import('../lib/resolve-caliber.js');
        const bin = resolveCaliber();
        const { spawn } = await import('child_process');
        spawn(bin, ['learn', 'finalize', '--auto', '--incremental'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } catch {
        // Best effort — don't block the hook
      }
    }
  } catch {
    // Hook observers must never crash or produce output
  }
}

export async function learnFinalizeCommand(options?: { force?: boolean; auto?: boolean; incremental?: boolean }) {
  const isAuto = options?.auto === true;
  const isIncremental = options?.incremental === true;

  if (!options?.force && !isAuto) {
    const { isCaliberRunning } = await import('../lib/lock.js');
    if (isCaliberRunning()) {
      if (!isAuto) console.log(chalk.dim('caliber: skipping finalize — another caliber process is running'));
      return;
    }
  }

  // Wait for event hooks to finish writing (race condition guard)
  if (isAuto) {
    await new Promise(r => setTimeout(r, AUTO_SETTLE_MS));
  }

  // Prevent concurrent finalize from parallel sessions
  if (!acquireFinalizeLock()) {
    if (!isAuto) console.log(chalk.dim('caliber: skipping finalize — another finalize is in progress'));
    return;
  }

  let analyzed = false;
  try {
    const config = loadConfig();
    if (!config) {
      if (isAuto) return; // Graceful degradation: preserve events for later
      console.log(chalk.yellow('caliber: no LLM provider configured — run `caliber config` first'));
      clearSession();
      resetState();
      return;
    }

    const allEvents = readAllEvents();
    const threshold = isAuto ? MIN_EVENTS_AUTO : MIN_EVENTS_FOR_ANALYSIS;
    if (allEvents.length < threshold) {
      if (!isAuto) console.log(chalk.dim(`caliber: ${allEvents.length}/${threshold} events recorded — need more before analysis`));
      return;
    }

    await validateModel({ fast: true });

    migrateInlineLearnings();

    // For incremental analysis, only analyze events after the last analysis point
    const state = readState();
    const analysisOffset = isIncremental ? (state.lastAnalysisEventCount || 0) : 0;
    const events = analysisOffset > 0 ? allEvents.slice(analysisOffset) : allEvents;

    if (events.length < threshold) {
      if (!isAuto) console.log(chalk.dim(`caliber: ${events.length}/${threshold} new events since last analysis — need more`));
      return;
    }

    const existingConfigs = readExistingConfigs(process.cwd());
    const existingLearnedSection = readLearnedSection();
    const existingPersonalLearnings = readPersonalLearnings();
    const existingSkills = existingConfigs.claudeSkills || [];

    const response = await analyzeEvents(
      events,
      existingConfigs.claudeMd || '',
      existingLearnedSection,
      existingSkills,
      existingPersonalLearnings,
    );

    analyzed = true;

    const waste = calculateSessionWaste(allEvents);
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
        if (isAuto) {
          writeFinalizeSummary({
            timestamp: new Date().toISOString(),
            newItemCount: result.newItemCount,
            newItems: result.newItems,
            wasteTokens: waste.totalWasteTokens,
          });
        } else {
          const wasteLabel = waste.totalWasteTokens > 0
            ? ` (~${waste.totalWasteTokens.toLocaleString()} wasted tokens captured)`
            : '';
          console.log(chalk.dim(`caliber: learned ${result.newItemCount} new pattern${result.newItemCount === 1 ? '' : 's'}${wasteLabel}`));
          for (const item of result.newItems) {
            console.log(chalk.dim(`  + ${item.replace(/^- /, '').slice(0, 80)}`));
          }
        }

        // Record per-learning cost entries with explanations
        const wastePerLearning = Math.round(waste.totalWasteTokens / result.newItemCount);
        const TYPE_RE = /^\*\*\[([^\]]+)\]\*\*/;
        const explanations = response.explanations || [];
        const learningEntries: LearningCostEntry[] = result.newItems.map((item, idx) => {
          const clean = item.replace(/^- /, '');
          const typeMatch = clean.match(TYPE_RE);
          return {
            timestamp: new Date().toISOString(),
            observationType: typeMatch ? typeMatch[1] : 'unknown',
            summary: clean.replace(TYPE_RE, '').trim().slice(0, 80),
            wasteTokens: wastePerLearning,
            sourceEventCount: events.length,
            explanation: explanations[idx] || null,
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

    // Compute task-level metrics from LLM response
    const tasks = response.tasks || [];
    let taskSuccessCount = 0;
    let taskCorrectionCount = 0;
    let taskFailureCount = 0;
    for (const t of tasks) {
      if (t.outcome === 'success') taskSuccessCount++;
      else if (t.outcome === 'corrected') taskCorrectionCount++;
      else if (t.outcome === 'failed') taskFailureCount++;
    }

    // Record session ROI summary + learnings in a single write
    const sessionSummary: SessionROISummary = {
      timestamp: new Date().toISOString(),
      sessionId: state.sessionId || 'unknown',
      eventCount: allEvents.length,
      failureCount: waste.failureCount,
      promptCount: waste.promptCount,
      wasteSeconds: Math.round(waste.totalWasteSeconds),
      hadLearningsAvailable: hadLearnings,
      learningsCount: existingLearnedItems,
      newLearningsProduced,
      taskCount: tasks.length > 0 ? tasks.length : undefined,
      taskSuccessCount: tasks.length > 0 ? taskSuccessCount : undefined,
      taskCorrectionCount: tasks.length > 0 ? taskCorrectionCount : undefined,
      taskFailureCount: tasks.length > 0 ? taskFailureCount : undefined,
    };
    const roiStats = recordSession(sessionSummary, roiLearningEntries);

    // Attribution: match existing learnings against session failure events
    if (roiStats.learnings.length > 0 && waste.failureCount > 0) {
      const failureEvents = allEvents.filter(
        e => e.hook_event_name === 'PostToolUseFailure'
      ) as ToolEvent[];

      let attribution = matchLearningsToFailures(roiStats.learnings, failureEvents);

      if (attribution.matchedIndices.length === 0 && failureEvents.length > 0) {
        attribution = await semanticMatchFallback(roiStats.learnings, failureEvents);
      }

      if (attribution.matchedIndices.length > 0) {
        updateActivations(roiStats, attribution.matchedIndices);
        writeROIStats(roiStats);
      }
    }

    // Emit PostHog events
    trackLearnSessionAnalyzed({
      eventCount: allEvents.length,
      failureCount: waste.failureCount,
      correctionCount: waste.promptCount,
      hadLearningsAvailable: hadLearnings,
      learningsAvailableCount: existingLearnedItems,
      newLearningsProduced,
      wasteTokens: waste.totalWasteTokens,
      wasteSeconds: Math.round(waste.totalWasteSeconds),
    });

    const t = roiStats.totals;
    const totalSessions = t.totalSessionsWithLearnings + t.totalSessionsWithoutLearnings;
    trackLearnROISnapshot({
      totalWasteTokens: t.totalWasteTokens,
      totalWasteSeconds: t.totalWasteSeconds,
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
      estimatedSavingsSeconds: t.estimatedSavingsSeconds,
      learningCount: roiStats.learnings.length,
    });

    // Check for stale learnings (never activated after enough sessions)
    if (!isIncremental) {
      const staleLearnings = findStaleLearnings(roiStats);
      if (staleLearnings.length > 0 && !isAuto) {
        console.log(chalk.yellow(`caliber: ${staleLearnings.length} learning${staleLearnings.length === 1 ? '' : 's'} never activated — run \`caliber learn list --verbose\` to review`));
      }
    }

    // Show savings summary if we have history
    if (!isAuto && t.estimatedSavingsTokens > 0) {
      const totalLearnings = existingLearnedItems + newLearningsProduced;
      console.log(chalk.dim(`caliber: ${totalLearnings} learnings active — est. ~${t.estimatedSavingsTokens.toLocaleString()} tokens saved across ${t.totalSessionsWithLearnings} sessions`));
    }
  } catch (err) {
    if (options?.force && !isAuto) {
      console.error(chalk.red('caliber: finalize failed —'), err instanceof Error ? err.message : err);
    }
  } finally {
    if (analyzed) {
      if (isIncremental) {
        // Keep the session going — just mark where we analyzed up to
        const state = readState();
        state.lastAnalysisEventCount = state.eventCount;
        state.lastAnalysisTimestamp = new Date().toISOString();
        writeState(state);
      } else {
        clearSession();
        resetState();
      }
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

interface LearningItem {
  text: string;
  source: 'project' | 'personal';
  index: number;
}

function getAllLearnings(): LearningItem[] {
  const items: LearningItem[] = [];
  let idx = 0;

  const projectSection = readLearnedSection();
  if (projectSection) {
    for (const line of projectSection.split('\n').filter(l => l.startsWith('- '))) {
      items.push({ text: line, source: 'project', index: idx++ });
    }
  }

  const personalSection = readPersonalLearnings();
  if (personalSection) {
    for (const line of personalSection.split('\n').filter(l => l.startsWith('- '))) {
      items.push({ text: line, source: 'personal', index: idx++ });
    }
  }

  return items;
}

export async function learnListCommand(options?: { verbose?: boolean }) {
  const items = getAllLearnings();

  if (items.length === 0) {
    console.log(chalk.dim('No learnings yet. Run `caliber learn install` to start.'));
    return;
  }

  const roiStats = options?.verbose ? readROIStats() : null;

  console.log(chalk.bold(`\n  Learnings (${items.length})\n`));

  for (const item of items) {
    const tag = item.source === 'personal' ? chalk.magenta('[personal]') : chalk.blue('[project]');
    const display = item.text.replace(/^- /, '').slice(0, 100);
    console.log(`  ${chalk.dim(String(item.index + 1).padStart(2, ' '))}. ${tag} ${display}`);

    if (options?.verbose && roiStats) {
      const match = roiStats.learnings.find(l => display.includes(l.summary.slice(0, 40)));
      if (match) {
        const activations = match.activationCount ?? 0;
        const stale = activations === 0 && roiStats.sessions.length >= 10;
        const activationLabel = stale
          ? chalk.yellow(`${activations} activations [stale]`)
          : chalk.dim(`${activations} activation${activations === 1 ? '' : 's'}`);
        console.log(`      ${activationLabel}`);
        if (match.explanation) {
          console.log(`      ${chalk.dim('Why: ' + match.explanation.slice(0, 80))}`);
        }
      }
    }
  }
  console.log('');
}

export async function learnDeleteCommand(indexStr: string) {
  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 1) {
    console.log(chalk.red(`Invalid index: "${indexStr}". Use a number from \`caliber learn list\`.`));
    return;
  }

  const items = getAllLearnings();
  const targetIdx = index - 1; // User sees 1-based

  if (targetIdx >= items.length) {
    console.log(chalk.red(`Index ${index} is out of range. You have ${items.length} learnings.`));
    return;
  }

  const item = items[targetIdx];
  const filePath = item.source === 'personal'
    ? PERSONAL_LEARNINGS_FILE
    : 'CALIBER_LEARNINGS.md';

  if (!fs.existsSync(filePath)) {
    console.log(chalk.red('Learnings file not found.'));
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Find which bullet within this file corresponds to our item
  const bulletsOfSource = items.filter(i => i.source === item.source);
  const posInFile = bulletsOfSource.indexOf(item);

  // Find the Nth bullet line in the file
  let bulletsSeen = 0;
  let lineToRemove = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('- ')) {
      if (bulletsSeen === posInFile) {
        lineToRemove = i;
        break;
      }
      bulletsSeen++;
    }
  }

  if (lineToRemove === -1) {
    console.log(chalk.red('Could not locate learning in file.'));
    return;
  }

  const bulletToRemove = lines[lineToRemove];
  const newLines = lines.filter((_, i) => i !== lineToRemove);
  fs.writeFileSync(filePath, newLines.join('\n'));

  if (item.source === 'personal') {
    fs.chmodSync(filePath, 0o600);
  }

  // Clean up corresponding ROI stats entry
  const roiStats = readROIStats();
  const cleanText = bulletToRemove.replace(/^- /, '').replace(/^\*\*\[[^\]]+\]\*\*\s*/, '').trim();
  const roiIdx = roiStats.learnings.findIndex(l => cleanText.includes(l.summary.slice(0, 30)));
  if (roiIdx !== -1) {
    roiStats.learnings.splice(roiIdx, 1);
    writeROIStats(roiStats);
  }

  console.log(chalk.green('✓') + ` Removed: ${bulletToRemove.replace(/^- /, '').slice(0, 80)}`);
}

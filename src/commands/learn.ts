import fs from 'fs';
import chalk from 'chalk';
import { readStdin } from '../learner/stdin.js';
import {
  appendEvent,
  readAllEvents,
  readState,
  writeState,
  clearSession,
  resetState,
  getEventCount,
  acquireFinalizeLock,
  releaseFinalizeLock,
} from '../learner/storage.js';
import type { ToolEvent } from '../learner/storage.js';
import { writeLearnedContent, readLearnedSection, migrateInlineLearnings } from '../learner/writer.js';
import {
  areLearningHooksInstalled,
  installLearningHooks,
  removeLearningHooks,
  areCursorLearningHooksInstalled,
  installCursorLearningHooks,
  removeCursorLearningHooks,
} from '../lib/learning-hooks.js';
import { readExistingConfigs } from '../fingerprint/existing-config.js';
import { analyzeEvents } from '../ai/learn.js';
import { loadConfig } from '../llm/config.js';
import { validateModel } from '../llm/index.js';

/** Minimum tool events required before running LLM analysis. */
const MIN_EVENTS_FOR_ANALYSIS = 50;

export async function learnObserveCommand(options: { failure?: boolean }) {
  try {
    const raw = await readStdin();
    if (!raw.trim()) return;

    const hookData = JSON.parse(raw);

    const event: ToolEvent = {
      timestamp: new Date().toISOString(),
      session_id: hookData.session_id || hookData.conversation_id || 'unknown',
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
    if (!state.sessionId) state.sessionId = event.session_id;
    writeState(state);
  } catch {
    // Hook observers must never crash or produce output
  }
}

export async function learnFinalizeCommand() {
  const { isCaliberRunning } = await import('../lib/lock.js');
  if (isCaliberRunning()) return;

  // Prevent concurrent finalize from parallel sessions
  if (!acquireFinalizeLock()) return;

  let analyzed = false;
  try {
    const config = loadConfig();
    if (!config) {
      clearSession();
      resetState();
      return;
    }

    const events = readAllEvents();
    if (events.length < MIN_EVENTS_FOR_ANALYSIS) return;

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

    if (response.claudeMdLearnedSection || response.skills?.length) {
      const result = writeLearnedContent({
        claudeMdLearnedSection: response.claudeMdLearnedSection,
        skills: response.skills,
      });
      if (result.newItemCount > 0) {
        console.log(chalk.dim(`caliber: learned ${result.newItemCount} new pattern${result.newItemCount === 1 ? '' : 's'}`));
        for (const item of result.newItems) {
          console.log(chalk.dim(`  + ${item.replace(/^- /, '').slice(0, 80)}`));
        }
      }
    }
  } catch {
    // Finalize should not fail visibly
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
}

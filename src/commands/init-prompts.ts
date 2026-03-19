import chalk from 'chalk';
import ora from 'ora';
import select from '@inquirer/select';
import checkbox from '@inquirer/checkbox';
import fs from 'fs';
import { refineSetup } from '../ai/refine.js';
import { SpinnerMessages, REFINE_MESSAGES } from '../utils/spinner-messages.js';
import { promptInput } from '../utils/prompt.js';
import { getFastModel } from '../llm/config.js';
import { llmJsonCall } from '../llm/index.js';
import { promptReviewMethod, openReview } from '../utils/review.js';
import type { StageResult } from '../writers/staging.js';

export type TargetAgent = ('claude' | 'cursor' | 'codex' | 'github-copilot')[];
export type HookChoice = 'claude' | 'precommit' | 'both' | 'skip';
type ReviewAction = 'accept' | 'refine' | 'decline';

export function detectAgents(dir: string): TargetAgent {
  const agents: TargetAgent = [];
  if (fs.existsSync(`${dir}/.claude`)) agents.push('claude');
  if (fs.existsSync(`${dir}/.cursor`)) agents.push('cursor');
  if (fs.existsSync(`${dir}/.agents`) || fs.existsSync(`${dir}/AGENTS.md`)) agents.push('codex');
  if (fs.existsSync(`${dir}/.github/copilot-instructions.md`)) agents.push('github-copilot');
  return agents;
}

export async function promptAgent(detected?: TargetAgent): Promise<TargetAgent> {
  const choices = [
    { name: 'Claude Code', value: 'claude' as const, checked: detected?.includes('claude') ?? false },
    { name: 'Cursor', value: 'cursor' as const, checked: detected?.includes('cursor') ?? false },
    { name: 'Codex (OpenAI)', value: 'codex' as const, checked: detected?.includes('codex') ?? false },
    { name: 'GitHub Copilot', value: 'github-copilot' as const, checked: detected?.includes('github-copilot') ?? false },
  ];

  const hasDefaults = detected && detected.length > 0;
  const message = hasDefaults
    ? 'Detected agents (press Enter to confirm, or toggle with space)'
    : 'Which coding agents do you use? (toggle with space)';

  const selected = await checkbox({
    message,
    choices,
    validate: (items) => {
      if (items.length === 0) return 'At least one agent must be selected';
      return true;
    },
  });
  return selected;
}

export async function promptHookType(targetAgent: TargetAgent): Promise<HookChoice> {
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

export async function promptLearnInstall(targetAgent: TargetAgent): Promise<boolean> {
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

export async function promptReviewAction(
  hasSkillResults: boolean,
  hasChanges: boolean,
  staged?: StageResult,
): Promise<ReviewAction> {
  if (!hasChanges && !hasSkillResults) return 'accept';

  const choices: Array<{ name: string; value: ReviewAction | 'review' }> = [];

  const acceptLabel = hasSkillResults
    ? 'Accept and continue to community skills'
    : 'Accept and apply';

  choices.push({ name: acceptLabel, value: 'accept' as const });

  if (hasChanges && staged) {
    choices.push({ name: 'Review diffs first', value: 'review' as const });
  }

  choices.push(
    { name: 'Refine via chat', value: 'refine' as const },
    { name: 'Decline all changes', value: 'decline' as const },
  );

  const choice = await select({
    message: 'What would you like to do?',
    choices,
  });

  if (choice === 'review' && staged) {
    const reviewMethod = await promptReviewMethod();
    await openReview(reviewMethod, staged.stagedFiles);
    return promptReviewAction(hasSkillResults, hasChanges, undefined);
  }

  return choice as ReviewAction;
}

export async function classifyRefineIntent(message: string): Promise<boolean> {
  const fastModel = getFastModel();
  try {
    const result = await llmJsonCall<{ valid: boolean }>({
      system: `You classify whether a user message is a valid request to modify AI agent config files (CLAUDE.md, .cursorrules, copilot-instructions.md, skills).
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

export async function refineLoop(
  currentSetup: Record<string, unknown>,
  sessionHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  summarizeSetup: (action: string, setup: Record<string, unknown>) => string,
  printSummary: (setup: Record<string, unknown>) => void,
): Promise<Record<string, unknown> | null> {
  let setup = currentSetup;
  while (true) {
    const message = await promptInput('\nWhat would you like to change?');
    if (!message || message.toLowerCase() === 'done' || message.toLowerCase() === 'accept') {
      return setup;
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

    const refined = await refineSetup(setup, message, sessionHistory);

    refineMessages.stop();

    if (refined) {
      setup = refined;
      sessionHistory.push({ role: 'user', content: message });
      sessionHistory.push({
        role: 'assistant',
        content: summarizeSetup('Applied changes', refined),
      });
      refineSpinner.succeed('Setup updated');
      printSummary(refined);
      console.log(chalk.dim('Type "done" to accept, or describe more changes.'));
    } else {
      refineSpinner.fail('Refinement failed — could not parse AI response.');
      console.log(chalk.dim('Try rephrasing your request, or type "done" to keep the current setup.'));
    }
  }
}

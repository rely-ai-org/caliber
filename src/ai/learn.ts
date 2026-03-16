import { llmCall, estimateTokens } from '../llm/index.js';
import { getFastModel } from '../llm/config.js';
import { extractJson, stripMarkdownFences } from '../llm/utils.js';
import { LEARN_SYSTEM_PROMPT } from './prompts.js';
import type { ToolEvent, PromptEvent, SessionEvent } from '../learner/storage.js';

interface LearnedSkill {
  name: string;
  description: string;
  content: string;
  isNew: boolean;
}

interface AnalysisResult {
  claudeMdLearnedSection: string | null;
  skills: LearnedSkill[] | null;
  explanations: string[];
}

const MAX_PROMPT_TOKENS = 100_000;

function formatEventsForPrompt(events: SessionEvent[]): string {
  return events.map((e, i) => {
    if (e.hook_event_name === 'UserPromptSubmit') {
      const pe = e as PromptEvent;
      return `--- Event ${i + 1} [USER_PROMPT] ---
Time: ${pe.timestamp}
User said:
${pe.prompt_content}`;
    }

    const te = e as ToolEvent;
    const status = te.hook_event_name === 'PostToolUseFailure' ? 'FAILURE' : 'SUCCESS';
    const inputStr = JSON.stringify(te.tool_input, null, 2);
    const responseStr = typeof te.tool_response === 'object' && '_truncated' in te.tool_response
      ? String(te.tool_response._truncated)
      : JSON.stringify(te.tool_response, null, 2);

    return `--- Event ${i + 1} [${status}] ---
Tool: ${te.tool_name}
Time: ${te.timestamp}
Input:
${inputStr}
Response:
${responseStr}`;
  }).join('\n\n');
}

function trimEventsToFit(events: SessionEvent[], maxTokens: number): SessionEvent[] {
  let formatted = formatEventsForPrompt(events);
  if (estimateTokens(formatted) <= maxTokens) return events;

  const kept = events.slice(-Math.floor(events.length / 2));
  formatted = formatEventsForPrompt(kept);
  if (estimateTokens(formatted) <= maxTokens) return kept;

  return kept.slice(-50);
}

function parseAnalysisResponse(raw: string): AnalysisResult {
  const cleaned = stripMarkdownFences(raw);

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall through to bracket extraction
  }

  const json = extractJson(cleaned);
  if (!json) {
    return { claudeMdLearnedSection: null, skills: null, explanations: ['LLM response could not be parsed.'] };
  }

  try {
    return JSON.parse(json);
  } catch {
    return { claudeMdLearnedSection: null, skills: null, explanations: ['LLM response contained invalid JSON.'] };
  }
}

export async function analyzeEvents(
  events: SessionEvent[],
  existingClaudeMd?: string,
  existingLearnedSection?: string | null,
  existingSkills?: Array<{ filename: string; content: string }>,
): Promise<AnalysisResult> {
  const fittedEvents = trimEventsToFit(events, MAX_PROMPT_TOKENS - 10_000);
  const eventsText = formatEventsForPrompt(fittedEvents);

  const contextParts: string[] = [];

  if (existingClaudeMd) {
    contextParts.push(`## Existing CLAUDE.md (do NOT repeat these instructions)\n\n${existingClaudeMd.slice(0, 5000)}`);
  }

  if (existingLearnedSection) {
    contextParts.push(`## Existing Learned Section (keep these, add new ones, deduplicate)\n\n${existingLearnedSection}`);
  }

  if (existingSkills?.length) {
    const skillsSummary = existingSkills.map(s => `- ${s.filename}: ${s.content.slice(0, 200)}`).join('\n');
    contextParts.push(`## Existing Skills\n\n${skillsSummary}`);
  }

  const prompt = `${contextParts.length ? contextParts.join('\n\n---\n\n') + '\n\n---\n\n' : ''}## Tool Events from Session (${fittedEvents.length} events)\n\n${eventsText}`;

  const fastModel = getFastModel();
  const raw = await llmCall({
    system: LEARN_SYSTEM_PROMPT,
    prompt,
    maxTokens: 4096,
    ...(fastModel ? { model: fastModel } : {}),
  });

  return parseAnalysisResponse(raw);
}

export interface WasteEstimate {
  totalWasteTokens: number;
  failureCount: number;
  promptCount: number;
}

export function calculateSessionWaste(events: SessionEvent[]): WasteEstimate {
  let totalWasteTokens = 0;
  let failureCount = 0;
  let promptCount = 0;

  for (const event of events) {
    if (event.hook_event_name === 'PostToolUseFailure') {
      const te = event as ToolEvent;
      const inputStr = JSON.stringify(te.tool_input);
      const responseStr = typeof te.tool_response === 'object' && '_truncated' in te.tool_response
        ? String(te.tool_response._truncated)
        : JSON.stringify(te.tool_response);
      totalWasteTokens += estimateTokens(inputStr + responseStr);
      failureCount++;
    } else if (event.hook_event_name === 'UserPromptSubmit') {
      promptCount++;
    }
  }

  return { totalWasteTokens, failureCount, promptCount };
}

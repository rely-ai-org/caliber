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

interface TaskSegment {
  summary: string;
  outcome: 'success' | 'corrected' | 'failed';
  startEventIdx: number;
  endEventIdx: number;
  attribution?: {
    configSection: string;
    relevance: number;
  };
}

interface AnalysisResult {
  claudeMdLearnedSection: string | null;
  skills: LearnedSkill[] | null;
  explanations: string[];
  tasks?: TaskSegment[];
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

  contextParts.push(`## Task Segmentation & Attribution Instructions

Analyze the event timeline and identify logical tasks (a task = one user intent, from their prompt through the agent's work until the next user prompt or session end).

For each task, determine:
- "summary": what the user was trying to accomplish (1 sentence)
- "outcome": "success" (completed without issues), "corrected" (user had to redirect the agent), or "failed" (task was abandoned or produced errors)
- "startEventIdx" and "endEventIdx": 0-based indices in the event list
- "attribution": if the task was corrected or failed, identify which section of CLAUDE.md (by ## heading) SHOULD have contained guidance that would have prevented the issue. Include "configSection" (the heading text) and "relevance" (0-1).

Include the "tasks" array in your JSON response alongside "claudeMdLearnedSection", "skills", and "explanations".`);

  const prompt = `${contextParts.join('\n\n---\n\n')}\n\n---\n\n## Tool Events from Session (${fittedEvents.length} events)\n\n${eventsText}`;

  const fastModel = getFastModel();
  const raw = await llmCall({
    system: LEARN_SYSTEM_PROMPT,
    prompt,
    maxTokens: 8192,
    ...(fastModel ? { model: fastModel } : {}),
  });

  return parseAnalysisResponse(raw);
}

export interface WasteEstimate {
  totalWasteTokens: number;
  totalWasteSeconds: number;
  failureCount: number;
  promptCount: number;
}

export function calculateSessionWaste(events: SessionEvent[]): WasteEstimate {
  let totalWasteTokens = 0;
  let totalWasteSeconds = 0;
  let failureCount = 0;
  let promptCount = 0;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.hook_event_name === 'PostToolUseFailure') {
      const te = event as ToolEvent;
      const inputStr = JSON.stringify(te.tool_input);
      const responseStr = typeof te.tool_response === 'object' && '_truncated' in te.tool_response
        ? String(te.tool_response._truncated)
        : JSON.stringify(te.tool_response);
      totalWasteTokens += estimateTokens(inputStr + responseStr);
      failureCount++;

      if (i > 0) {
        const prev = new Date(events[i - 1].timestamp).getTime();
        const curr = new Date(event.timestamp).getTime();
        const elapsed = (curr - prev) / 1000;
        if (elapsed > 0 && elapsed < 600) totalWasteSeconds += elapsed;
      }
    } else if (event.hook_event_name === 'UserPromptSubmit') {
      promptCount++;
    }
  }

  return { totalWasteTokens, totalWasteSeconds, failureCount, promptCount };
}

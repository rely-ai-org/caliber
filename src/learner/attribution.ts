import type { ToolEvent } from './storage.js';
import type { LearningCostEntry, ROIStats } from './roi.js';
import { normalizeBullet } from './utils.js';
import { llmCall } from '../llm/index.js';
import { getFastModel } from '../llm/config.js';
import { extractJson } from '../llm/utils.js';

export interface AttributionResult {
  matchedIndices: number[];
  unmatchedFailures: number;
}

function normalizeText(text: string): string {
  return text.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
}

interface NormalizedLearning {
  words: string[];
}

function preNormalizeLearning(summary: string): NormalizedLearning {
  const norm = normalizeText(summary);
  return { words: norm.split(' ').filter(w => w.length > 3) };
}

function matchesNormalized(learning: NormalizedLearning, normError: string): boolean {
  if (learning.words.length === 0 || !normError) return false;
  const matchCount = learning.words.filter(w => normError.includes(w)).length;
  return matchCount / learning.words.length >= 0.6;
}

export function matchLearningsToFailures(
  learnings: LearningCostEntry[],
  failureEvents: ToolEvent[],
): AttributionResult {
  if (learnings.length === 0 || failureEvents.length === 0) {
    return { matchedIndices: [], unmatchedFailures: failureEvents.length };
  }

  const normalized = learnings.map(l => preNormalizeLearning(l.summary));
  const matchedIndices = new Set<number>();
  let unmatchedFailures = 0;

  for (const event of failureEvents) {
    const errorText = typeof event.tool_response === 'object' && '_truncated' in event.tool_response
      ? String(event.tool_response._truncated)
      : JSON.stringify(event.tool_response);
    const normError = normalizeText(errorText);

    let matched = false;
    for (let i = 0; i < learnings.length; i++) {
      if (matchesNormalized(normalized[i], normError)) {
        matchedIndices.add(i);
        matched = true;
        break;
      }
    }
    if (!matched) unmatchedFailures++;
  }

  return { matchedIndices: [...matchedIndices], unmatchedFailures };
}

export async function semanticMatchFallback(
  learnings: LearningCostEntry[],
  failureEvents: ToolEvent[],
): Promise<AttributionResult> {
  if (learnings.length === 0 || failureEvents.length === 0) {
    return { matchedIndices: [], unmatchedFailures: failureEvents.length };
  }

  const learningSummaries = learnings.map((l, i) => `${i}: ${l.summary}`).join('\n');
  const failureSummaries = failureEvents.slice(0, 10).map(e => {
    const errorText = typeof e.tool_response === 'object' && '_truncated' in e.tool_response
      ? String(e.tool_response._truncated).slice(0, 200)
      : JSON.stringify(e.tool_response).slice(0, 200);
    return `[${e.tool_name}] ${errorText}`;
  }).join('\n');

  const prompt = `Given these existing learnings (numbered):
${learningSummaries}

And these failure events from a session:
${failureSummaries}

Which learnings (by index number) are related to or could have prevented these failures?
Return a JSON object: {"matchedIndices": [0, 2]} or {"matchedIndices": []} if none match.`;

  try {
    const fastModel = getFastModel();
    const raw = await llmCall({
      system: 'You match failure patterns to existing learnings. Return only valid JSON.',
      prompt,
      maxTokens: 256,
      ...(fastModel ? { model: fastModel } : {}),
    });

    const json = extractJson(raw);
    if (json) {
      const parsed = JSON.parse(json);
      const indices = (parsed.matchedIndices || [])
        .filter((i: unknown) => typeof i === 'number' && i >= 0 && i < learnings.length);
      return { matchedIndices: indices, unmatchedFailures: failureEvents.length - indices.length };
    }
  } catch {
    // Best effort — fall back to no matches
  }

  return { matchedIndices: [], unmatchedFailures: failureEvents.length };
}

export function updateActivations(
  stats: ROIStats,
  matchedIndices: number[],
): void {
  const now = new Date().toISOString();
  for (const idx of matchedIndices) {
    if (idx < stats.learnings.length) {
      stats.learnings[idx].activationCount = (stats.learnings[idx].activationCount ?? 0) + 1;
      stats.learnings[idx].lastActivationTimestamp = now;
    }
  }
}

const DEFAULT_MIN_SESSIONS = 10;

export function findStaleLearnings(
  stats: ROIStats,
  minSessions: number = DEFAULT_MIN_SESSIONS,
): LearningCostEntry[] {
  if (stats.sessions.length < minSessions) return [];

  return stats.learnings.filter(l => {
    const activations = l.activationCount ?? 0;
    if (activations > 0) return false;

    const createdAt = new Date(l.timestamp).getTime();
    const sessionsAfterCreation = stats.sessions.filter(
      s => new Date(s.timestamp).getTime() > createdAt
    ).length;

    return sessionsAfterCreation >= minSessions;
  });
}

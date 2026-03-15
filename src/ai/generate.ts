import type { Fingerprint } from '../fingerprint/index.js';
import { getProvider, TRANSIENT_ERRORS } from '../llm/index.js';
import { GENERATION_SYSTEM_PROMPT } from './prompts.js';
import { extractAllDeps } from '../utils/dependencies.js';

type TargetAgent = ('claude' | 'cursor' | 'codex')[];

interface GenerateCallbacks {
  onStatus: (message: string) => void;
  onComplete: (setup: Record<string, unknown>, explanation?: string) => void;
  onError: (error: string) => void;
}

const GENERATION_MAX_TOKENS = 64000;
const MODEL_MAX_OUTPUT_TOKENS = 128000;

const MAX_RETRIES = 5;

function isTransientError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return TRANSIENT_ERRORS.some(e => msg.includes(e.toLowerCase()));
}

export async function generateSetup(
  fingerprint: Fingerprint,
  targetAgent: TargetAgent,
  prompt?: string,
  callbacks?: GenerateCallbacks,
  failingChecks?: FailingCheck[],
  currentScore?: number,
  passingChecks?: PassingCheck[],
): Promise<{ setup: Record<string, unknown> | null; explanation?: string; raw?: string; stopReason?: string }> {
  const provider = getProvider();
  const userMessage = buildGeneratePrompt(fingerprint, targetAgent, prompt, failingChecks, currentScore, passingChecks);

  let attempt = 0;

  const attemptGeneration = async (): Promise<{ setup: Record<string, unknown> | null; explanation?: string; raw?: string; stopReason?: string }> => {
    attempt++;

    const maxTokensForAttempt = Math.min(
      GENERATION_MAX_TOKENS + (attempt * 16000),
      MODEL_MAX_OUTPUT_TOKENS
    );

    return new Promise((resolve) => {
      let preJsonBuffer = '';
      let jsonContent = '';
      let inJson = false;
      let sentStatuses = 0;
      let stopReason: string | null = null;

      provider.stream(
        {
          system: GENERATION_SYSTEM_PROMPT,
          prompt: userMessage,
          maxTokens: maxTokensForAttempt,
        },
        {
          onText: (text) => {
            if (!inJson) {
              preJsonBuffer += text;
              const lines = preJsonBuffer.split('\n');
              const completedLines = lines.slice(0, -1);
              for (let i = sentStatuses; i < completedLines.length; i++) {
                const trimmed = completedLines[i].trim();
                if (trimmed.startsWith('STATUS:')) {
                  const status = trimmed.slice(7).trim();
                  if (status && callbacks) callbacks.onStatus(status);
                }
              }
              sentStatuses = completedLines.length;

              // Find the real JSON object start — skip brackets inside the EXPLAIN section.
              // The EXPLAIN section uses markdown lists and [Changes]/[Deletions] headers,
              // so we look for a `{` that starts a line (possibly after whitespace or ```json).
              const jsonStartMatch = preJsonBuffer.match(/(?:^|\n)\s*(?:```json\s*\n\s*)?\{(?=\s*")/);
              if (jsonStartMatch) {
                const matchIndex = preJsonBuffer.indexOf('{', jsonStartMatch.index!);
                inJson = true;
                jsonContent = preJsonBuffer.slice(matchIndex);
              }
            } else {
              jsonContent += text;
            }
          },
          onEnd: (meta) => {
            stopReason = meta?.stopReason ?? null;
            let setup: Record<string, unknown> | null = null;
            let jsonToParse = (jsonContent || preJsonBuffer).replace(/```\s*$/g, '').trim();

            // If jsonContent wasn't captured by the streaming parser, extract from full buffer
            if (!jsonContent && preJsonBuffer) {
              const fallbackMatch = preJsonBuffer.match(/(?:^|\n)\s*(?:```json\s*\n\s*)?\{(?=\s*")/);
              if (fallbackMatch) {
                const matchIndex = preJsonBuffer.indexOf('{', fallbackMatch.index!);
                jsonToParse = preJsonBuffer.slice(matchIndex).replace(/```\s*$/g, '').trim();
              }
            }

            try {
              setup = JSON.parse(jsonToParse);
            } catch {}

            // Retry if output was truncated (max_tokens hit) and JSON parse failed
            if (!setup && stopReason === 'max_tokens' && attempt < MAX_RETRIES) {
              if (callbacks) callbacks.onStatus('Output was truncated, retrying with higher token limit...');
              setTimeout(() => attemptGeneration().then(resolve), 1000);
              return;
            }

            let explanation: string | undefined;
            const explainMatch = preJsonBuffer.match(/EXPLAIN:\s*\n([\s\S]*?)(?=\n\s*(`{3}|\{))/);
            if (explainMatch) {
              explanation = explainMatch[1].trim();
            }

            if (setup) {
              if (callbacks) callbacks.onComplete(setup, explanation);
              resolve({ setup, explanation, stopReason: stopReason ?? undefined });
            } else {
              resolve({ setup: null, explanation, raw: preJsonBuffer, stopReason: stopReason ?? undefined });
            }
          },
          onError: (error) => {
            if (isTransientError(error) && attempt < MAX_RETRIES) {
              if (callbacks) callbacks.onStatus('Connection interrupted, retrying...');
              setTimeout(() => attemptGeneration().then(resolve), 2000);
              return;
            }
            if (callbacks) callbacks.onError(error.message);
            resolve({ setup: null, raw: error.message, stopReason: 'error' });
          },
        }
      ).catch((error: Error) => {
        if (callbacks) callbacks.onError(error.message);
        resolve({ setup: null, raw: error.message, stopReason: 'error' });
      });
    });
  };

  return attemptGeneration();
}

export interface FailingCheck {
  name: string;
  suggestion?: string;
}

export interface PassingCheck {
  name: string;
}

const LIMITS = {
  FILE_TREE_ENTRIES: 200,
  EXISTING_CONFIG_CHARS: 8000,
  SKILLS_MAX: 10,
  SKILL_CHARS: 3000,
  RULES_MAX: 10,
  CONFIG_FILES_MAX: 15,
  CONFIG_FILE_CHARS: 3000,
  ROUTES_MAX: 50,
  FILE_SUMMARIES_MAX: 60,
} as const;

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n... (truncated at ${maxChars} chars)`;
}

export function buildGeneratePrompt(
  fingerprint: Fingerprint,
  targetAgent: TargetAgent,
  prompt?: string,
  failingChecks?: FailingCheck[],
  currentScore?: number,
  passingChecks?: PassingCheck[],
): string {
  const parts: string[] = [];
  const existing = fingerprint.existingConfigs;

  const hasExistingConfigs = !!(
    existing.claudeMd || existing.claudeSettings || existing.claudeSkills?.length ||
    existing.readmeMd || existing.agentsMd ||
    existing.cursorrules || existing.cursorRules?.length
  );

  const isTargetedFix = failingChecks && failingChecks.length > 0 && currentScore !== undefined && currentScore >= 95;

  if (isTargetedFix) {
    parts.push(`TARGETED FIX MODE — current score: ${currentScore}/100, target: ${targetAgent}`);
    parts.push(`\nThe existing config is already high quality. ONLY fix these specific failing checks:`);
    for (const check of failingChecks) {
      parts.push(`- ${check.name}${check.suggestion ? `: ${check.suggestion}` : ''}`);
    }
    if (passingChecks && passingChecks.length > 0) {
      parts.push(`\nThese checks are currently PASSING — do NOT break them:`);
      for (const check of passingChecks) {
        parts.push(`- ${check.name}`);
      }
    }
    parts.push(`\nIMPORTANT: Return the existing CLAUDE.md and skills with MINIMAL changes — only the edits needed to fix the above checks. Do NOT rewrite, restructure, rephrase, or make cosmetic changes. Preserve the existing content as-is except for targeted fixes. If a skill file is not related to a failing check, return it EXACTLY as-is, character for character.`);
  } else if (hasExistingConfigs) {
    parts.push(`Audit and improve the existing coding agent configuration for target: ${targetAgent}`);
  } else {
    parts.push(`Generate an initial coding agent configuration for target: ${targetAgent}`);
  }

  if (fingerprint.gitRemoteUrl) parts.push(`\nGit remote: ${fingerprint.gitRemoteUrl}`);
  if (fingerprint.packageName) parts.push(`Package name: ${fingerprint.packageName}`);
  if (fingerprint.languages.length > 0) parts.push(`Languages: ${fingerprint.languages.join(', ')}`);
  if (fingerprint.frameworks.length > 0) parts.push(`Frameworks: ${fingerprint.frameworks.join(', ')}`);
  if (fingerprint.description) parts.push(`Project description: ${fingerprint.description}`);
  if (fingerprint.fileTree.length > 0) {
    const tree = fingerprint.fileTree.slice(0, LIMITS.FILE_TREE_ENTRIES);
    parts.push(`\nFile tree (top-level, ${tree.length}/${fingerprint.fileTree.length}):\n${tree.join('\n')}`);
  }

  if (existing.claudeMd) parts.push(`\nExisting CLAUDE.md:\n${truncate(existing.claudeMd, LIMITS.EXISTING_CONFIG_CHARS)}`);
  if (existing.agentsMd) parts.push(`\nExisting AGENTS.md:\n${truncate(existing.agentsMd, LIMITS.EXISTING_CONFIG_CHARS)}`);
  if (existing.readmeMd) parts.push(`\nExisting README.md:\n${truncate(existing.readmeMd, LIMITS.EXISTING_CONFIG_CHARS)}`);

  if (existing.claudeSkills?.length) {
    parts.push('\n--- Existing Claude Skills ---');
    for (const skill of existing.claudeSkills.slice(0, LIMITS.SKILLS_MAX)) {
      parts.push(`\n[.claude/skills/${skill.filename}]\n${truncate(skill.content, LIMITS.SKILL_CHARS)}`);
    }
    if (existing.claudeSkills.length > LIMITS.SKILLS_MAX) {
      parts.push(`\n(${existing.claudeSkills.length - LIMITS.SKILLS_MAX} more skills omitted)`);
    }
  }

  if (existing.cursorrules) parts.push(`\nExisting .cursorrules:\n${truncate(existing.cursorrules, LIMITS.EXISTING_CONFIG_CHARS)}`);

  if (existing.cursorRules?.length) {
    parts.push('\n--- Existing Cursor Rules ---');
    for (const rule of existing.cursorRules.slice(0, LIMITS.RULES_MAX)) {
      parts.push(`\n[.cursor/rules/${rule.filename}]\n${truncate(rule.content, LIMITS.SKILL_CHARS)}`);
    }
    if (existing.cursorRules.length > LIMITS.RULES_MAX) {
      parts.push(`\n(${existing.cursorRules.length - LIMITS.RULES_MAX} more rules omitted)`);
    }
  }

  if (existing.cursorSkills?.length) {
    parts.push('\n--- Existing Cursor Skills ---');
    for (const skill of existing.cursorSkills.slice(0, LIMITS.SKILLS_MAX)) {
      parts.push(`\n[.cursor/skills/${skill.name}/SKILL.md]\n${truncate(skill.content, LIMITS.SKILL_CHARS)}`);
    }
    if (existing.cursorSkills.length > LIMITS.SKILLS_MAX) {
      parts.push(`\n(${existing.cursorSkills.length - LIMITS.SKILLS_MAX} more skills omitted)`);
    }
  }

  if (fingerprint.codeAnalysis) {
    const ca = fingerprint.codeAnalysis;

    if (ca.configFiles.length > 0) {
      parts.push('\n--- Project Config Files ---');
      for (const cfg of ca.configFiles.slice(0, LIMITS.CONFIG_FILES_MAX)) {
        parts.push(`\n[${cfg.path}]\n${truncate(cfg.content, LIMITS.CONFIG_FILE_CHARS)}`);
      }
    }

    const allRoutes = ca.fileSummaries
      .filter((f) => f.routes.length > 0)
      .flatMap((f) => f.routes.map((r) => `${r}  (${f.path})`));
    if (allRoutes.length > 0) {
      parts.push('\n--- API Routes ---');
      for (const route of allRoutes.slice(0, LIMITS.ROUTES_MAX)) {
        parts.push(`- ${route}`);
      }
      if (allRoutes.length > LIMITS.ROUTES_MAX) {
        parts.push(`(${allRoutes.length - LIMITS.ROUTES_MAX} more routes omitted)`);
      }
    }

    if (ca.fileSummaries.length > 0) {
      parts.push('\n--- Source File Summaries ---');
      for (const f of ca.fileSummaries.slice(0, LIMITS.FILE_SUMMARIES_MAX)) {
        const sections: string[] = [`[${f.path}] (${f.language})`];
        if (f.imports.length > 0) sections.push(`  imports: ${f.imports.slice(0, 10).join('; ')}`);
        if (f.exports.length > 0) sections.push(`  exports: ${f.exports.slice(0, 10).join(', ')}`);
        if (f.functions.length > 0) sections.push(`  functions: ${f.functions.slice(0, 10).join(', ')}`);
        if (f.classes.length > 0) sections.push(`  classes: ${f.classes.join(', ')}`);
        if (f.types.length > 0) sections.push(`  types: ${f.types.slice(0, 10).join(', ')}`);
        parts.push(sections.join('\n'));
      }
      if (ca.fileSummaries.length > LIMITS.FILE_SUMMARIES_MAX) {
        parts.push(`\n(${ca.fileSummaries.length - LIMITS.FILE_SUMMARIES_MAX} more files omitted)`);
      }
    }

    if (ca.truncated) {
      parts.push('\n(Code analysis was truncated due to size limits — not all files are shown.)');
    }
  }

  const allDeps = extractAllDeps(process.cwd());
  if (allDeps.length > 0) {
    parts.push(`\nDEPENDENCY COVERAGE — mention at least 85% of these ${allDeps.length} packages by name in CLAUDE.md or skills for full coverage points:`);
    parts.push(allDeps.join(', '));
  }

  if (prompt) parts.push(`\nUser instructions: ${prompt}`);

  return parts.join('\n');
}

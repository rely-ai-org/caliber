import { llmJsonCall } from '../llm/index.js';
import { getFastModel } from '../llm/config.js';
import { FINGERPRINT_SYSTEM_PROMPT } from './prompts.js';

interface DetectResult {
  languages: string[];
  frameworks: string[];
  tools: string[];
  workspaces: string[];
}

export async function detectProjectStack(
  fileTree: string[],
  suffixCounts: Record<string, number>
): Promise<DetectResult> {
  const parts: string[] = ['Analyze this project and detect languages, frameworks, and external tools/services.\n'];

  if (fileTree.length > 0) {
    const cappedTree = fileTree.slice(0, 500);
    parts.push(`File tree (${cappedTree.length}/${fileTree.length} entries):`);
    parts.push(cappedTree.join('\n'));
  }

  const sorted = Object.entries(suffixCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    parts.push('\nFile extension distribution (sorted by frequency):');
    for (const [ext, count] of sorted) {
      parts.push(`${ext}: ${count}`);
    }
  }

  const fastModel = getFastModel();

  const result = await llmJsonCall<DetectResult>({
    system: FINGERPRINT_SYSTEM_PROMPT,
    prompt: parts.join('\n'),
    ...(fastModel ? { model: fastModel } : {}),
  });

  return {
    languages: Array.isArray(result.languages) ? result.languages : [],
    frameworks: Array.isArray(result.frameworks) ? result.frameworks : [],
    tools: Array.isArray(result.tools) ? result.tools : [],
    workspaces: Array.isArray(result.workspaces) ? result.workspaces : [],
  };
}

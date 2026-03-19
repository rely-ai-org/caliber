const BLOCK_START = '<!-- caliber:managed:pre-commit -->';
const BLOCK_END = '<!-- /caliber:managed:pre-commit -->';

const MANAGED_DOC_PATHS = 'CLAUDE.md .claude/ .cursor/ .github/copilot-instructions.md AGENTS.md CALIBER_LEARNINGS.md';

const PRE_COMMIT_BLOCK = `${BLOCK_START}
## Before Committing

Run \`caliber refresh\` before creating git commits to keep docs in sync with code changes.
After it completes, stage any modified doc files before committing:

\`\`\`bash
caliber refresh && git add ${MANAGED_DOC_PATHS} 2>/dev/null
\`\`\`
${BLOCK_END}`;

const CURSOR_RULE_FILENAME = 'caliber-pre-commit.mdc';

const CURSOR_RULE_CONTENT = `---
description: Run caliber refresh before git commits to keep docs in sync
alwaysApply: true
---
Before creating git commits, run \`caliber refresh\` to update docs based on code changes,
then stage modified doc files (${MANAGED_DOC_PATHS}).
`;

export function hasPreCommitBlock(content: string): boolean {
  return content.includes(BLOCK_START);
}

export function appendPreCommitBlock(content: string): string {
  if (hasPreCommitBlock(content)) return content;
  const trimmed = content.trimEnd();
  return trimmed + '\n\n' + PRE_COMMIT_BLOCK + '\n';
}

export function getCursorPreCommitRule(): { filename: string; content: string } {
  return { filename: CURSOR_RULE_FILENAME, content: CURSOR_RULE_CONTENT };
}

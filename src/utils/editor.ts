import { execSync, spawn } from 'child_process';

const IS_WINDOWS = process.platform === 'win32';

export type ReviewMethod = 'cursor' | 'vscode' | 'terminal';

function commandExists(cmd: string): boolean {
  try {
    const check = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectAvailableEditors(): ReviewMethod[] {
  const methods: ReviewMethod[] = [];
  if (commandExists('cursor')) methods.push('cursor');
  if (commandExists('code')) methods.push('vscode');
  methods.push('terminal');
  return methods;
}

export function openDiffsInEditor(
  editor: 'cursor' | 'vscode',
  files: Array<{ originalPath?: string; proposedPath: string }>
): void {
  const cmd = editor === 'cursor' ? 'cursor' : 'code';

  for (const file of files) {
    try {
      if (IS_WINDOWS) {
        const quote = (s: string) => `"${s}"`;
        const parts = file.originalPath
          ? [cmd, '--diff', quote(file.originalPath), quote(file.proposedPath)]
          : [cmd, quote(file.proposedPath)];
        spawn(parts.join(' '), { shell: true, stdio: 'ignore', detached: true }).unref();
      } else {
        const args = file.originalPath
          ? ['--diff', file.originalPath, file.proposedPath]
          : [file.proposedPath];
        spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
      }
    } catch {
      continue;
    }
  }
}

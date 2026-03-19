import fs from 'fs';
import path from 'path';
import { appendPreCommitBlock } from '../pre-commit-block.js';

interface CopilotConfig {
  instructions: string;
  instructionFiles?: Array<{ filename: string; content: string }>;
}

export function writeGithubCopilotConfig(config: CopilotConfig): string[] {
  const written: string[] = [];

  if (config.instructions) {
    fs.mkdirSync('.github', { recursive: true });
    fs.writeFileSync(path.join('.github', 'copilot-instructions.md'), appendPreCommitBlock(config.instructions));
    written.push('.github/copilot-instructions.md');
  }

  if (config.instructionFiles?.length) {
    const instructionsDir = path.join('.github', 'instructions');
    fs.mkdirSync(instructionsDir, { recursive: true });

    for (const file of config.instructionFiles) {
      fs.writeFileSync(path.join(instructionsDir, file.filename), file.content);
      written.push(`.github/instructions/${file.filename}`);
    }
  }

  return written;
}

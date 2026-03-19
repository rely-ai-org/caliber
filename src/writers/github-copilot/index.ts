import fs from 'fs';
import path from 'path';

interface CopilotConfig {
  instructions: string;
  instructionFiles?: Array<{ filename: string; content: string }>;
}

export function writeGithubCopilotConfig(config: CopilotConfig): string[] {
  const written: string[] = [];

  if (config.instructions) {
    fs.mkdirSync('.github', { recursive: true });
    const filePath = path.join('.github', 'copilot-instructions.md');
    fs.writeFileSync(filePath, config.instructions);
    written.push(filePath);
  }

  if (config.instructionFiles?.length) {
    const instructionsDir = path.join('.github', 'instructions');
    fs.mkdirSync(instructionsDir, { recursive: true });

    for (const file of config.instructionFiles) {
      const filePath = path.join(instructionsDir, file.filename);
      fs.writeFileSync(filePath, file.content);
      written.push(filePath);
    }
  }

  return written;
}

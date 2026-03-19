import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

import { writeCodexConfig } from '../codex/index.js';

describe('writeCodexConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('writes AGENTS.md to project root', () => {
    const written = writeCodexConfig({ agentsMd: '# Project\n\nInstructions here.' });

    expect(written).toEqual(['AGENTS.md']);
    const content = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    expect(content).toContain('# Project\n\nInstructions here.');
    expect(content).toContain('caliber:managed:pre-commit');
  });

  it('writes skills to .agents/skills/{name}/SKILL.md with frontmatter', () => {
    const config = {
      agentsMd: '# Project',
      skills: [
        { name: 'testing-guide', description: 'How to write tests', content: 'Write tests' },
        { name: 'deploy', description: 'Deploy steps', content: 'Deploy steps' },
      ],
    };

    const written = writeCodexConfig(config);

    expect(written).toHaveLength(3);
    expect(written).toContain('AGENTS.md');
    expect(written).toContain(path.join('.agents', 'skills', 'testing-guide', 'SKILL.md'));
    expect(written).toContain(path.join('.agents', 'skills', 'deploy', 'SKILL.md'));

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join('.agents', 'skills', 'testing-guide'),
      { recursive: true }
    );
    const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
    const skillCall = writeCalls.find(c => String(c[0]).includes('testing-guide'));
    expect(skillCall).toBeDefined();
    expect(skillCall![1]).toBe('---\nname: testing-guide\ndescription: How to write tests\n---\nWrite tests');
  });

  it('writes only AGENTS.md when no skills provided', () => {
    const written = writeCodexConfig({ agentsMd: '# Project' });

    expect(written).toEqual(['AGENTS.md']);
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });
});

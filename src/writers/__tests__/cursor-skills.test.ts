import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

import { writeCursorConfig } from '../cursor/index.js';

describe('writeCursorConfig — skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it('writes skills to .cursor/skills/{name}/SKILL.md with frontmatter', () => {
    const config = {
      skills: [
        { name: 'testing-guide', description: 'How to write tests', content: 'Write tests' },
        { name: 'deploy', description: 'Deploy steps', content: 'Deploy steps' },
      ],
    };

    const written = writeCursorConfig(config);

    expect(written).toContain(path.join('.cursor', 'skills', 'testing-guide', 'SKILL.md'));
    expect(written).toContain(path.join('.cursor', 'skills', 'deploy', 'SKILL.md'));
    expect(written).toContain(path.join('.cursor', 'rules', 'caliber-pre-commit.mdc'));

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join('.cursor', 'skills', 'testing-guide'),
      { recursive: true }
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join('.cursor', 'skills', 'testing-guide', 'SKILL.md'),
      '---\nname: testing-guide\ndescription: How to write tests\n---\nWrite tests'
    );
  });

  it('writes pre-commit rule even when no skills provided', () => {
    const written = writeCursorConfig({});
    expect(written).toHaveLength(1);
    expect(written).toContain(path.join('.cursor', 'rules', 'caliber-pre-commit.mdc'));
  });

  it('writes both skills and legacy cursorrules when both are present', () => {
    const config = {
      cursorrules: 'legacy rules content',
      skills: [
        { name: 'my-skill', description: 'A skill', content: 'skill content' },
      ],
    };

    const written = writeCursorConfig(config);

    expect(written).toContain('.cursorrules');
    expect(written).toContain(path.join('.cursor', 'skills', 'my-skill', 'SKILL.md'));
    expect(written).toContain(path.join('.cursor', 'rules', 'caliber-pre-commit.mdc'));
    expect(written).toHaveLength(3);
  });
});

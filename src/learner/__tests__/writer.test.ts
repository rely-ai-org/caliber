import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');

import { writeLearnedContent, readLearnedSection, readPersonalLearnings } from '../writer.js';
import { PERSONAL_LEARNINGS_FILE } from '../../constants.js';

describe('writer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('deduplication', () => {
    it('removes duplicate bullets by substring match', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === 'CALIBER_LEARNINGS.md'
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        '# Caliber Learnings\n\nSome header.\n\n- Use pnpm for installs\n',
      );

      const result = writeLearnedContent({
        claudeMdLearnedSection: '- Use pnpm for installs',
        skills: null,
      });

      expect(result.newItemCount).toBe(0);
      expect(result.written).toContain('CALIBER_LEARNINGS.md');
    });

    it('removes duplicates when incoming is substring of existing with sufficient overlap', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === 'CALIBER_LEARNINGS.md'
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        '# Caliber Learnings\n\n- Always use pnpm for all package installs\n',
      );

      const result = writeLearnedContent({
        claudeMdLearnedSection: '- Use pnpm for all package installs',
        skills: null,
      });

      expect(result.newItemCount).toBe(0);
    });

    it('keeps items when overlap ratio is below 70%', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === 'CALIBER_LEARNINGS.md'
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        '# Caliber Learnings\n\n- Never use npm - this project requires pnpm for all dependency management\n',
      );

      // "use npm" is a substring but only ~15% of the longer string — should NOT dedup
      const result = writeLearnedContent({
        claudeMdLearnedSection: '- Never use jest directly - use npm test',
        skills: null,
      });

      expect(result.newItemCount).toBe(1);
    });

    it('preserves genuinely different items', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === 'CALIBER_LEARNINGS.md'
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        '# Caliber Learnings\n\n- Use pnpm for installs\n',
      );

      const result = writeLearnedContent({
        claudeMdLearnedSection: '- Never modify generated files in src/proto/',
        skills: null,
      });

      expect(result.newItemCount).toBe(1);
      expect(result.newItems).toEqual(['- Never modify generated files in src/proto/']);
      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('Use pnpm for installs');
      expect(written).toContain('Never modify generated files');
    });

    it('caps at 30 items, keeping newest', () => {
      const existingBullets = Array.from({ length: 28 }, (_, i) =>
        `- Existing rule number ${i + 1}`
      ).join('\n');

      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === 'CALIBER_LEARNINGS.md'
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        `# Caliber Learnings\n\n${existingBullets}\n`,
      );

      const newBullets = Array.from({ length: 5 }, (_, i) =>
        `- Brand new rule ${i + 1}`
      ).join('\n');

      const result = writeLearnedContent({
        claudeMdLearnedSection: newBullets,
        skills: null,
      });

      expect(result.newItemCount).toBe(5);
      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const bullets = written.split('\n').filter(l => l.startsWith('- '));
      expect(bullets).toHaveLength(30);
      expect(bullets[0]).toBe('- Existing rule number 4');
      expect(bullets[bullets.length - 1]).toBe('- Brand new rule 5');
    });
  });

  describe('type prefix handling', () => {
    it('typed bullet deduplicates against untyped version', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === 'CALIBER_LEARNINGS.md'
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        '# Caliber Learnings\n\n- Use pnpm for installs\n',
      );

      const result = writeLearnedContent({
        claudeMdLearnedSection: '- **[convention]** Use pnpm for installs',
        skills: null,
      });

      expect(result.newItemCount).toBe(0);
      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('**[convention]** Use pnpm for installs');
      expect(written).not.toMatch(/^- Use pnpm for installs$/m);
    });

    it('typed bullet replaces untyped duplicate', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === 'CALIBER_LEARNINGS.md'
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        '# Caliber Learnings\n\n- Never edit generated files\n',
      );

      writeLearnedContent({
        claudeMdLearnedSection: '- **[correction]** Never edit generated files',
        skills: null,
      });

      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('**[correction]**');
    });

    it('typed bullets with no duplicates pass through normally', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeLearnedContent({
        claudeMdLearnedSection: '- **[gotcha]** tsup swallows type errors\n- **[env]** DATABASE_URL must be set',
        skills: null,
      });

      expect(result.newItemCount).toBe(2);
      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('**[gotcha]**');
      expect(written).toContain('**[env]**');
    });
  });

  describe('writeLearnedContent', () => {
    it('creates CALIBER_LEARNINGS.md with header when no file exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeLearnedContent({
        claudeMdLearnedSection: '- Use pnpm\n- Run tests first',
        skills: null,
      });

      expect(result.newItemCount).toBe(2);
      expect(result.newItems).toHaveLength(2);
      expect(result.written).toContain('CALIBER_LEARNINGS.md');
      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain('# Caliber Learnings');
    });

    it('returns zero new items when section is null', () => {
      const result = writeLearnedContent({
        claudeMdLearnedSection: null,
        skills: null,
      });

      expect(result.newItemCount).toBe(0);
      expect(result.newItems).toEqual([]);
      expect(result.written).toEqual([]);
    });

    it('writes skills and includes them in written list', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeLearnedContent({
        claudeMdLearnedSection: null,
        skills: [{
          name: 'learned-db-setup',
          description: 'Database setup steps',
          content: '# DB Setup\n\nRun migrations first.',
          isNew: true,
        }],
      });

      const skillPath = result.written.find(p => p.includes('learned-db-setup'));
      expect(skillPath).toBeDefined();
    });
  });

  describe('personal learnings routing', () => {
    it('routes :personal bullets to personal file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeLearnedContent({
        claudeMdLearnedSection: '- **[correction:personal]** use bun not npm',
        skills: null,
      });

      expect(result.personalItemCount).toBe(1);
      expect(result.newItemCount).toBe(0);
      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      const personalCall = calls.find(c => String(c[0]).includes('personal-learnings.md'));
      expect(personalCall).toBeDefined();
      expect(String(personalCall![1])).toContain('use bun not npm');
    });

    it('routes :project bullets to CALIBER_LEARNINGS.md', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeLearnedContent({
        claudeMdLearnedSection: '- **[gotcha:project]** tsup swallows errors',
        skills: null,
      });

      expect(result.newItemCount).toBe(1);
      expect(result.personalItemCount).toBe(0);
      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      const projectCall = calls.find(c => String(c[0]) === 'CALIBER_LEARNINGS.md');
      expect(projectCall).toBeDefined();
    });

    it('routes mixed batch correctly', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = writeLearnedContent({
        claudeMdLearnedSection: [
          '- **[gotcha:project]** tsup swallows errors',
          '- **[correction:personal]** use bun not npm',
          '- **[pattern]** run tsc before build',
        ].join('\n'),
        skills: null,
      });

      expect(result.newItemCount).toBe(2); // project + unscoped (default project)
      expect(result.personalItemCount).toBe(1);
    });

    it('sets 0600 permissions on personal file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      writeLearnedContent({
        claudeMdLearnedSection: '- **[correction:personal]** use bun not npm',
        skills: null,
      });

      expect(vi.mocked(fs.chmodSync)).toHaveBeenCalledWith(
        expect.stringContaining('personal-learnings.md'),
        0o600,
      );
    });
  });

  describe('readLearnedSection', () => {
    it('reads bullets from CALIBER_LEARNINGS.md', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) =>
        String(p) === 'CALIBER_LEARNINGS.md'
      );
      vi.mocked(fs.readFileSync).mockReturnValue(
        '# Caliber Learnings\n\nSome description.\n\n- Use pnpm\n- Run tests\n',
      );

      const section = readLearnedSection();
      expect(section).toBe('- Use pnpm\n- Run tests');
    });

    it('returns null when no learnings file or CLAUDE.md exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const section = readLearnedSection();
      expect(section).toBeNull();
    });

    it('falls back to old inline section in CLAUDE.md without migrating', () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p) === 'CALIBER_LEARNINGS.md') return false;
        if (String(p) === 'CLAUDE.md') return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        '# Project\n\n<!-- caliber:learned -->\n- Old learning\n<!-- /caliber:learned -->\n',
      );

      const section = readLearnedSection();
      expect(section).toBe('- Old learning');
    });
  });
});

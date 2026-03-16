import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');

import { writeLearnedContent, readLearnedSection } from '../writer.js';

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

      expect(result.written).toContain('.claude/skills/learned-db-setup/SKILL.md');
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

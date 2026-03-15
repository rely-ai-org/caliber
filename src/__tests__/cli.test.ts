import { describe, it, expect } from 'vitest';
import { program } from '../cli.js';

describe('cli command registration', () => {
  it('registers regenerate as the primary command', () => {
    const cmd = program.commands.find((c) => c.name() === 'regenerate');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toBe('Re-analyze project and regenerate setup');
  });

  it.each(['regen', 're'])('registers "%s" as an alias for regenerate', (alias) => {
    const cmd = program.commands.find((c) => c.name() === 'regenerate');
    expect(cmd!.aliases()).toContain(alias);
  });

  it('regenerate has --dry-run option', () => {
    const cmd = program.commands.find((c) => c.name() === 'regenerate');
    const opt = cmd!.options.find((o) => o.long === '--dry-run');
    expect(opt).toBeDefined();
  });

  it('registers all expected top-level commands', () => {
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(
      expect.arrayContaining([
        'init', 'undo', 'status', 'regenerate',
        'config', 'skills', 'score',
        'refresh', 'hooks', 'learn',
      ])
    );
  });
});

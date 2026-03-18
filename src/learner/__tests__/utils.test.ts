import { normalizeBullet, hasTypePrefix, isSimilarLearning } from '../utils.js';

describe('normalizeBullet', () => {
  it('strips leading "- " prefix', () => {
    expect(normalizeBullet('- use strict mode')).toBe('use strict mode');
  });

  it('strips **[Type]** prefix', () => {
    expect(normalizeBullet('- **[Pattern]** use strict mode')).toBe('use strict mode');
  });

  it('strips backticks', () => {
    expect(normalizeBullet('- use `strict` mode in `tsconfig`')).toBe('use mode in');
  });

  it('normalizes whitespace and lowercases', () => {
    expect(normalizeBullet('-   Use  Strict   MODE  ')).toBe('use strict mode');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeBullet('   ')).toBe('');
  });

  it('handles combined transformations', () => {
    expect(normalizeBullet('- **[Fix]** Always run `npm ci` before deploying'))
      .toBe('always run before deploying');
  });
});

describe('hasTypePrefix', () => {
  it('returns true when **[Type]** prefix present', () => {
    expect(hasTypePrefix('- **[Pattern]** use strict mode')).toBe(true);
  });

  it('returns true without leading dash', () => {
    expect(hasTypePrefix('**[Fix]** always check types')).toBe(true);
  });

  it('returns false when no prefix', () => {
    expect(hasTypePrefix('- use strict mode')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasTypePrefix('')).toBe(false);
  });
});

describe('isSimilarLearning', () => {
  it('returns true for identical strings', () => {
    expect(isSimilarLearning('- use strict mode', '- use strict mode')).toBe(true);
  });

  it('returns true for substring containment with >70% length ratio', () => {
    // "use strict mode always" (20 chars) vs "use strict mode" (15 chars) → 15/20 = 0.75 > 0.7
    expect(isSimilarLearning('- use strict mode always', '- use strict mode alw')).toBe(true);
  });

  it('returns false for completely different strings', () => {
    expect(isSimilarLearning('- use strict mode', '- deploy to production')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(isSimilarLearning('', '')).toBe(false);
    expect(isSimilarLearning('- use strict', '')).toBe(false);
  });

  it('returns false when length ratio is below threshold', () => {
    expect(isSimilarLearning('- ab', '- abcdefghijklmnop')).toBe(false);
  });

  it('ignores type prefix differences when comparing', () => {
    expect(isSimilarLearning('- **[Pattern]** use strict mode', '- use strict mode')).toBe(true);
  });
});

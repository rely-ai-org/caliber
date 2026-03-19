const TYPE_PREFIX_RE = /^\*\*\[[^\]]+\]\*\*\s*/;

export function normalizeBullet(bullet: string): string {
  return bullet
    .replace(/^- /, '')
    .replace(TYPE_PREFIX_RE, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

export function hasTypePrefix(bullet: string): boolean {
  return TYPE_PREFIX_RE.test(bullet.replace(/^- /, ''));
}

const SCOPE_RE = /^\*\*\[[^\]:]+:([^\]]+)\]\*\*/;

export function extractScope(bullet: string): 'project' | 'personal' {
  const clean = bullet.replace(/^- /, '');
  const match = clean.match(SCOPE_RE);
  if (match && match[1] === 'personal') return 'personal';
  return 'project';
}

const SIMILARITY_THRESHOLD = 0.7;

export function isSimilarLearning(a: string, b: string): boolean {
  const normA = normalizeBullet(a);
  const normB = normalizeBullet(b);
  if (!normA || !normB) return false;
  const shorter = Math.min(normA.length, normB.length);
  const longer = Math.max(normA.length, normB.length);
  if (!(normA.includes(normB) || normB.includes(normA))) return false;
  return shorter / longer > SIMILARITY_THRESHOLD;
}

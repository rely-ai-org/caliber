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

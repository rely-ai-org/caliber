import { existsSync } from 'fs';
import { join } from 'path';
import type { Check } from '../index.js';
import { POINTS_SOURCES_CONFIGURED, POINTS_SOURCES_REFERENCED } from '../constants.js';
import { readFileOrNull } from '../utils.js';
import { loadSourcesConfig } from '../../fingerprint/sources.js';

export function checkSources(dir: string): Check[] {
  const checks: Check[] = [];

  const configSources = loadSourcesConfig(dir);
  const hasSources = configSources.length > 0;

  // sources_configured: bonus points when sources are set up
  // Uses maxPoints: 0 when no sources present (doesn't affect denominator)
  checks.push({
    id: 'sources_configured',
    name: 'External sources configured',
    category: 'bonus',
    maxPoints: hasSources ? POINTS_SOURCES_CONFIGURED : 0,
    earnedPoints: hasSources ? POINTS_SOURCES_CONFIGURED : 0,
    passed: hasSources,
    detail: hasSources
      ? `${configSources.length} source${configSources.length === 1 ? '' : 's'} configured`
      : 'No external sources configured',
    suggestion: hasSources ? undefined : 'Run `caliber sources add <path>` to add related repos or docs',
  });

  // sources_referenced: when sources are configured, check they're mentioned in CLAUDE.md
  if (hasSources) {
    const claudeMd = readFileOrNull(join(dir, 'CLAUDE.md'));
    const content = claudeMd?.toLowerCase() || '';

    const referenced = configSources.some((source) => {
      if (!source.path) return false;
      const name = source.path.split('/').pop()?.toLowerCase() || '';
      return name.length > 2 && content.includes(name);
    });

    checks.push({
      id: 'sources_referenced',
      name: 'Sources referenced in config',
      category: 'grounding',
      maxPoints: POINTS_SOURCES_REFERENCED,
      earnedPoints: referenced ? POINTS_SOURCES_REFERENCED : 0,
      passed: referenced,
      detail: referenced
        ? 'At least one source is referenced in CLAUDE.md'
        : 'No configured sources are mentioned in CLAUDE.md',
      suggestion: referenced ? undefined : 'Regenerate with `caliber init` to include source context in your config',
    });
  }

  return checks;
}

import fs from 'fs';
import path from 'path';
import { normalizeBullet, hasTypePrefix, isSimilarLearning, extractScope } from './utils.js';
import { AUTH_DIR, PERSONAL_LEARNINGS_FILE } from '../constants.js';

const LEARNINGS_FILE = 'CALIBER_LEARNINGS.md';
const LEARNINGS_HEADER = `# Caliber Learnings

Accumulated patterns and anti-patterns from development sessions.
Auto-managed by [caliber](https://github.com/rely-ai-org/caliber) — do not edit manually.

`;

const PERSONAL_LEARNINGS_HEADER = `# Personal Learnings

Developer-specific patterns and preferences.
Auto-managed by [caliber](https://github.com/rely-ai-org/caliber) — do not edit manually.

`;

// Legacy markers for migration from inline CLAUDE.md section
const LEARNED_START = '<!-- caliber:learned -->';
const LEARNED_END = '<!-- /caliber:learned -->';

/** Max learned items to retain — keeps newest when exceeded. */
const MAX_LEARNED_ITEMS = 30;

export interface LearnedSkill {
  name: string;
  description: string;
  content: string;
  isNew: boolean;
}

export interface LearnedUpdate {
  claudeMdLearnedSection: string | null;
  skills: LearnedSkill[] | null;
}

export interface WriteResult {
  written: string[];
  newItemCount: number;
  newItems: string[];
  personalItemCount: number;
  personalItems: string[];
}

export function writeLearnedContent(update: LearnedUpdate): WriteResult {
  const written: string[] = [];
  let newItemCount = 0;
  let newItems: string[] = [];
  let personalItemCount = 0;
  let personalItems: string[] = [];

  if (update.claudeMdLearnedSection) {
    const bullets = parseBullets(update.claudeMdLearnedSection);
    const projectBullets = bullets.filter(b => extractScope(b) === 'project');
    const personalBullets = bullets.filter(b => extractScope(b) === 'personal');

    if (projectBullets.length > 0) {
      const result = writeLearnedSection(projectBullets.join('\n'));
      newItemCount = result.newCount;
      newItems = result.newItems;
      written.push(LEARNINGS_FILE);
    }

    if (personalBullets.length > 0) {
      const result = writePersonalLearnedSection(personalBullets.join('\n'));
      personalItemCount = result.newCount;
      personalItems = result.newItems;
      written.push(PERSONAL_LEARNINGS_FILE);
    }
  }

  if (update.skills?.length) {
    for (const skill of update.skills) {
      const skillPath = writeLearnedSkill(skill);
      written.push(skillPath);
    }
  }

  return { written, newItemCount, newItems, personalItemCount, personalItems };
}

function parseBullets(content: string): string[] {
  const lines = content.split('\n');
  const bullets: string[] = [];
  let current = '';

  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (current) bullets.push(current);
      current = line;
    } else if (current && line.trim() && !line.startsWith('#')) {
      current += '\n' + line;
    } else {
      if (current) bullets.push(current);
      current = '';
    }
  }
  if (current) bullets.push(current);
  return bullets;
}

function deduplicateLearnedItems(
  existing: string | null,
  incoming: string
): { merged: string; newCount: number; newItems: string[] } {
  const existingBullets = existing ? parseBullets(existing) : [];
  const incomingBullets = parseBullets(incoming);
  const merged = [...existingBullets];
  const newItems: string[] = [];

  for (const bullet of incomingBullets) {
    const norm = normalizeBullet(bullet);
    if (!norm) continue;
    const dupIdx = merged.findIndex(e => isSimilarLearning(bullet, e));
    if (dupIdx !== -1) {
      // Upgrade untyped bullet to typed version
      if (hasTypePrefix(bullet) && !hasTypePrefix(merged[dupIdx])) {
        merged[dupIdx] = bullet;
      }
    } else {
      merged.push(bullet);
      newItems.push(bullet);
    }
  }

  const capped = merged.length > MAX_LEARNED_ITEMS ? merged.slice(-MAX_LEARNED_ITEMS) : merged;
  return { merged: capped.join('\n'), newCount: newItems.length, newItems };
}

function writeLearnedSectionTo(
  filePath: string,
  header: string,
  existing: string | null,
  incoming: string,
  mode?: number,
): { newCount: number; newItems: string[] } {
  const { merged, newCount, newItems } = deduplicateLearnedItems(existing, incoming);
  fs.writeFileSync(filePath, header + merged + '\n');
  if (mode) fs.chmodSync(filePath, mode);
  return { newCount, newItems };
}

function writeLearnedSection(content: string): { newCount: number; newItems: string[] } {
  return writeLearnedSectionTo(LEARNINGS_FILE, LEARNINGS_HEADER, readLearnedSection(), content);
}

function writeLearnedSkill(skill: LearnedSkill): string {
  const skillDir = path.join('.claude', 'skills', skill.name);
  if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });

  const skillPath = path.join(skillDir, 'SKILL.md');

  if (!skill.isNew && fs.existsSync(skillPath)) {
    const existing = fs.readFileSync(skillPath, 'utf-8');
    fs.writeFileSync(skillPath, existing.trimEnd() + '\n\n' + skill.content);
  } else {
    const frontmatter = [
      '---',
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(skillPath, frontmatter + skill.content);
  }

  return skillPath;
}

function writePersonalLearnedSection(content: string): { newCount: number; newItems: string[] } {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
  return writeLearnedSectionTo(PERSONAL_LEARNINGS_FILE, PERSONAL_LEARNINGS_HEADER, readPersonalLearnings(), content, 0o600);
}

export function readPersonalLearnings(): string | null {
  if (!fs.existsSync(PERSONAL_LEARNINGS_FILE)) return null;
  const content = fs.readFileSync(PERSONAL_LEARNINGS_FILE, 'utf-8');
  const bullets = content.split('\n').filter(l => l.startsWith('- ')).join('\n');
  return bullets || null;
}

export function readLearnedSection(): string | null {
  if (fs.existsSync(LEARNINGS_FILE)) {
    const content = fs.readFileSync(LEARNINGS_FILE, 'utf-8');
    const bullets = content.split('\n').filter(l => l.startsWith('- ')).join('\n');
    return bullets || null;
  }

  // Migration fallback: check old inline section in CLAUDE.md
  const claudeMdPath = 'CLAUDE.md';
  if (!fs.existsSync(claudeMdPath)) return null;

  const content = fs.readFileSync(claudeMdPath, 'utf-8');
  const startIdx = content.indexOf(LEARNED_START);
  const endIdx = content.indexOf(LEARNED_END);

  if (startIdx === -1 || endIdx === -1) return null;

  return content.slice(startIdx + LEARNED_START.length, endIdx).trim() || null;
}

/** Migrate learned content from inline CLAUDE.md section to CALIBER_LEARNINGS.md. */
export function migrateInlineLearnings(): boolean {
  if (fs.existsSync(LEARNINGS_FILE)) return false;

  const claudeMdPath = 'CLAUDE.md';
  if (!fs.existsSync(claudeMdPath)) return false;

  const content = fs.readFileSync(claudeMdPath, 'utf-8');
  const startIdx = content.indexOf(LEARNED_START);
  const endIdx = content.indexOf(LEARNED_END);

  if (startIdx === -1 || endIdx === -1) return false;

  const section = content.slice(startIdx + LEARNED_START.length, endIdx).trim();
  if (!section) return false;

  fs.writeFileSync(LEARNINGS_FILE, LEARNINGS_HEADER + section + '\n');

  const cleaned = content.slice(0, startIdx) + content.slice(endIdx + LEARNED_END.length);
  fs.writeFileSync(claudeMdPath, cleaned.replace(/\n{3,}/g, '\n\n').trim() + '\n');

  return true;
}

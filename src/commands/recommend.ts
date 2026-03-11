import chalk from 'chalk';
import ora from 'ora';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { collectFingerprint } from '../fingerprint/index.js';
import { scanLocalState } from '../scanner/index.js';

type Platform = 'claude' | 'cursor';

interface SkillResult {
  name: string;
  slug: string;
  source_url: string;
  score: number;
  reason: string;
  detected_technology: string;
  item_type?: string;
}

function detectLocalPlatforms(): Platform[] {
  const items = scanLocalState(process.cwd());
  const platforms = new Set<Platform>();
  for (const item of items) {
    platforms.add(item.platform);
  }
  return platforms.size > 0 ? Array.from(platforms) : ['claude'];
}

function getSkillPath(platform: Platform, slug: string): string {
  if (platform === 'cursor') {
    return join('.cursor', 'skills', slug, 'SKILL.md');
  }
  return join('.claude', 'skills', slug, 'SKILL.md');
}

async function searchSkills(technologies: string[]): Promise<SkillResult[]> {
  const results: SkillResult[] = [];
  const seen = new Set<string>();

  for (const tech of technologies) {
    try {
      const resp = await fetch(`https://api.skills.sh/v1/search?q=${encodeURIComponent(tech)}&limit=10`);
      if (!resp.ok) continue;
      const data = await resp.json() as { skills?: Array<{ name: string; slug: string; repo: string; description?: string }> };
      if (!data.skills?.length) continue;

      for (const skill of data.skills) {
        if (seen.has(skill.slug)) continue;
        seen.add(skill.slug);
        results.push({
          name: skill.name,
          slug: skill.slug,
          source_url: skill.repo,
          score: 0,
          reason: skill.description || '',
          detected_technology: tech,
          item_type: 'skill',
        });
      }
    } catch {
      continue;
    }
  }

  return results;
}

function extractTopDeps(): string[] {
  const pkgPath = join(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return Object.keys(pkg.dependencies ?? {});
  } catch {
    return [];
  }
}

export async function recommendCommand(options: {
  generate?: boolean;
  status?: string;
}) {
  const fingerprint = collectFingerprint(process.cwd());
  const platforms = detectLocalPlatforms();

  const technologies = [...new Set([
    ...fingerprint.languages,
    ...fingerprint.frameworks,
    ...extractTopDeps(),
  ].filter(Boolean))];

  if (technologies.length === 0) {
    console.log(chalk.yellow('Could not detect any languages or dependencies. Try running from a project root.'));
    throw new Error('__exit__');
  }

  const spinner = ora('Searching for skills...').start();
  const results = await searchSkills(technologies);

  if (!results.length) {
    spinner.succeed('No skill recommendations found for your tech stack.');
    return;
  }

  spinner.succeed(`Found ${results.length} skill${results.length > 1 ? 's' : ''}`);

  const selected = await interactiveSelect(results);
  if (selected?.length) {
    await installSkills(selected, platforms);
  }
}

async function interactiveSelect(recs: SkillResult[]): Promise<SkillResult[] | null> {
  if (!process.stdin.isTTY) {
    printRecommendations(recs);
    return null;
  }

  const selected = new Set<number>();
  let cursor = 0;
  const { stdin, stdout } = process;
  let lineCount = 0;

  function render(): string {
    const lines: string[] = [];
    lines.push(chalk.bold('  Recommendations'));
    lines.push('');
    lines.push(`  ${chalk.dim('Name'.padEnd(30))} ${chalk.dim('Technology'.padEnd(18))} ${chalk.dim('Source')}`);
    lines.push(chalk.dim('  ' + '─'.repeat(70)));

    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      const check = selected.has(i) ? chalk.green('[x]') : '[ ]';
      const ptr = i === cursor ? chalk.cyan('❯') : ' ';
      lines.push(`  ${ptr} ${check} ${rec.name.padEnd(28)} ${rec.detected_technology.padEnd(16)} ${chalk.dim(rec.source_url || '')}`);
    }

    lines.push('');
    lines.push(chalk.dim('  ↑↓ navigate  ⎵ toggle  a all  n none  ⏎ install  q cancel'));
    return lines.join('\n');
  }

  function draw(initial: boolean) {
    if (!initial && lineCount > 0) {
      stdout.write(`\x1b[${lineCount}A`);
    }
    stdout.write('\x1b[0J');
    const output = render();
    stdout.write(output + '\n');
    lineCount = output.split('\n').length;
  }

  return new Promise((resolve) => {
    console.log('');
    draw(true);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function onData(key: string) {
      switch (key) {
        case '\x1b[A':
          cursor = (cursor - 1 + recs.length) % recs.length;
          draw(false);
          break;
        case '\x1b[B':
          cursor = (cursor + 1) % recs.length;
          draw(false);
          break;
        case ' ':
          selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor);
          draw(false);
          break;
        case 'a':
          recs.forEach((_, i) => selected.add(i));
          draw(false);
          break;
        case 'n':
          selected.clear();
          draw(false);
          break;
        case '\r':
        case '\n':
          cleanup();
          if (selected.size === 0) {
            console.log(chalk.dim('\n  No skills selected.\n'));
            resolve(null);
          } else {
            resolve(Array.from(selected).sort().map(i => recs[i]));
          }
          break;
        case 'q':
        case '\x1b':
        case '\x03':
          cleanup();
          console.log(chalk.dim('\n  Cancelled.\n'));
          resolve(null);
          break;
      }
    }

    stdin.on('data', onData);
  });
}

async function fetchSkillContent(rec: SkillResult): Promise<string | null> {
  if (rec.source_url && rec.slug) {
    try {
      const url = `https://raw.githubusercontent.com/${rec.source_url}/HEAD/skills/${rec.slug}/SKILL.md`;
      const resp = await fetch(url);
      if (resp.ok) return await resp.text();
    } catch {}
  }

  return null;
}

async function installSkills(recs: SkillResult[], platforms: Platform[]): Promise<void> {
  const spinner = ora(`Installing ${recs.length} skill${recs.length > 1 ? 's' : ''}...`).start();

  const installed: string[] = [];
  const warnings: string[] = [];

  for (const rec of recs) {
    const content = await fetchSkillContent(rec);

    if (!content) {
      warnings.push(`No content available for ${rec.name}`);
      continue;
    }

    for (const platform of platforms) {
      const skillPath = getSkillPath(platform, rec.slug);
      const fullPath = join(process.cwd(), skillPath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content, 'utf-8');
      installed.push(`[${platform}] ${skillPath}`);
    }
  }

  if (installed.length > 0) {
    spinner.succeed(`Installed ${installed.length} file${installed.length > 1 ? 's' : ''}`);
    for (const p of installed) {
      console.log(chalk.green(`  ✓ ${p}`));
    }
  } else {
    spinner.fail('No skills were installed');
  }

  for (const w of warnings) {
    console.log(chalk.yellow(`  ⚠ ${w}`));
  }

  console.log('');
}

function printRecommendations(recs: SkillResult[]) {
  console.log(chalk.bold('\n  Recommendations\n'));
  console.log(
    `  ${chalk.dim('Name'.padEnd(30))} ${chalk.dim('Technology'.padEnd(18))} ${chalk.dim('Source')}`
  );
  console.log(chalk.dim('  ' + '─'.repeat(70)));

  for (const rec of recs) {
    console.log(
      `  ${rec.name.padEnd(28)} ${rec.detected_technology.padEnd(16)} ${chalk.dim(rec.source_url || '')}`
    );
    if (rec.reason) {
      console.log(`  ${chalk.dim('  ' + rec.reason)}`);
    }
  }
  console.log('');
}

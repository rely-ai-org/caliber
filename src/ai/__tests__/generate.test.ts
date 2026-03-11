import { describe, it, expect } from 'vitest';
import { buildGeneratePrompt } from '../generate.js';
import type { Fingerprint } from '../../fingerprint/index.js';

function makeFingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    languages: [],
    frameworks: [],
    fileTree: [],
    existingConfigs: {},
    ...overrides,
  };
}

describe('buildGeneratePrompt', () => {
  it('says "Generate initial" when no existing configs', () => {
    const prompt = buildGeneratePrompt(makeFingerprint(), 'claude');
    expect(prompt).toContain('Generate an initial coding agent configuration');
    expect(prompt).toContain('target: claude');
  });

  it('says "Audit and improve" when existing configs present', () => {
    const fp = makeFingerprint({
      existingConfigs: { claudeMd: '# My Project' },
    });
    const prompt = buildGeneratePrompt(fp, 'both');
    expect(prompt).toContain('Audit and improve the existing');
    expect(prompt).toContain('target: both');
  });

  it('includes git remote, languages, frameworks', () => {
    const fp = makeFingerprint({
      gitRemoteUrl: 'https://github.com/test/repo',
      languages: ['TypeScript', 'Python'],
      frameworks: ['Next.js', 'FastAPI'],
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('Git remote: https://github.com/test/repo');
    expect(prompt).toContain('Languages: TypeScript, Python');
    expect(prompt).toContain('Frameworks: Next.js, FastAPI');
  });

  it('includes package name and description', () => {
    const fp = makeFingerprint({
      packageName: 'my-app',
      description: 'A cool app',
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('Package name: my-app');
    expect(prompt).toContain('Project description: A cool app');
  });

  it('truncates file tree to 200 entries', () => {
    const fileTree = Array.from({ length: 300 }, (_, i) => `src/file-${i}.ts`);
    const fp = makeFingerprint({ fileTree });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('200/300');
    expect(prompt).toContain('file-0.ts');
    expect(prompt).toContain('file-199.ts');
    expect(prompt).not.toContain('file-200.ts');
  });

  it('truncates CLAUDE.md content to 8000 chars', () => {
    const longContent = 'x'.repeat(10000);
    const fp = makeFingerprint({
      existingConfigs: { claudeMd: longContent },
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('truncated at 8000 chars');
    expect(prompt).not.toContain('x'.repeat(10000));
  });

  it('truncates README.md content to 8000 chars', () => {
    const longContent = 'r'.repeat(10000);
    const fp = makeFingerprint({
      existingConfigs: { readmeMd: longContent },
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('truncated at 8000 chars');
  });

  it('limits skills to 10 and each to 3000 chars', () => {
    const skills = Array.from({ length: 15 }, (_, i) => ({
      filename: `skill-${i}.md`,
      content: `s${i}-${'y'.repeat(4000)}`,
    }));
    const fp = makeFingerprint({
      existingConfigs: { claudeSkills: skills },
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('skill-0.md');
    expect(prompt).toContain('skill-9.md');
    expect(prompt).not.toContain('skill-10.md');
    expect(prompt).toContain('5 more skills omitted');
    expect(prompt).toContain('truncated at 3000 chars');
  });

  it('limits cursor rules to 10', () => {
    const rules = Array.from({ length: 12 }, (_, i) => ({
      filename: `rule-${i}.mdc`,
      content: `Rule ${i} content`,
    }));
    const fp = makeFingerprint({
      existingConfigs: { cursorRules: rules },
    });
    const prompt = buildGeneratePrompt(fp, 'cursor');
    expect(prompt).toContain('rule-9.mdc');
    expect(prompt).not.toContain('rule-10.mdc');
    expect(prompt).toContain('2 more rules omitted');
  });

  it('limits config files to 15', () => {
    const configFiles = Array.from({ length: 20 }, (_, i) => ({
      path: `config-${i}.json`,
      content: `{"index": ${i}}`,
    }));
    const fp = makeFingerprint({
      codeAnalysis: {
        configFiles,
        fileSummaries: [],
        truncated: false,
      },
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('config-0.json');
    expect(prompt).toContain('config-14.json');
    expect(prompt).not.toContain('config-15.json');
  });

  it('limits API routes to 50', () => {
    const fileSummaries = [{
      path: 'src/routes.ts',
      language: 'ts' as const,
      imports: [],
      exports: [],
      functions: [],
      classes: [],
      types: [],
      routes: Array.from({ length: 60 }, (_, i) => `GET /api/route-${i}`),
    }];
    const fp = makeFingerprint({
      codeAnalysis: { configFiles: [], fileSummaries, truncated: false },
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('route-0');
    expect(prompt).toContain('route-49');
    expect(prompt).not.toContain('route-50');
    expect(prompt).toContain('10 more routes omitted');
  });

  it('limits file summaries to 60 and caps imports/exports at 10', () => {
    const fileSummaries = Array.from({ length: 70 }, (_, i) => ({
      path: `src/file-${i}.ts`,
      language: 'ts' as const,
      imports: Array.from({ length: 15 }, (_, j) => `import-${j}`),
      exports: Array.from({ length: 15 }, (_, j) => `export-${j}`),
      functions: Array.from({ length: 15 }, (_, j) => `fn-${j}`),
      classes: [],
      types: Array.from({ length: 15 }, (_, j) => `Type${j}`),
      routes: [],
    }));
    const fp = makeFingerprint({
      codeAnalysis: { configFiles: [], fileSummaries, truncated: false },
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('file-0.ts');
    expect(prompt).toContain('file-59.ts');
    expect(prompt).not.toContain('file-60.ts');
    expect(prompt).toContain('10 more files omitted');
    // Check that imports are capped at 10
    expect(prompt).toContain('import-9');
    expect(prompt).not.toContain('import-10');
  });

  it('includes user instructions', () => {
    const prompt = buildGeneratePrompt(makeFingerprint(), 'claude', 'Focus on testing');
    expect(prompt).toContain('User instructions: Focus on testing');
  });

  it('marks truncated code analysis', () => {
    const fp = makeFingerprint({
      codeAnalysis: { configFiles: [], fileSummaries: [], truncated: true },
    });
    const prompt = buildGeneratePrompt(fp, 'claude');
    expect(prompt).toContain('Code analysis was truncated');
  });
});

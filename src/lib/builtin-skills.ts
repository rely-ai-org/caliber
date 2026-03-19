import fs from 'fs';
import path from 'path';

export function buildSkillContent(skill: { name: string; description: string; content: string }): string {
  const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`;
  return frontmatter + skill.content;
}

export const FIND_SKILLS_SKILL = {
  name: 'find-skills',
  description:
    "Discovers and installs community skills from the public registry. " +
    "Use when the user mentions a technology, framework, or task that could benefit from specialized skills not yet installed, " +
    "asks 'how do I do X', 'find a skill for X', or starts work in a new technology area. " +
    "Proactively suggest when the user's task involves tools or frameworks without existing skills.",
  content: `# Find Skills

Search the public skill registry for community-contributed skills
relevant to the user's current task and install them into this project.

## Instructions

1. Identify the key technologies, frameworks, or task types from the
   user's request that might have community skills available
2. Ask the user: "Would you like me to search for community skills
   for [identified technologies]?"
3. If the user agrees, run:
   \`\`\`bash
   caliber skills --query "<relevant terms>"
   \`\`\`
   This outputs the top 5 matching skills with scores and descriptions.
4. Present the results to the user and ask which ones to install
5. Install the selected skills:
   \`\`\`bash
   caliber skills --install <slug1>,<slug2>
   \`\`\`
6. Read the installed SKILL.md files to load them into your current
   context so you can use them immediately in this session
7. Summarize what was installed and continue with the user's task

## Examples

User: "let's build a web app using React"
-> "I notice you want to work with React. Would you like me to search
   for community skills that could help with React development?"
-> If yes: run \`caliber skills --query "react frontend"\`
-> Show the user the results, ask which to install
-> Run \`caliber skills --install <selected-slugs>\`
-> Read the installed files and continue

User: "help me set up Docker for this project"
-> "Would you like me to search for Docker-related skills?"
-> If yes: run \`caliber skills --query "docker deployment"\`

User: "I need to write tests for this Python ML pipeline"
-> "Would you like me to find skills for Python ML testing?"
-> If yes: run \`caliber skills --query "python machine-learning testing"\`

## When NOT to trigger

- The user is working within an already well-configured area
- You already suggested skills for this technology in this session
- The user is in the middle of urgent debugging or time-sensitive work
- The technology is too generic (e.g. just "code" or "programming")
`,
};

export const SAVE_LEARNING_SKILL = {
  name: 'save-learning',
  description:
    "Saves user instructions as persistent learnings for future sessions. " +
    "Use when the user says 'remember this', 'always do X', 'from now on', 'never do Y', " +
    "or gives any instruction they want persisted across sessions. " +
    "Proactively suggest when the user states a preference, convention, or rule they clearly want followed in the future.",
  content: `# Save Learning

Save a user's instruction or preference as a persistent learning that
will be applied in all future sessions on this project.

## Instructions

1. Detect when the user gives an instruction to remember, such as:
   - "remember this", "save this", "always do X", "never do Y"
   - "from now on", "going forward", "in this project we..."
   - Any stated convention, preference, or rule
2. Refine the instruction into a clean, actionable learning bullet with
   an appropriate type prefix:
   - \`**[convention]**\` — coding style, workflow, git conventions
   - \`**[pattern]**\` — reusable code patterns
   - \`**[anti-pattern]**\` — things to avoid
   - \`**[preference]**\` — personal/team preferences
   - \`**[context]**\` — project-specific context
3. Show the refined learning to the user and ask for confirmation
4. If confirmed, run:
   \`\`\`bash
   caliber learn add "<refined learning>"
   \`\`\`
   For personal preferences (not project-level), add \`--personal\`:
   \`\`\`bash
   caliber learn add --personal "<refined learning>"
   \`\`\`
5. Stage the learnings file for the next commit:
   \`\`\`bash
   git add CALIBER_LEARNINGS.md
   \`\`\`

## Examples

User: "when developing features, push to next branch not master, remember it"
-> Refine: \`**[convention]** Push feature commits to the \\\`next\\\` branch, not \\\`master\\\`\`
-> "I'll save this as a project learning:
    **[convention]** Push feature commits to the \\\`next\\\` branch, not \\\`master\\\`
    Save for future sessions?"
-> If yes: run \`caliber learn add "**[convention]** Push feature commits to the next branch, not master"\`
-> Run \`git add CALIBER_LEARNINGS.md\`

User: "always use bun instead of npm"
-> Refine: \`**[preference]** Use \\\`bun\\\` instead of \\\`npm\\\` for package management\`
-> Confirm and save

User: "never use any in TypeScript, use unknown instead"
-> Refine: \`**[convention]** Use \\\`unknown\\\` instead of \\\`any\\\` in TypeScript\`
-> Confirm and save

## When NOT to trigger

- The user is giving a one-time instruction for the current task only
- The instruction is too vague to be actionable
- The user explicitly says "just for now" or "only this time"
`,
};

export const BUILTIN_SKILLS = [FIND_SKILLS_SKILL, SAVE_LEARNING_SKILL];

// Platform root dirs that indicate the platform is configured
const PLATFORM_CONFIGS: Array<{ platformDir: string; skillsDir: string }> = [
  { platformDir: '.claude', skillsDir: path.join('.claude', 'skills') },
  { platformDir: '.cursor', skillsDir: path.join('.cursor', 'skills') },
  { platformDir: '.agents', skillsDir: path.join('.agents', 'skills') },
];

export function ensureBuiltinSkills(): string[] {
  const written: string[] = [];

  for (const { platformDir, skillsDir } of PLATFORM_CONFIGS) {
    if (!fs.existsSync(platformDir)) continue;

    for (const skill of BUILTIN_SKILLS) {
      const skillPath = path.join(skillsDir, skill.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) continue;

      fs.mkdirSync(path.dirname(skillPath), { recursive: true });
      fs.writeFileSync(skillPath, buildSkillContent(skill));
      written.push(skillPath);
    }
  }

  return written;
}

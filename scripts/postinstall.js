const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const purple = (s) => `\x1b[38;5;99m${s}\x1b[0m`;

console.log('');
console.log(bold(purple('  Caliber installed successfully!')));
console.log('');
console.log(`  Get started:`);
console.log('');
console.log(`    ${bold('caliber config')}   ${dim('Set up LLM: Claude Code or Cursor (your seat), Anthropic, OpenAI, or Vertex')}`);
console.log(`    ${bold('caliber init')}   ${dim('Initialize your project for AI-assisted development')}`);
console.log('');
console.log(`  ${dim('Use your current seat: choose "Claude Code" or "Cursor" in caliber config (or set CALIBER_USE_CLAUDE_CLI=1 / CALIBER_USE_CURSOR_SEAT=1).')}`);
console.log(`  ${dim('Or set ANTHROPIC_API_KEY / OPENAI_API_KEY and run caliber init.')}`);
console.log('');

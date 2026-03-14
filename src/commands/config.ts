import chalk from 'chalk';
import { loadConfig, getConfigFilePath, getFastModel } from '../llm/config.js';
import { runInteractiveProviderSetup } from './interactive-provider-setup.js';

export async function configCommand() {
  const existing = loadConfig();

  if (existing) {
    const displayModel = existing.model === 'default' && existing.provider === 'claude-cli'
      ? process.env.ANTHROPIC_MODEL || 'default (inherited from Claude Code)'
      : existing.model;
    const fastModel = getFastModel();

    console.log(chalk.bold('\nCurrent Configuration\n'));
    console.log(`  Provider: ${chalk.cyan(existing.provider)}`);
    console.log(`  Model:    ${chalk.cyan(displayModel)}`);
    if (fastModel) {
      console.log(`  Scan:     ${chalk.cyan(fastModel)}`);
    }
    if (existing.apiKey) {
      const masked = existing.apiKey.slice(0, 8) + '...' + existing.apiKey.slice(-4);
      console.log(`  API Key:  ${chalk.dim(masked)}`);
    }
    if (existing.provider === 'cursor') {
      console.log(`  Seat:     ${chalk.dim('Cursor (agent acp)')}`);
    }
    if (existing.provider === 'claude-cli') {
      console.log(`  Seat:     ${chalk.dim('Claude Code (claude -p)')}`);
    }
    if (existing.baseUrl) {
      console.log(`  Base URL: ${chalk.dim(existing.baseUrl)}`);
    }
    if (existing.vertexProjectId) {
      console.log(`  Vertex Project: ${chalk.dim(existing.vertexProjectId)}`);
      console.log(`  Vertex Region:  ${chalk.dim(existing.vertexRegion || 'us-east5')}`);
    }
    console.log(`  Source:   ${chalk.dim(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.VERTEX_PROJECT_ID || process.env.CALIBER_USE_CURSOR_SEAT || process.env.CALIBER_USE_CLAUDE_CLI ? 'environment variables' : getConfigFilePath())}`);
    console.log('');
  }

  await runInteractiveProviderSetup();

  console.log(chalk.green('\n✓ Configuration saved'));
  console.log(chalk.dim(`  ${getConfigFilePath()}\n`));
  console.log(chalk.dim('  You can also set environment variables instead:'));
  console.log(chalk.dim('  ANTHROPIC_API_KEY, OPENAI_API_KEY, VERTEX_PROJECT_ID, CALIBER_USE_CURSOR_SEAT=1, or CALIBER_USE_CLAUDE_CLI=1\n'));
}

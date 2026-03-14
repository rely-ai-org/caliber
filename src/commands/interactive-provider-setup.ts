import chalk from 'chalk';
import readline from 'readline';
import select from '@inquirer/select';
import { writeConfigFile, DEFAULT_MODELS } from '../llm/config.js';
import type { ProviderType, LLMConfig } from '../llm/types.js';

function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(chalk.cyan(`${question} `), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const PROVIDER_CHOICES: Array<{ name: string; value: ProviderType }> = [
  { name: 'Claude Code — Use my Claude Code subscription', value: 'claude-cli' },
  { name: 'Cursor (use my Cursor subscription — no API key)', value: 'cursor' },
  { name: 'Anthropic (Claude) — API key from console.anthropic.com', value: 'anthropic' },
  { name: 'Google Vertex AI (Claude)', value: 'vertex' },
  { name: 'OpenAI / OpenAI-compatible', value: 'openai' },
];

/**
 * Interactive provider selection and setup. Prompts for provider choice and any
 * required inputs (API key, project ID, etc.), writes config to disk, and returns the config.
 * Used by both `caliber config` and by `caliber onboard` on first run (no config yet).
 */
export async function runInteractiveProviderSetup(options?: {
  selectMessage?: string;
}): Promise<LLMConfig> {
  const message = options?.selectMessage ?? 'Select LLM provider';
  const provider = await select<ProviderType>({
    message,
    choices: PROVIDER_CHOICES,
  });

  const config: LLMConfig = { provider, model: '' };

  switch (provider) {
    case 'claude-cli': {
      config.model = 'default';
      console.log(chalk.dim("  Run `claude` once and log in with your Pro/Max/Team account if you haven't."));
      break;
    }
    case 'cursor': {
      config.model = 'default';
      console.log(chalk.dim("  Run `agent login` if you haven't, or set CURSOR_API_KEY."));
      break;
    }
    case 'anthropic': {
      console.log(chalk.dim('  Get a key at https://console.anthropic.com (same account as Claude Pro/Team/Max).'));
      config.apiKey = await promptInput('Anthropic API key:');
      if (!config.apiKey) {
        console.log(chalk.red('API key is required.'));
        throw new Error('__exit__');
      }
      config.model = await promptInput(`Model (default: ${DEFAULT_MODELS.anthropic}):`) || DEFAULT_MODELS.anthropic;
      break;
    }
    case 'vertex': {
      config.vertexProjectId = await promptInput('GCP Project ID:');
      if (!config.vertexProjectId) {
        console.log(chalk.red('Project ID is required.'));
        throw new Error('__exit__');
      }
      config.vertexRegion = await promptInput('Region (default: us-east5):') || 'us-east5';
      config.vertexCredentials = await promptInput('Service account credentials JSON (or leave empty for ADC):') || undefined;
      config.model = await promptInput(`Model (default: ${DEFAULT_MODELS.vertex}):`) || DEFAULT_MODELS.vertex;
      break;
    }
    case 'openai': {
      config.apiKey = await promptInput('API key:');
      if (!config.apiKey) {
        console.log(chalk.red('API key is required.'));
        throw new Error('__exit__');
      }
      config.baseUrl = await promptInput('Base URL (leave empty for OpenAI, or enter custom endpoint):') || undefined;
      config.model = await promptInput(`Model (default: ${DEFAULT_MODELS.openai}):`) || DEFAULT_MODELS.openai;
      break;
    }
  }

  writeConfigFile(config);
  return config;
}

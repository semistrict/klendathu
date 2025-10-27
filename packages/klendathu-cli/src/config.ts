import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Configuration schema for klendathu
 */
export const ConfigSchema = z.object({
  /**
   * AI provider to use (anthropic, openai, google, etc.)
   */
  provider: z.string().default('claude-code'),

  /**
   * Model identifier (e.g., 'claude-3-5-sonnet-20241022', 'gpt-4o')
   */
  model: z.string().optional(),

  /**
   * Additional provider-specific options
   */
  options: z.record(z.unknown()).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Load configuration from file and environment variables
 *
 * Priority (highest to lowest):
 * 1. Environment variables (KLENDATHU_PROVIDER, KLENDATHU_MODEL)
 * 2. Local .klendathu.json
 * 3. Global ~/.klendathu.json
 * 4. Defaults
 */
export async function loadConfig(): Promise<Config> {
  let config: Partial<Config> = {};

  // Try to load global config
  try {
    const globalConfigPath = resolve(homedir(), '.klendathu.json');
    const globalContent = await readFile(globalConfigPath, 'utf-8');
    const globalConfig = JSON.parse(globalContent);
    config = { ...config, ...globalConfig };
  } catch {
    // No global config or invalid JSON, ignore
  }

  // Try to load local config
  try {
    const localConfigPath = resolve(process.cwd(), '.klendathu.json');
    const localContent = await readFile(localConfigPath, 'utf-8');
    const localConfig = JSON.parse(localContent);
    config = { ...config, ...localConfig };
  } catch {
    // No local config or invalid JSON, ignore
  }

  // Apply environment variable overrides
  if (process.env.KLENDATHU_PROVIDER) {
    config.provider = process.env.KLENDATHU_PROVIDER;
  }
  if (process.env.KLENDATHU_MODEL) {
    config.model = process.env.KLENDATHU_MODEL;
  }

  // Validate and apply defaults
  return ConfigSchema.parse(config);
}

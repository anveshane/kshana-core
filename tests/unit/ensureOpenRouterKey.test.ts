import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureOpenRouterApiKeyFromEnv } from '../../src/agent/pi/ensureOpenRouterKey.js';

const keys = [
  'OPENROUTER_API_KEY',
  'LLM_TIER_HEAVY_PROVIDER',
  'LLM_TIER_HEAVY_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const;

describe('ensureOpenRouterApiKeyFromEnv', () => {
  beforeEach(() => {
    for (const k of keys) delete process.env[k];
  });

  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it('copies LLM_TIER_HEAVY_API_KEY when tier provider is openrouter', () => {
    process.env['LLM_TIER_HEAVY_PROVIDER'] = 'openrouter';
    process.env['LLM_TIER_HEAVY_API_KEY'] = 'tier-secret';

    ensureOpenRouterApiKeyFromEnv();

    expect(process.env['OPENROUTER_API_KEY']).toBe('tier-secret');
  });

  it('mirrors OPENAI_API_KEY when base URL is OpenRouter and OPENROUTER_API_KEY unset', () => {
    process.env['OPENAI_BASE_URL'] = 'https://openrouter.ai/api/v1';
    process.env['OPENAI_API_KEY'] = 'sk-or-from-openai-slot';

    ensureOpenRouterApiKeyFromEnv();

    expect(process.env['OPENROUTER_API_KEY']).toBe('sk-or-from-openai-slot');
  });

  it('does not overwrite an existing OPENROUTER_API_KEY', () => {
    process.env['OPENROUTER_API_KEY'] = 'explicit-or';
    process.env['OPENAI_BASE_URL'] = 'https://openrouter.ai/api/v1';
    process.env['OPENAI_API_KEY'] = 'sk-or-from-openai-slot';

    ensureOpenRouterApiKeyFromEnv();

    expect(process.env['OPENROUTER_API_KEY']).toBe('explicit-or');
  });

  it('does not set OPENROUTER_API_KEY from OPENAI_API_KEY when base URL is not OpenRouter', () => {
    process.env['OPENAI_BASE_URL'] = 'https://api.openai.com/v1';
    process.env['OPENAI_API_KEY'] = 'sk-openai';

    ensureOpenRouterApiKeyFromEnv();

    expect(process.env['OPENROUTER_API_KEY']).toBeUndefined();
  });
});

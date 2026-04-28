/**
 * Tests for the OpenRouter provider-pinning helper.
 *
 * Why this exists: OpenRouter pools each model across many upstream
 * providers (DeepSeek, SiliconFlow, NovitaAI, DeepInfra, Together, …).
 * Latency and reliability vary 2-5x between them, and slow ones return
 * empty 0-char responses under load. Pinning the order eliminates the
 * lottery for models we know are flaky-by-default (DeepSeek today;
 * possibly other model families later).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveOpenRouterProvider } from '../../src/core/llm/openrouterProvider.js';

describe('resolveOpenRouterProvider', () => {
  const ENV_KEY = 'OPENROUTER_DEEPSEEK_PROVIDERS';
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prevEnv;
  });

  it('returns undefined when baseUrl is not openrouter.ai (e.g. LM Studio, Gemini)', () => {
    expect(resolveOpenRouterProvider({
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'deepseek-v3',
    })).toBeUndefined();
    expect(resolveOpenRouterProvider({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'deepseek-v3',
    })).toBeUndefined();
  });

  it('returns undefined for non-DeepSeek models on OpenRouter', () => {
    expect(resolveOpenRouterProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-haiku-4-5',
    })).toBeUndefined();
    expect(resolveOpenRouterProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'z-ai/glm-4.7-flash',
    })).toBeUndefined();
  });

  it('returns the default provider order for any DeepSeek model on OpenRouter', () => {
    const provider = resolveOpenRouterProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-v3.1',
    });
    expect(provider).toEqual({
      order: ['DeepSeek', 'SiliconFlow', 'NovitaAI'],
      allow_fallbacks: true,
    });
  });

  it('matches DeepSeek case-insensitively across naming variants', () => {
    for (const model of [
      'DeepSeek/DeepSeek-V3',
      'deepseek/deepseek-r1',
      'openrouter/deepseek-coder',
      'deepseek-v4',
    ]) {
      const provider = resolveOpenRouterProvider({
        baseUrl: 'https://openrouter.ai/api/v1',
        model,
      });
      expect(provider, `expected provider for ${model}`).toBeDefined();
      expect(provider!.order[0]).toBe('DeepSeek');
    }
  });

  it('honours OPENROUTER_DEEPSEEK_PROVIDERS env to override the order', () => {
    process.env[ENV_KEY] = 'NovitaAI,DeepSeek';
    const provider = resolveOpenRouterProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-v3.1',
    });
    expect(provider!.order).toEqual(['NovitaAI', 'DeepSeek']);
  });

  it('trims whitespace and drops empty entries in the env override', () => {
    process.env[ENV_KEY] = ' DeepSeek , , SiliconFlow , ';
    const provider = resolveOpenRouterProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-v3.1',
    });
    expect(provider!.order).toEqual(['DeepSeek', 'SiliconFlow']);
  });

  it('falls back to default when env is set but empty/whitespace-only', () => {
    process.env[ENV_KEY] = '   ,  ';
    const provider = resolveOpenRouterProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-v3.1',
    });
    expect(provider!.order).toEqual(['DeepSeek', 'SiliconFlow', 'NovitaAI']);
  });

  it('recognises any openrouter base URL (with or without trailing slash, http/https)', () => {
    for (const baseUrl of [
      'https://openrouter.ai/api/v1',
      'https://openrouter.ai/api/v1/',
      'http://openrouter.ai/api/v1',
    ]) {
      const provider = resolveOpenRouterProvider({ baseUrl, model: 'deepseek/v3' });
      expect(provider, `expected provider for baseUrl ${baseUrl}`).toBeDefined();
    }
  });
});

/**
 * Tests for LLMRouter — purpose→client routing with env-toggled overrides.
 */

import { describe, it, expect } from 'vitest';
import {
  LLMRouter,
  isRoutingEnabledFromEnv,
  loadRoutingFromEnv,
  sanitizeRoutingConfig,
  mergeRoutingConfigs,
  buildRouter,
  type LLMRoutingConfig,
} from '../../src/core/llm/router.js';
import {
  PURPOSE_TO_TIER,
  ALL_PURPOSES,
  tierOf,
  isLLMPurpose,
  isLLMTier,
} from '../../src/core/llm/purposes.js';
import type { LLMClientConfig } from '../../src/core/llm/types.js';

const DEFAULT: LLMClientConfig = {
  baseUrl: 'http://default.example/v1',
  apiKey: 'default-key',
  model: 'default-model',
};

// ── Purpose taxonomy ─────────────────────────────────────────────────────

describe('LLMPurpose taxonomy', () => {
  it('every purpose has a tier', () => {
    for (const p of ALL_PURPOSES) {
      expect(PURPOSE_TO_TIER[p], `purpose ${p} missing tier`).toMatch(/^(heavy|medium|light)$/);
    }
  });

  it('tierOf works for each purpose', () => {
    expect(tierOf('content.story')).toBe('heavy');
    expect(tierOf('structured.collection_extraction')).toBe('medium');
    expect(tierOf('utility.json_repair')).toBe('light');
  });

  it('isLLMPurpose type guard', () => {
    expect(isLLMPurpose('content.story')).toBe(true);
    expect(isLLMPurpose('utility.json_repair')).toBe(true);
    expect(isLLMPurpose('bogus.purpose')).toBe(false);
    expect(isLLMPurpose(123)).toBe(false);
    expect(isLLMPurpose(null)).toBe(false);
  });

  it('isLLMTier type guard', () => {
    expect(isLLMTier('heavy')).toBe(true);
    expect(isLLMTier('medium')).toBe(true);
    expect(isLLMTier('light')).toBe(true);
    expect(isLLMTier('ultra')).toBe(false);
    expect(isLLMTier(42)).toBe(false);
  });
});

// ── Pass-through mode (routing disabled) ────────────────────────────────

describe('LLMRouter: pass-through mode (disabled)', () => {
  it('every purpose returns the default config when disabled', () => {
    const router = new LLMRouter(DEFAULT, {}, false);
    expect(router.isEnabled()).toBe(false);
    for (const p of ALL_PURPOSES) {
      const resolved = router.resolveConfig(p);
      expect(resolved.baseUrl).toBe(DEFAULT.baseUrl);
      expect(resolved.model).toBe(DEFAULT.model);
      expect(resolved.apiKey).toBe(DEFAULT.apiKey);
    }
  });

  it('ignores routing config entirely when disabled', () => {
    const routing: LLMRoutingConfig = {
      tiers: { light: { baseUrl: 'http://should-not-use.example/v1', model: 'nope' } },
      purposes: { 'utility.json_repair': { model: 'also-nope' } },
    };
    const router = new LLMRouter(DEFAULT, routing, false);
    expect(router.resolveConfig('utility.json_repair').model).toBe(DEFAULT.model);
    expect(router.resolveConfig('content.story').model).toBe(DEFAULT.model);
  });
});

// ── Resolution chain (routing enabled) ──────────────────────────────────

describe('LLMRouter: resolution chain (purpose > tier > default)', () => {
  it('purpose override wins over tier', () => {
    const routing: LLMRoutingConfig = {
      tiers: { light: { model: 'tier-light-model' } },
      purposes: { 'utility.json_repair': { model: 'purpose-model' } },
    };
    const router = new LLMRouter(DEFAULT, routing, true);
    expect(router.resolveConfig('utility.json_repair').model).toBe('purpose-model');
  });

  it('tier override applies when no purpose override', () => {
    const routing: LLMRoutingConfig = {
      tiers: { light: { model: 'tier-light-model' } },
    };
    const router = new LLMRouter(DEFAULT, routing, true);
    expect(router.resolveConfig('utility.json_repair').model).toBe('tier-light-model');
    expect(router.resolveConfig('utility.metadata').model).toBe('tier-light-model');
    // Unaffected tier
    expect(router.resolveConfig('content.story').model).toBe(DEFAULT.model);
  });

  it('falls back to default when no overrides match purpose', () => {
    const routing: LLMRoutingConfig = {
      tiers: { heavy: { model: 'heavy-model' } },
    };
    const router = new LLMRouter(DEFAULT, routing, true);
    expect(router.resolveConfig('utility.json_repair').model).toBe(DEFAULT.model);
  });

  it('explicit default override applies when no tier/purpose match', () => {
    const routing: LLMRoutingConfig = {
      default: { model: 'override-default' },
    };
    const router = new LLMRouter(DEFAULT, routing, true);
    expect(router.resolveConfig('utility.json_repair').model).toBe('override-default');
  });

  it('partial override merges with defaults (apiKey kept, model swapped)', () => {
    const routing: LLMRoutingConfig = {
      purposes: { 'content.story': { model: 'opus' } }, // only model, no apiKey/baseUrl
    };
    const router = new LLMRouter(DEFAULT, routing, true);
    const resolved = router.resolveConfig('content.story');
    expect(resolved.model).toBe('opus');
    expect(resolved.apiKey).toBe(DEFAULT.apiKey); // inherited
    expect(resolved.baseUrl).toBe(DEFAULT.baseUrl); // inherited
  });
});

// ── Caching ──────────────────────────────────────────────────────────────

describe('LLMRouter: client caching', () => {
  it('two calls with same purpose return the same cached client', () => {
    const router = new LLMRouter(DEFAULT, {}, true);
    const a = router.getClient('utility.json_repair');
    const b = router.getClient('utility.json_repair');
    expect(a).toBe(b);
  });

  it('purposes that resolve to the same config share a cached client', () => {
    // Both utility.* purposes fall through to default when no overrides — same config, same cache key
    const router = new LLMRouter(DEFAULT, {}, true);
    const a = router.getClient('utility.json_repair');
    const b = router.getClient('utility.metadata');
    expect(a).toBe(b);
  });

  it('purposes with different resolved configs get different clients', () => {
    const routing: LLMRoutingConfig = {
      purposes: {
        'utility.json_repair': { model: 'model-a' },
        'utility.metadata': { model: 'model-b' },
      },
    };
    const router = new LLMRouter(DEFAULT, routing, true);
    const a = router.getClient('utility.json_repair');
    const b = router.getClient('utility.metadata');
    expect(a).not.toBe(b);
  });
});

// ── Env-var toggle parsing ──────────────────────────────────────────────

describe('isRoutingEnabledFromEnv', () => {
  it('truthy values enable routing', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on', ' true ', 'True']) {
      expect(isRoutingEnabledFromEnv({ LLM_ROUTING_ENABLED: v } as NodeJS.ProcessEnv), `value=${v}`).toBe(true);
    }
  });

  it('falsy / absent values leave routing disabled', () => {
    for (const v of ['false', 'no', 'off', '0', '', undefined]) {
      expect(isRoutingEnabledFromEnv({ LLM_ROUTING_ENABLED: v } as NodeJS.ProcessEnv), `value=${v}`).toBe(false);
    }
    expect(isRoutingEnabledFromEnv({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ── Env-var config loading ──────────────────────────────────────────────

describe('loadRoutingFromEnv', () => {
  it('returns empty config when no relevant env vars set', () => {
    const cfg = loadRoutingFromEnv({} as NodeJS.ProcessEnv);
    expect(cfg).toEqual({});
  });

  it('reads tier env vars', () => {
    const env = {
      LLM_TIER_LIGHT_PROVIDER: 'groq',
      LLM_TIER_LIGHT_API_KEY: 'gsk_test',
      LLM_TIER_LIGHT_MODEL: 'llama-3.3-70b',
    } as NodeJS.ProcessEnv;
    const cfg = loadRoutingFromEnv(env);
    expect(cfg.tiers?.light?.apiKey).toBe('gsk_test');
    expect(cfg.tiers?.light?.model).toBe('llama-3.3-70b');
    expect(cfg.tiers?.light?.baseUrl).toBe('https://api.groq.com/openai/v1'); // derived from provider
  });

  it('derives OpenRouter base URL from provider name', () => {
    const env = {
      LLM_TIER_HEAVY_PROVIDER: 'openrouter',
      LLM_TIER_HEAVY_MODEL: 'x-ai/grok-4.1-fast',
      LLM_TIER_HEAVY_API_KEY: 'sk-or-test',
    } as NodeJS.ProcessEnv;
    const cfg = loadRoutingFromEnv(env);
    expect(cfg.tiers?.heavy?.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(cfg.tiers?.heavy?.model).toBe('x-ai/grok-4.1-fast');
  });

  it('respects explicit BASE_URL over derived provider URL', () => {
    const env = {
      LLM_TIER_HEAVY_PROVIDER: 'openai',
      LLM_TIER_HEAVY_BASE_URL: 'http://custom-proxy.local/v1',
      LLM_TIER_HEAVY_MODEL: 'gpt-5',
      LLM_TIER_HEAVY_API_KEY: 'sk-test',
    } as NodeJS.ProcessEnv;
    const cfg = loadRoutingFromEnv(env);
    expect(cfg.tiers?.heavy?.baseUrl).toBe('http://custom-proxy.local/v1');
  });

  it('reads per-purpose env vars (with double-underscore slug)', () => {
    const env = {
      LLM_PURPOSE__UTILITY__IMAGE_REVIEW_PROVIDER: 'google',
      LLM_PURPOSE__UTILITY__IMAGE_REVIEW_API_KEY: 'aiza_test',
      LLM_PURPOSE__UTILITY__IMAGE_REVIEW_MODEL: 'gemini-2.5-flash',
    } as NodeJS.ProcessEnv;
    const cfg = loadRoutingFromEnv(env);
    expect(cfg.purposes?.['utility.image_review']?.apiKey).toBe('aiza_test');
    expect(cfg.purposes?.['utility.image_review']?.model).toBe('gemini-2.5-flash');
  });
});

// ── File config loading / sanitization ──────────────────────────────────

describe('sanitizeRoutingConfig', () => {
  it('drops unknown tiers', () => {
    const cleaned = sanitizeRoutingConfig({
      tiers: {
        heavy: { model: 'x' },
        ultra: { model: 'y' }, // not a real tier
      },
    });
    expect(cleaned.tiers?.heavy).toBeDefined();
    // @ts-expect-error — ultra isn't a valid tier so it's dropped
    expect(cleaned.tiers?.ultra).toBeUndefined();
  });

  it('drops unknown purposes', () => {
    const cleaned = sanitizeRoutingConfig({
      purposes: {
        'content.story': { model: 'valid' },
        'bogus.purpose': { model: 'invalid' },
      },
    });
    expect(cleaned.purposes?.['content.story']).toBeDefined();
    expect((cleaned.purposes as Record<string, unknown>)?.['bogus.purpose']).toBeUndefined();
  });

  it('returns empty object on null/undefined input', () => {
    expect(sanitizeRoutingConfig(null)).toEqual({});
    expect(sanitizeRoutingConfig(undefined)).toEqual({});
    expect(sanitizeRoutingConfig('not an object')).toEqual({});
  });

  it('keeps default config block if present', () => {
    const cleaned = sanitizeRoutingConfig({ default: { model: 'd' } });
    expect(cleaned.default?.model).toBe('d');
  });
});

// ── Merging ──────────────────────────────────────────────────────────────

describe('mergeRoutingConfigs', () => {
  it('override values win over base values at each scope', () => {
    const base: LLMRoutingConfig = {
      default: { model: 'base-default' },
      tiers: { heavy: { model: 'base-heavy' } },
      purposes: { 'content.story': { model: 'base-story' } },
    };
    const override: LLMRoutingConfig = {
      default: { model: 'override-default' },
      tiers: { heavy: { model: 'override-heavy' } },
      purposes: { 'content.story': { model: 'override-story' } },
    };
    const merged = mergeRoutingConfigs(base, override);
    expect(merged.default?.model).toBe('override-default');
    expect(merged.tiers?.heavy?.model).toBe('override-heavy');
    expect(merged.purposes?.['content.story']?.model).toBe('override-story');
  });

  it('fields present only in base are preserved', () => {
    const base: LLMRoutingConfig = {
      tiers: { heavy: { apiKey: 'base-key', model: 'base-model' } },
    };
    const override: LLMRoutingConfig = {
      tiers: { heavy: { model: 'override-model' } }, // no apiKey
    };
    const merged = mergeRoutingConfigs(base, override);
    expect(merged.tiers?.heavy?.apiKey).toBe('base-key');
    expect(merged.tiers?.heavy?.model).toBe('override-model');
  });

  it('override-only tiers / purposes appear in the merged result', () => {
    const base: LLMRoutingConfig = {};
    const override: LLMRoutingConfig = {
      tiers: { light: { model: 'override-light' } },
    };
    const merged = mergeRoutingConfigs(base, override);
    expect(merged.tiers?.light?.model).toBe('override-light');
  });
});

// ── buildRouter (end-to-end, env-driven) ────────────────────────────────

describe('buildRouter', () => {
  it('returns a disabled router when LLM_ROUTING_ENABLED is false', () => {
    const router = buildRouter(DEFAULT, '/no/such/dir', {} as NodeJS.ProcessEnv);
    expect(router.isEnabled()).toBe(false);
  });

  it('returns an enabled router when LLM_ROUTING_ENABLED=true', () => {
    const router = buildRouter(
      DEFAULT,
      '/no/such/dir',
      { LLM_ROUTING_ENABLED: 'true' } as NodeJS.ProcessEnv,
    );
    expect(router.isEnabled()).toBe(true);
  });

  it('env vars populate tier overrides on an enabled router', () => {
    const router = buildRouter(DEFAULT, '/no/such/dir', {
      LLM_ROUTING_ENABLED: 'true',
      LLM_TIER_LIGHT_PROVIDER: 'groq',
      LLM_TIER_LIGHT_MODEL: 'llama-3.3-70b',
      LLM_TIER_LIGHT_API_KEY: 'gsk_test',
    } as NodeJS.ProcessEnv);
    const light = router.resolveConfig('utility.json_repair');
    expect(light.model).toBe('llama-3.3-70b');
    expect(light.apiKey).toBe('gsk_test');
    // Heavy tier untouched
    const heavy = router.resolveConfig('content.story');
    expect(heavy.model).toBe(DEFAULT.model);
  });
});

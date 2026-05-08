/**
 * Local-LLM routing — can the desktop's lmStudio / openai-compatible
 * settings actually drive `resolvePiSessionModel` to a local endpoint?
 *
 * The desktop's settings panel exposes four LLM provider choices:
 *   - openai      (OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL)
 *   - openrouter  (OPENROUTER_API_KEY + OPENROUTER_MODEL)
 *   - gemini      (GOOGLE_API_KEY + GEMINI_MODEL)
 *   - lmstudio    (LMSTUDIO_BASE_URL + LMSTUDIO_MODEL)   ← local-first
 *
 * `kshanaCoreManager.applyEnvFromSettings` translates each into env
 * vars. These tests exercise what `resolvePiSessionModel` actually
 * does with those env vars — the source of truth for which
 * provider the agent ends up calling.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePiSessionModel } from '../../src/agent/pi/PiSessionAgent.js';

const keys = [
  'LLM_PROVIDER',
  'LLM_CONTEXT_TOKENS',
  'LLM_MAX_TOKENS',
  'LLM_TIER_HEAVY_PROVIDER',
  'LLM_TIER_HEAVY_MODEL',
  'LLM_TIER_HEAVY_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'LMSTUDIO_BASE_URL',
  'LMSTUDIO_MODEL',
] as const;

const previous = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of keys) {
    previous.set(k, process.env[k]);
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of keys) {
    const v = previous.get(k);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  previous.clear();
});

describe('Local LLM routing', () => {
  // ── PATH A: openai-compatible proxy (LM Studio via OpenAI-compatible) ──
  // The intended way to point kshana at a local LM Studio: set
  // llmProvider: 'openai' in the desktop UI, openaiBaseUrl to LM
  // Studio's local URL, and a non-empty placeholder for openaiApiKey
  // (LM Studio doesn't validate it). This produces the proxy model.

  it('routes to a local LM Studio when env says openai-compatible with a local base URL and a placeholder key', () => {
    process.env['LLM_PROVIDER'] = 'openai';
    process.env['OPENAI_BASE_URL'] = 'http://127.0.0.1:1234/v1';
    process.env['OPENAI_API_KEY'] = 'lm-studio-placeholder';
    process.env['OPENAI_MODEL'] = 'qwen3';

    const model = resolvePiSessionModel();
    expect(model.api).toBe('openai-completions');
    expect(model.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(model.id).toBe('qwen3');
  });

  // ── GOTCHA #1: empty API key collapses the proxy path ──
  // The desktop's settings file (the one we inspected on this user's
  // machine) had `openaiApiKey: ''` — LM Studio doesn't need a key, so
  // users naturally leave it blank. But `openAiCompatibleProxyModel`
  // requires BOTH baseUrl AND apiKey to be present, so empty key →
  // proxy path is skipped → falls through to `getModel('openai', …)`
  // which targets api.openai.com. The agent then hits public OpenAI
  // and 401s instead of LM Studio.

  it('does NOT route to the local URL when openaiApiKey is empty (gotcha — local LM Studio is silently bypassed)', () => {
    process.env['LLM_PROVIDER'] = 'openai';
    process.env['OPENAI_BASE_URL'] = 'http://127.0.0.1:1234/v1';
    // OPENAI_API_KEY intentionally not set — mirrors the user's settings
    // file where openaiApiKey was the empty string.
    process.env['OPENAI_MODEL'] = 'qwen3';

    // Today this either returns undefined (getModel can't find 'qwen3'
    // under the 'openai' provider catalog) or returns a model whose
    // baseUrl is api.openai.com — never the local URL the user
    // configured. Either way: the local LM Studio path is dead.
    let model: ReturnType<typeof resolvePiSessionModel> | undefined;
    try {
      model = resolvePiSessionModel();
    } catch {
      // Throw is also a valid "not routed locally" outcome.
    }
    if (model) {
      expect(model.baseUrl).not.toBe('http://127.0.0.1:1234/v1');
    } else {
      // model resolution returned undefined — equally a failure mode.
      expect(model).toBeUndefined();
    }
  });

  // ── GOTCHA #2: LLM_PROVIDER='lmstudio' is unrecognized in kshana-core ──
  // The desktop sets LLM_PROVIDER=lmstudio (with LMSTUDIO_BASE_URL +
  // LMSTUDIO_MODEL) when the user picks that provider. But
  // `resolvePiSessionModel` has only `openai` and `openrouter` branches
  // — anything else falls through to the OpenRouter default. So the
  // "LM Studio" provider option in the settings panel is effectively
  // dead code on the kshana-core side: the env it sets is ignored.

  it('LLM_PROVIDER=lmstudio falls through to OpenRouter default — LMSTUDIO_BASE_URL is never read', () => {
    process.env['LLM_PROVIDER'] = 'lmstudio';
    process.env['LMSTUDIO_BASE_URL'] = 'http://127.0.0.1:1234';
    process.env['LMSTUDIO_MODEL'] = 'qwen3';

    const model = resolvePiSessionModel();
    expect(model.provider).toBe('openrouter');
    expect(model.id).toBe('deepseek/deepseek-v4-flash');
    // Proves LMSTUDIO_BASE_URL isn't on the resolution path at all.
    expect(model.baseUrl).not.toContain('127.0.0.1');
    expect(model.baseUrl).not.toContain('1234');
  });

  // ── Cloud-auth override path (sanity) ──
  // When the desktop is signed into Kshana Cloud, applyEnvFromSettings
  // forces LLM_PROVIDER=openai with the cloud token + cloud baseUrl,
  // ignoring the user's local LLM settings. The agent then routes
  // through the cloud — local LM Studio is bypassed regardless of
  // what's in the settings panel.

  it('cloud override env (KSHANA_CLOUD path) wins — local LM Studio settings have no effect once OPENAI_BASE_URL is the cloud URL', () => {
    // Mirrors what kshanaCoreManager writes when cloudAuth is present.
    process.env['LLM_PROVIDER'] = 'openai';
    process.env['LLM_CONTEXT_TOKENS'] = '160000';
    process.env['OPENAI_API_KEY'] = 'desktop-jwt';
    process.env['OPENAI_BASE_URL'] = 'https://kshana-website.example/openai/api/v1';
    process.env['OPENAI_MODEL'] = 'deepseek/deepseek-v4-flash';

    const model = resolvePiSessionModel();
    expect(model.baseUrl).toBe('https://kshana-website.example/openai/api/v1');
    expect(model.baseUrl).not.toContain('127.0.0.1');
  });
});

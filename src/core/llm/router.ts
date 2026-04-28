/**
 * LLMRouter — routes each LLM call to a provider/model based on its purpose.
 *
 * Behavior is gated by the `LLM_ROUTING_ENABLED` env var:
 *   - `false` (or unset): pass-through mode — every purpose resolves to the
 *     global default client. Zero behavior change from pre-router code.
 *   - `true`: honors per-purpose and per-tier overrides from env vars and
 *     (optionally) a `.llm-routing.json` file in the project root.
 *
 * Resolution order for a purpose P when enabled:
 *   1. `purposes[P]`         — explicit per-purpose override
 *   2. `tiers[tierOf(P)]`    — tier-level override (heavy/medium/light)
 *   3. global default        — existing `getLLMConfig()` result
 *
 * Cached: identical resolved configs share a single `LLMClient` instance so
 * we don't spin up a fresh OpenAI HTTP client for every call.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { LLMClient } from './LLMClient.js';
import { getLLMConfig } from './config.js';
import type { LLMClientConfig } from './types.js';
import type { LLMPurpose, LLMTier } from './purposes.js';
import { tierOf, isLLMPurpose, isLLMTier, ALL_PURPOSES } from './purposes.js';

// ── Config shape ────────────────────────────────────────────────────────

export interface LLMRoutingConfig {
  /** Explicit default override. If omitted, the router uses `envDefault`. */
  default?: Partial<LLMClientConfig>;
  /** Per-tier overrides (heavy/medium/light). */
  tiers?: Partial<Record<LLMTier, Partial<LLMClientConfig>>>;
  /** Per-purpose overrides — most specific, wins over tier. */
  purposes?: Partial<Record<LLMPurpose, Partial<LLMClientConfig>>>;
}

// ── Router ─────────────────────────────────────────────────────────────

export class LLMRouter {
  private readonly routing: LLMRoutingConfig;
  private readonly envDefault: LLMClientConfig;
  private readonly enabled: boolean;
  private readonly cache = new Map<string, LLMClient>();

  constructor(
    envDefault: LLMClientConfig,
    routing: LLMRoutingConfig = {},
    enabled: boolean = isRoutingEnabledFromEnv(),
  ) {
    this.envDefault = envDefault;
    this.routing = routing;
    this.enabled = enabled;
  }

  /** Whether per-call routing is active (toggle is on). */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Return an `LLMClient` configured for the given purpose.
   * When routing is disabled, always returns the default client.
   * Cached by resolved config JSON.
   */
  getClient(purpose: LLMPurpose): LLMClient {
    const resolved = this.resolveConfig(purpose);
    const cacheKey = `${resolved.baseUrl ?? ''}|${resolved.model ?? ''}|${resolved.apiKey ?? ''}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const client = new LLMClient(resolved);
    this.cache.set(cacheKey, client);
    return client;
  }

  /**
   * Resolve the merged config for a purpose. Exposed for testing and logging.
   */
  resolveConfig(purpose: LLMPurpose): LLMClientConfig {
    if (!this.enabled) {
      return { ...this.envDefault };
    }

    // Start with envDefault, layer routing.default, then tier, then purpose.
    const tierConfig = this.routing.tiers?.[tierOf(purpose)] ?? {};
    const purposeConfig = this.routing.purposes?.[purpose] ?? {};

    const merged: LLMClientConfig = {
      ...this.envDefault,
      ...(this.routing.default ?? {}),
      ...tierConfig,
      ...purposeConfig,
    };
    return merged;
  }
}

// ── Config loading ─────────────────────────────────────────────────────

/**
 * Read `LLM_ROUTING_ENABLED` from env. Truthy values: "true", "1", "yes", "on".
 */
export function isRoutingEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env['LLM_ROUTING_ENABLED'] ?? '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/**
 * Convert a purpose string like 'utility.image_review' to the env-var slug
 * form 'UTILITY__IMAGE_REVIEW' (dot → double-underscore, upper-cased).
 */
function purposeToEnvSlug(purpose: LLMPurpose): string {
  return purpose.toUpperCase().replace(/\./g, '__');
}

/**
 * Read a `Partial<LLMClientConfig>` from env vars with the given prefix.
 * Returns undefined if no relevant vars are set (keeps the config sparse).
 */
function readConfigFromEnv(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): Partial<LLMClientConfig> | undefined {
  const provider = env[`${prefix}_PROVIDER`];
  const apiKey = env[`${prefix}_API_KEY`];
  const model = env[`${prefix}_MODEL`];
  const baseUrl = env[`${prefix}_BASE_URL`];
  if (!provider && !apiKey && !model && !baseUrl) return undefined;

  // Provider name is advisory — it selects default baseUrl if baseUrl not given.
  // We reuse the OpenAI-compatible stack regardless; the caller can supply
  // baseUrl directly for non-default endpoints.
  const config: Partial<LLMClientConfig> = {};
  if (apiKey) config.apiKey = apiKey;
  if (model) config.model = model;
  if (baseUrl) config.baseUrl = baseUrl;
  if (provider && !baseUrl) {
    const providerBase = baseUrlForProvider(provider.toLowerCase());
    if (providerBase) config.baseUrl = providerBase;
  }
  return config;
}

/**
 * Map a provider name to a default OpenAI-compatible base URL.
 * Returns undefined for unknown / custom providers so caller must set baseUrl.
 */
function baseUrlForProvider(provider: string): string | undefined {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'google':
    case 'gemini':
      return 'https://generativelanguage.googleapis.com/v1beta/openai/';
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'xai':
      return 'https://api.x.ai/v1';
    case 'mistral':
      return 'https://api.mistral.ai/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'ollama':
      return 'http://localhost:11434/v1';
    case 'lmstudio':
      return 'http://127.0.0.1:1234/v1';
    case 'llamacpp':
      return 'http://127.0.0.1:8080/v1';
    default:
      return undefined;
  }
}

/**
 * Read routing config from the project directory's `.llm-routing.json` file.
 * Returns an empty object if the file is missing or malformed (with a
 * console warning on parse failure).
 */
export function loadRoutingFromFile(projectDir: string): LLMRoutingConfig {
  const path = join(projectDir, '.llm-routing.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return sanitizeRoutingConfig(parsed);
  } catch (err) {
    console.warn(`[LLMRouter] Failed to parse .llm-routing.json: ${(err as Error).message}`);
    return {};
  }
}

/**
 * Validate and shape-clean a routing config object loaded from disk or env.
 * Drops unknown purposes / tiers so they don't appear as keys in the resolved
 * config map. Does NOT verify provider reachability.
 */
export function sanitizeRoutingConfig(raw: unknown): LLMRoutingConfig {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: LLMRoutingConfig = {};

  if (r['default'] && typeof r['default'] === 'object') {
    out.default = r['default'] as Partial<LLMClientConfig>;
  }

  if (r['tiers'] && typeof r['tiers'] === 'object') {
    const tiers = r['tiers'] as Record<string, unknown>;
    const cleanTiers: Partial<Record<LLMTier, Partial<LLMClientConfig>>> = {};
    for (const [k, v] of Object.entries(tiers)) {
      if (isLLMTier(k) && v && typeof v === 'object') {
        cleanTiers[k] = v as Partial<LLMClientConfig>;
      }
    }
    if (Object.keys(cleanTiers).length > 0) out.tiers = cleanTiers;
  }

  if (r['purposes'] && typeof r['purposes'] === 'object') {
    const purposes = r['purposes'] as Record<string, unknown>;
    const cleanPurposes: Partial<Record<LLMPurpose, Partial<LLMClientConfig>>> = {};
    for (const [k, v] of Object.entries(purposes)) {
      if (isLLMPurpose(k) && v && typeof v === 'object') {
        cleanPurposes[k] = v as Partial<LLMClientConfig>;
      }
    }
    if (Object.keys(cleanPurposes).length > 0) out.purposes = cleanPurposes;
  }

  return out;
}

/**
 * Read routing config from env vars (tier + per-purpose).
 * Produces a config with only the fields that are present in env.
 */
export function loadRoutingFromEnv(env: NodeJS.ProcessEnv = process.env): LLMRoutingConfig {
  const out: LLMRoutingConfig = {};

  // Tier overrides
  const tiers: Partial<Record<LLMTier, Partial<LLMClientConfig>>> = {};
  for (const tier of ['heavy', 'medium', 'light'] as const) {
    const cfg = readConfigFromEnv(`LLM_TIER_${tier.toUpperCase()}`, env);
    if (cfg) tiers[tier] = cfg;
  }
  if (Object.keys(tiers).length > 0) out.tiers = tiers;

  // Per-purpose overrides — iterate all purposes and check env for each
  const purposes: Partial<Record<LLMPurpose, Partial<LLMClientConfig>>> = {};
  for (const purpose of ALL_PURPOSES) {
    const cfg = readConfigFromEnv(`LLM_PURPOSE__${purposeToEnvSlug(purpose)}`, env);
    if (cfg) purposes[purpose] = cfg;
  }
  if (Object.keys(purposes).length > 0) out.purposes = purposes;

  return out;
}

/**
 * Deep-merge two routing configs. `override` wins over `base`.
 */
export function mergeRoutingConfigs(
  base: LLMRoutingConfig,
  override: LLMRoutingConfig,
): LLMRoutingConfig {
  const merged: LLMRoutingConfig = {
    default: { ...(base.default ?? {}), ...(override.default ?? {}) },
    tiers: {},
    purposes: {},
  };

  // Merge tiers
  const allTiers = new Set<LLMTier>([
    ...(Object.keys(base.tiers ?? {}) as LLMTier[]),
    ...(Object.keys(override.tiers ?? {}) as LLMTier[]),
  ]);
  for (const t of allTiers) {
    merged.tiers![t] = { ...(base.tiers?.[t] ?? {}), ...(override.tiers?.[t] ?? {}) };
  }
  if (Object.keys(merged.tiers!).length === 0) delete merged.tiers;

  // Merge purposes
  const allPurposes = new Set<LLMPurpose>([
    ...(Object.keys(base.purposes ?? {}) as LLMPurpose[]),
    ...(Object.keys(override.purposes ?? {}) as LLMPurpose[]),
  ]);
  for (const p of allPurposes) {
    merged.purposes![p] = { ...(base.purposes?.[p] ?? {}), ...(override.purposes?.[p] ?? {}) };
  }
  if (Object.keys(merged.purposes!).length === 0) delete merged.purposes;

  if (!merged.default || Object.keys(merged.default).length === 0) delete merged.default;
  return merged;
}

/**
 * Build a router using `getLLMConfig()` for the default and the standard
 * env / file sources for overrides. This is the convenience path for
 * callers (ExecutorAgent, GenericAgent, etc.) that don't have a specific
 * LLMClientConfig in hand.
 */
export function buildRouterFromEnv(projectDir: string): LLMRouter {
  return buildRouter(getLLMConfig(), projectDir);
}

/**
 * Build a router from the standard sources: env vars + optional config file +
 * env `LLM_ROUTING_ENABLED` toggle. The `envDefault` argument is the fallback
 * client config used when no overrides match (typically from `getLLMConfig()`).
 */
export function buildRouter(
  envDefault: LLMClientConfig,
  projectDir: string,
  env: NodeJS.ProcessEnv = process.env,
): LLMRouter {
  const enabled = isRoutingEnabledFromEnv(env);
  if (!enabled) {
    return new LLMRouter(envDefault, {}, false);
  }

  // File values first, then env overrides (env wins)
  const fileConfig = loadRoutingFromFile(projectDir);
  const envConfig = loadRoutingFromEnv(env);
  const merged = mergeRoutingConfigs(fileConfig, envConfig);

  // Warn if routing is enabled but no overrides configured
  const noOverrides =
    !merged.default &&
    (!merged.tiers || Object.keys(merged.tiers).length === 0) &&
    (!merged.purposes || Object.keys(merged.purposes).length === 0);
  if (noOverrides) {
    console.warn(
      '[LLMRouter] LLM_ROUTING_ENABLED=true but no tier/purpose overrides configured — all calls will fall back to the default client.',
    );
  }

  return new LLMRouter(envDefault, merged, true);
}

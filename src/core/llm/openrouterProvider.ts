/**
 * OpenRouter "provider preferences" helper.
 *
 * OpenRouter routes each model across many upstream providers (DeepSeek,
 * SiliconFlow, NovitaAI, DeepInfra, Together, Fireworks, …). Two
 * problems we hit in practice:
 *   1. Latency varies 2-5x between providers; the routing dice can land
 *      on a slow upstream and stall the pipeline for minutes per call.
 *   2. Some upstreams stream-close early on long DeepSeek prompts,
 *      returning an empty `content: ""` that fails our JSON repair loop.
 *
 * This helper returns the OpenRouter `provider` object to attach to a
 * request body for models we know need pinning (today: DeepSeek). For
 * everything else it returns undefined so unrelated routes are
 * unaffected.
 *
 * Spec: https://openrouter.ai/docs/features/provider-routing
 */

export interface OpenRouterProviderPref {
  /** Try these providers in order; fall back to OpenRouter's default
   *  pool only if all of them fail and `allow_fallbacks` is true. */
  order: string[];
  /** When true (default), OpenRouter falls back to other providers
   *  beyond `order` if every pinned one fails. We default to true to
   *  preserve resilience — if every preferred provider is down, a
   *  slower-but-working completion beats no completion. */
  allow_fallbacks: boolean;
}

const DEFAULT_DEEPSEEK_ORDER = ['DeepSeek', 'SiliconFlow', 'NovitaAI'];

function isOpenRouterBaseUrl(baseUrl: string): boolean {
  // Tolerate trailing slashes and http/https; the host check is what matters.
  try {
    const url = new URL(baseUrl);
    return url.hostname.toLowerCase() === 'openrouter.ai';
  } catch {
    return false;
  }
}

function isDeepSeekModel(model: string): boolean {
  return /deepseek/i.test(model);
}

function parseProviderList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw) return fallback;
  const parts = raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return parts.length > 0 ? parts : fallback;
}

export interface ResolveOpts {
  baseUrl: string;
  model: string;
}

/**
 * Decide whether (and how) to pin upstream providers for this request.
 * Returns undefined when the request is not OpenRouter or the model
 * has no rules — caller should omit the `provider` field entirely in
 * that case.
 */
export function resolveOpenRouterProvider(opts: ResolveOpts): OpenRouterProviderPref | undefined {
  if (!isOpenRouterBaseUrl(opts.baseUrl)) return undefined;

  if (isDeepSeekModel(opts.model)) {
    return {
      order: parseProviderList(process.env['OPENROUTER_DEEPSEEK_PROVIDERS'], DEFAULT_DEEPSEEK_ORDER),
      allow_fallbacks: true,
    };
  }

  return undefined;
}

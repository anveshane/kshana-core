/**
 * `@mariozechner/pi-ai`'s `getModel("openrouter", …)` expects `OPENROUTER_API_KEY`.
 * Many setups use OpenAI-compatible env vars with OpenRouter:
 * `OPENAI_BASE_URL=https://openrouter.ai/api/v1` + `OPENAI_API_KEY` (sk-or-…).
 * Bridge those into `OPENROUTER_API_KEY` when the dedicated var is unset.
 */
function isOpenRouterHost(baseUrl: string | undefined): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    return new URL(baseUrl.trim()).hostname.toLowerCase() === 'openrouter.ai';
  } catch {
    return false;
  }
}

export function ensureOpenRouterApiKeyFromEnv(): void {
  const tierProvider = process.env['LLM_TIER_HEAVY_PROVIDER'];
  const tierKey = process.env['LLM_TIER_HEAVY_API_KEY']?.trim();
  if (tierProvider === 'openrouter' && tierKey && !process.env['OPENROUTER_API_KEY']?.trim()) {
    process.env['OPENROUTER_API_KEY'] = tierKey;
  }

  if (process.env['OPENROUTER_API_KEY']?.trim()) return;

  const openAiKey = process.env['OPENAI_API_KEY']?.trim();
  const openAiBase = process.env['OPENAI_BASE_URL']?.trim();
  if (openAiKey && isOpenRouterHost(openAiBase)) {
    process.env['OPENROUTER_API_KEY'] = openAiKey;
  }
}

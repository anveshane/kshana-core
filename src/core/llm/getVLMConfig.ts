/**
 * Read the dedicated VLM endpoint config from env.
 *
 * The VLM judge gets its own config block (VLM_PROVIDER, VLM_API_KEY,
 * VLM_MODEL, optional VLM_BASE_URL) so vision-model selection is
 * decoupled from the rest of the LLM routing system. Without this the
 * VLM call would resolve through `utility.image_review` →
 * `LLM_TIER_LIGHT_*`, sending images to whatever cheap text model the
 * user has set for the LIGHT tier — usually a non-vision model that
 * silently produces useless output.
 *
 * Returns null when any of the three required fields is missing. The
 * caller (executor / oversight) treats null as "skip VLM, log one
 * warning", not as "fail loudly" — the user might have toggled VLM on
 * but not yet configured a vision model.
 */

export interface VLMConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

const PROVIDER_DEFAULT_BASE_URL: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai/",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  groq: "https://api.groq.com/openai/v1",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  mistral: "https://api.mistral.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
  llamacpp: "http://127.0.0.1:8080/v1",
};

export function getVLMConfig(env: NodeJS.ProcessEnv = process.env): VLMConfig | null {
  const provider = env["VLM_PROVIDER"]?.trim();
  const apiKey = env["VLM_API_KEY"]?.trim();
  const model = env["VLM_MODEL"]?.trim();
  if (!provider || !apiKey || !model) return null;

  const baseUrl =
    env["VLM_BASE_URL"]?.trim() ||
    PROVIDER_DEFAULT_BASE_URL[provider.toLowerCase()] ||
    "";
  if (!baseUrl) {
    // Provider isn't in our default-base-url table and VLM_BASE_URL
    // wasn't supplied — caller has no usable endpoint. Treat same as
    // "missing" so the skip-with-warning path fires.
    return null;
  }
  return { provider, apiKey, model, baseUrl };
}

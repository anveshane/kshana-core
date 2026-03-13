/**
 * ModelSelector — manages model tiering for test execution.
 *
 * Supports local-first testing: use local LM Studio models for daily
 * testing (free, fast), cloud API only for golden flow validation.
 */

/**
 * Model tiers for test execution.
 * - local: LM Studio or other local inference (free, fast)
 * - cloud: Cloud API like OpenAI, Anthropic (paid, production-quality)
 */
export type ModelTier = 'local' | 'cloud';

/**
 * Configuration for a model endpoint.
 */
export interface ModelEndpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Configuration for the model selector.
 */
export interface ModelSelectorConfig {
  local?: ModelEndpoint;
  cloud?: ModelEndpoint;
}

/**
 * Default configurations for known providers.
 */
const DEFAULTS: Record<ModelTier, () => ModelEndpoint> = {
  local: () => ({
    baseUrl: process.env['LM_STUDIO_URL'] ?? 'http://localhost:1234/v1',
    apiKey: process.env['LM_STUDIO_API_KEY'] ?? 'lm-studio',
    model: process.env['LM_STUDIO_MODEL'] ?? 'local-model',
  }),
  cloud: () => ({
    baseUrl: process.env['LLM_BASE_URL'] ?? 'https://api.openai.com/v1',
    apiKey: process.env['LLM_API_KEY'] ?? '',
    model: process.env['LLM_MODEL'] ?? 'gpt-4o',
  }),
};

/**
 * Selects and configures model endpoints based on tier.
 */
export class ModelSelector {
  private config: ModelSelectorConfig;

  constructor(config?: ModelSelectorConfig) {
    this.config = config ?? {};
  }

  /**
   * Get the endpoint configuration for a given tier.
   */
  getEndpoint(tier: ModelTier): ModelEndpoint {
    const explicit = this.config[tier];
    if (explicit) return explicit;
    return DEFAULTS[tier]();
  }

  /**
   * Get the LLMClientConfig for a given tier.
   */
  getLLMConfig(tier: ModelTier): { baseUrl: string; apiKey: string; model: string } {
    return this.getEndpoint(tier);
  }

  /**
   * Determine the tier from environment or explicit override.
   * Checks MODEL_TIER env var, defaults to 'local'.
   */
  static resolveTier(override?: ModelTier): ModelTier {
    if (override) return override;
    const envTier = process.env['MODEL_TIER'] as ModelTier | undefined;
    if (envTier === 'local' || envTier === 'cloud') return envTier;
    return 'local';
  }

  /**
   * Check if a local model server is available.
   */
  static async isLocalAvailable(config?: ModelSelectorConfig): Promise<boolean> {
    const selector = new ModelSelector(config);
    const endpoint = selector.getEndpoint('local');

    try {
      const response = await fetch(`${endpoint.baseUrl}/models`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

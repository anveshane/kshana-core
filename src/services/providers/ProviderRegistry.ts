/**
 * ProviderRegistry - Manages generation providers and per-capability configuration.
 *
 * Each capability (image generation, image editing, video generation) can be
 * independently configured to use a different provider.
 */
import type { GenerationProvider, GenerationCapability } from './types.js';

/**
 * Per-capability provider configuration.
 */
export interface ProviderConfig {
  imageGeneration: string;
  imageEditing: string;
  videoGeneration: string;
}

/**
 * Default config: all capabilities use ComfyUI.
 */
const DEFAULT_CONFIG: ProviderConfig = {
  imageGeneration: 'comfyui',
  imageEditing: 'comfyui',
  videoGeneration: 'comfyui',
};

export class ProviderRegistry {
  private providers = new Map<string, GenerationProvider>();
  private config: ProviderConfig = { ...DEFAULT_CONFIG };

  /**
   * Register a provider. If a provider with the same ID exists, it is replaced.
   */
  register(provider: GenerationProvider): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Update the per-capability configuration.
   * Only provided fields are updated; others remain unchanged.
   */
  setConfig(partial: Partial<ProviderConfig>): void {
    if (partial.imageGeneration !== undefined) {
      this.config.imageGeneration = partial.imageGeneration;
    }
    if (partial.imageEditing !== undefined) {
      this.config.imageEditing = partial.imageEditing;
    }
    if (partial.videoGeneration !== undefined) {
      this.config.videoGeneration = partial.videoGeneration;
    }
  }

  /**
   * Get current configuration.
   */
  getConfig(): Readonly<ProviderConfig> {
    return { ...this.config };
  }

  /**
   * Get the provider configured for image generation.
   * Falls back to ComfyUI if the configured provider is unavailable.
   */
  getImageGenerator(): GenerationProvider | undefined {
    return this.resolveProvider('image_generation', this.config.imageGeneration);
  }

  /**
   * Get the provider configured for image editing.
   */
  getImageEditor(): GenerationProvider | undefined {
    return this.resolveProvider('image_editing', this.config.imageEditing);
  }

  /**
   * Get the provider configured for video generation.
   */
  getVideoGenerator(): GenerationProvider | undefined {
    return this.resolveProvider('video_generation', this.config.videoGeneration);
  }

  /**
   * List all registered providers with their capabilities and availability.
   */
  listProviders(): Array<{
    id: string;
    displayName: string;
    capabilities: GenerationCapability[];
    available: boolean;
  }> {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      displayName: p.displayName,
      capabilities: p.capabilities,
      available: p.isAvailable(),
    }));
  }

  /**
   * Get a specific provider by ID.
   */
  getProvider(id: string): GenerationProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Resolve a provider for a given capability, with fallback to comfyui.
   */
  private resolveProvider(
    capability: GenerationCapability,
    configuredId: string,
  ): GenerationProvider | undefined {
    // Try the configured provider
    const provider = this.providers.get(configuredId);
    if (provider && provider.capabilities.includes(capability) && provider.isAvailable()) {
      return provider;
    }

    // Fall back to comfyui
    if (configuredId !== 'comfyui') {
      const fallback = this.providers.get('comfyui');
      if (fallback && fallback.capabilities.includes(capability) && fallback.isAvailable()) {
        return fallback;
      }
    }

    return undefined;
  }
}

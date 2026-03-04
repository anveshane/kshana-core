/**
 * Video Generation Templates
 *
 * This module exports all built-in video generation templates
 * and provides utilities for template registration.
 */

import type { VideoTemplate } from '../core/templates/types.js';
import { TemplateRegistry } from '../core/templates/TemplateRegistry.js';

// Import all templates
import { narrativeTemplate } from './narrative.js';
import { documentaryTemplate } from './documentary.js';
import { shortTemplate } from './short.js';
import { infomercialTemplate } from './infomercial.js';
import { graphicNovelTemplate } from './graphicNovel.js';

// Export individual templates
export { narrativeTemplate } from './narrative.js';
export { documentaryTemplate } from './documentary.js';
export { shortTemplate } from './short.js';
export { infomercialTemplate } from './infomercial.js';
export { graphicNovelTemplate } from './graphicNovel.js';

/**
 * All built-in templates
 */
export const builtInTemplates: VideoTemplate[] = [
  narrativeTemplate,
  documentaryTemplate,
  shortTemplate,
  infomercialTemplate,
  graphicNovelTemplate,
];

/**
 * Template IDs for built-in templates
 */
export const TEMPLATE_IDS = {
  NARRATIVE: 'narrative',
  DOCUMENTARY: 'documentary',
  SHORT: 'short',
  INFOMERCIAL: 'infomercial',
  GRAPHIC_NOVEL: 'graphic_novel',
} as const;

export type BuiltInTemplateId = (typeof TEMPLATE_IDS)[keyof typeof TEMPLATE_IDS];

/**
 * Register all built-in templates with the registry
 */
export function registerBuiltInTemplates(registry?: TemplateRegistry): TemplateRegistry {
  const reg = registry || TemplateRegistry.getInstance();

  for (const template of builtInTemplates) {
    const result = reg.register(template);
    if (!result.valid) {
      console.error(`Failed to register template '${template.id}':`, result.errors);
    }
  }

  return reg;
}

/**
 * Get a template by ID from the default registry
 */
export function getTemplate(id: string): VideoTemplate | undefined {
  return TemplateRegistry.getInstance().get(id);
}

/**
 * Get a template by ID or throw
 */
export function getTemplateOrThrow(id: string): VideoTemplate {
  return TemplateRegistry.getInstance().getOrThrow(id);
}

/**
 * List all available template IDs
 */
export function listTemplateIds(): string[] {
  return TemplateRegistry.getInstance().listIds();
}

/**
 * List all templates with summary info
 */
export function listTemplates(): Array<{
  id: string;
  displayName: string;
  description: string;
}> {
  return TemplateRegistry.getInstance().getSummary();
}

/**
 * Auto-detect the best template for given content
 */
export function detectTemplate(content: string): {
  templateId: string;
  inputTypeId: string;
  confidence: number;
} | null {
  const registry = TemplateRegistry.getInstance();
  let bestMatch: { templateId: string; inputTypeId: string; confidence: number } | null = null;

  for (const template of registry.list()) {
    const inputTypeId = registry.detectInputType(template, content);
    if (inputTypeId) {
      const inputType = template.inputTypes.find((it: { id: string }) => it.id === inputTypeId);
      if (inputType) {
        // Calculate confidence based on detection pattern weights
        let confidence = 0.5; // Base confidence
        for (const pattern of inputType.detectionPatterns || []) {
          confidence += pattern.weight * 0.1;
        }
        confidence = Math.min(confidence, 1);

        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { templateId: template.id, inputTypeId, confidence };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Initialize the template system with all built-in templates
 */
export function initializeTemplates(): TemplateRegistry {
  const registry = TemplateRegistry.getInstance();

  // Only register if not already registered
  if (registry.listIds().length === 0) {
    registerBuiltInTemplates(registry);
  }

  return registry;
}

// Default export for convenience
export default {
  builtInTemplates,
  TEMPLATE_IDS,
  registerBuiltInTemplates,
  getTemplate,
  getTemplateOrThrow,
  listTemplateIds,
  listTemplates,
  detectTemplate,
  initializeTemplates,
};

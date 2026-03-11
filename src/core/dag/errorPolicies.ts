/**
 * Default error policies for different node types.
 *
 * These provide sensible defaults that can be overridden per-node.
 */

import type { ErrorPolicy, NodeResult, ValidationResult } from './types.js';

// =============================================================================
// DEFAULT POLICIES BY NODE TYPE
// =============================================================================

/**
 * Default error policy for D (deterministic) nodes.
 * Deterministic nodes should rarely fail — retry same input a couple times,
 * then ask user.
 */
export const DEFAULT_D_POLICY: ErrorPolicy = {
  maxRetries: 2,
  retryStrategy: 'same',
  onExhausted: 'ask_user',
};

/**
 * Default error policy for S (stochastic/LLM) nodes.
 * LLM nodes may produce wrong format — rephrase with error feedback.
 */
export const DEFAULT_S_POLICY: ErrorPolicy = {
  maxRetries: 3,
  retryStrategy: 'rephrase',
  onExhausted: 'ask_user',
};

/**
 * Default error policy for U (user-gate) nodes.
 * User gates don't fail in the traditional sense — they wait.
 */
export const DEFAULT_U_POLICY: ErrorPolicy = {
  maxRetries: 0,
  retryStrategy: 'same',
  onExhausted: 'ask_user',
};

/**
 * Error policy for image generation nodes.
 * External service (ComfyUI) may be temporarily down.
 */
export const IMAGE_GENERATION_POLICY: ErrorPolicy = {
  maxRetries: 3,
  retryStrategy: 'same',
  retryDelayMs: 10000,
  onExhausted: 'ask_user',
};

/**
 * Error policy for video generation nodes.
 * Similar to image but with longer delays.
 */
export const VIDEO_GENERATION_POLICY: ErrorPolicy = {
  maxRetries: 3,
  retryStrategy: 'same',
  retryDelayMs: 15000,
  onExhausted: 'ask_user',
};

/**
 * Error policy for entity extraction — critical node that shapes the DAG.
 */
export const ENTITY_EXTRACTION_POLICY: ErrorPolicy = {
  maxRetries: 3,
  retryStrategy: 'rephrase',
  onExhausted: 'ask_user',
};

/**
 * Error policy for nodes that can be safely skipped (non-critical).
 */
export const SKIPPABLE_POLICY: ErrorPolicy = {
  maxRetries: 2,
  retryStrategy: 'rephrase',
  onExhausted: 'micro_llm',
};

// =============================================================================
// COMMON VALIDATORS
// =============================================================================

/**
 * Validate that result content is valid JSON.
 */
export function validateJSON(result: NodeResult): ValidationResult {
  if (!result.content) {
    return { valid: false, error: 'No content in result' };
  }
  try {
    const data = JSON.parse(result.content);
    return { valid: true, data };
  } catch {
    return { valid: false, error: 'Result is not valid JSON' };
  }
}

/**
 * Validate that result content is non-empty.
 */
export function validateNonEmpty(result: NodeResult): ValidationResult {
  if (!result.content || result.content.trim().length === 0) {
    return { valid: false, error: 'Result content is empty' };
  }
  return { valid: true };
}

/**
 * Validate that result has an artifact path that exists.
 * Note: actual file existence check happens at runtime in the handler.
 */
export function validateArtifactPath(result: NodeResult): ValidationResult {
  if (!result.artifactPath) {
    return { valid: false, error: 'No artifact path in result' };
  }
  return { valid: true };
}

/**
 * Create a JSON schema validator for a specific shape.
 */
export function createJSONValidator(
  requiredFields: string[],
  arrayFields?: string[],
): (result: NodeResult) => ValidationResult {
  return (result: NodeResult): ValidationResult => {
    const jsonCheck = validateJSON(result);
    if (!jsonCheck.valid) return jsonCheck;

    const data = jsonCheck.data as Record<string, unknown>;

    for (const field of requiredFields) {
      if (!(field in data) || data[field] === null || data[field] === undefined) {
        return { valid: false, error: `Missing required field: "${field}"` };
      }
    }

    if (arrayFields) {
      for (const field of arrayFields) {
        if (!Array.isArray(data[field])) {
          return { valid: false, error: `Field "${field}" must be an array` };
        }
        if ((data[field] as unknown[]).length === 0) {
          return { valid: false, error: `Field "${field}" must be a non-empty array` };
        }
      }
    }

    return { valid: true, data };
  };
}

/**
 * Get the default error policy for a node type.
 */
export function getDefaultPolicy(type: 'D' | 'S' | 'U'): ErrorPolicy {
  switch (type) {
    case 'D': return { ...DEFAULT_D_POLICY };
    case 'S': return { ...DEFAULT_S_POLICY };
    case 'U': return { ...DEFAULT_U_POLICY };
  }
}

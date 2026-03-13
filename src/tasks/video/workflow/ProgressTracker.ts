/**
 * ProgressTracker - Computes heuristic project progress and ETA.
 * Pure-function module that reads project state and computes completion %.
 */

import type { ProjectFile, OperationType } from './types.js';
import { WorkflowPhase, PHASE_CONFIGS, countApprovedItems, getPhaseItems } from './types.js';
import type { HeuristicProgressData } from '../../../server/types.js';
import { getProviderRegistry } from '../../../services/providers/index.js';

// ============================================================================
// Phase Weights (% of total work for narrative template)
// ============================================================================

interface PhaseWeight {
  weight: number;
  operationType: OperationType;
}

const NARRATIVE_PHASE_WEIGHTS: Record<string, PhaseWeight> = {
  [WorkflowPhase.PLOT]: { weight: 2, operationType: 'content_generation' },
  [WorkflowPhase.STORY]: { weight: 3, operationType: 'content_generation' },
  [WorkflowPhase.CHARACTERS_SETTINGS]: { weight: 3, operationType: 'content_generation' },
  [WorkflowPhase.SCENES]: { weight: 4, operationType: 'content_generation' },
  [WorkflowPhase.CHARACTER_SETTING_IMAGES]: { weight: 8, operationType: 'image_generation' },
  [WorkflowPhase.SCENE_IMAGES]: { weight: 20, operationType: 'image_generation' },
  [WorkflowPhase.VIDEO]: { weight: 40, operationType: 'video_generation' },
  [WorkflowPhase.VIDEO_COMBINE]: { weight: 5, operationType: 'assembly' },
};

// Phases that process items individually (per-item approval)
const PER_ITEM_PHASES = new Set<string>([
  WorkflowPhase.CHARACTERS_SETTINGS,
  WorkflowPhase.SCENES,
  WorkflowPhase.CHARACTER_SETTING_IMAGES,
  WorkflowPhase.SCENE_IMAGES,
  WorkflowPhase.VIDEO,
]);

// ============================================================================
// Default Timing Estimates (ms) by Provider
// ============================================================================

const PROVIDER_DEFAULTS: Record<string, Record<OperationType, number>> = {
  comfyui: {
    content_generation: 15_000,
    image_generation: 50_000,
    image_editing: 150_000,
    video_generation: 600_000,
    assembly: 30_000,
  },
  google: {
    content_generation: 15_000,
    image_generation: 30_000,
    image_editing: 60_000,
    video_generation: 180_000,
    assembly: 30_000,
  },
  xai: {
    content_generation: 15_000,
    image_generation: 20_000,
    image_editing: 45_000,
    video_generation: 120_000,
    assembly: 30_000,
  },
};

// Fallback defaults (ComfyUI)
const FALLBACK_DEFAULTS = PROVIDER_DEFAULTS['comfyui']!;

/**
 * Get default timing estimates based on the active provider configuration.
 */
export function getDefaultTimingEstimates(): Record<OperationType, number> {
  try {
    const config = getProviderRegistry().getConfig();
    // Use the image generation provider as primary indicator
    const providerName = config.imageGeneration?.toLowerCase() ?? '';
    if (providerName.includes('google') || providerName.includes('gemini') || providerName.includes('veo')) {
      return { ...PROVIDER_DEFAULTS['google']! };
    }
    if (providerName.includes('xai') || providerName.includes('aurora') || providerName.includes('grok')) {
      return { ...PROVIDER_DEFAULTS['xai']! };
    }
    if (providerName.includes('comfyui') || providerName.includes('comfy')) {
      return { ...PROVIDER_DEFAULTS['comfyui']! };
    }
    // For video generation provider, override just that estimate
    const videoProvider = config.videoGeneration?.toLowerCase() ?? '';
    const defaults = { ...FALLBACK_DEFAULTS };
    if (videoProvider.includes('google') || videoProvider.includes('veo')) {
      defaults.video_generation = PROVIDER_DEFAULTS['google']!.video_generation;
    } else if (videoProvider.includes('xai')) {
      defaults.video_generation = PROVIDER_DEFAULTS['xai']!.video_generation;
    }
    return defaults;
  } catch {
    return { ...FALLBACK_DEFAULTS };
  }
}

/**
 * Get the phase weights for a project.
 * Non-narrative templates fall back to equal weights.
 */
function getPhaseWeights(project: ProjectFile): Record<string, PhaseWeight> {
  if (!project.templateId || project.templateId === 'narrative') {
    return NARRATIVE_PHASE_WEIGHTS;
  }
  // Non-narrative: equal weights across all phases
  const phaseKeys = Object.keys(project.phases);
  const weight = phaseKeys.length > 0 ? 85 / phaseKeys.length : 10;
  const weights: Record<string, PhaseWeight> = {};
  for (const key of phaseKeys) {
    weights[key] = { weight, operationType: 'content_generation' };
  }
  return weights;
}

/**
 * Estimate item count for phases where items aren't known yet.
 * Uses conservative defaults scaled by targetDuration.
 */
export function estimateItemCount(project: ProjectFile, phase: string): number {
  const duration = project.targetDuration ?? 60;
  const scale = duration / 60; // 1.0 for 60s video

  switch (phase) {
    case WorkflowPhase.CHARACTERS_SETTINGS:
    case WorkflowPhase.CHARACTER_SETTING_IMAGES:
      // ~4 characters + 2 settings for 60s
      return Math.ceil(6 * scale);
    case WorkflowPhase.SCENES:
    case WorkflowPhase.SCENE_IMAGES:
    case WorkflowPhase.VIDEO:
      // ~8 scenes for 60s
      return Math.ceil(8 * scale);
    default:
      return 1;
  }
}

/**
 * Get actual or estimated item count for a phase.
 */
function getItemCount(project: ProjectFile, phase: string): number {
  // Try to get actual count from countApprovedItems
  const phaseEnum = phase as WorkflowPhase;
  if (PHASE_CONFIGS[phaseEnum]) {
    const { total } = countApprovedItems(project, phaseEnum);
    if (total > 0) return total;
  }
  return estimateItemCount(project, phase);
}

/**
 * Get progress count for a phase.
 * Counts approved items as 1.0, in-progress/in_review items as 0.5.
 * Returns a fractional "effective completed" count for smoother progress.
 */
function getProgressCount(project: ProjectFile, phase: string): number {
  const phaseEnum = phase as WorkflowPhase;
  if (PHASE_CONFIGS[phaseEnum]) {
    const items = getPhaseItems(project, phaseEnum);
    let count = 0;
    for (const item of items) {
      if (item.status === 'approved') {
        count += 1;
      } else if (item.status === 'pending' || item.status === 'stale') {
        // pending and stale get no credit
        count += 0;
      } else {
        // in_review, regenerating, or any active status = partial credit
        count += 0.5;
      }
    }
    return count;
  }
  return 0;
}

/**
 * Get the effective average ms for an operation type.
 * Returns actual average if available, otherwise the default.
 */
export function getEstimateForOperationType(
  project: ProjectFile,
  opType: OperationType
): number {
  const heuristics = project.timingHeuristics;
  if (heuristics?.averages[opType]) {
    return heuristics.averages[opType]!.avgMs;
  }
  if (heuristics?.defaults[opType]) {
    return heuristics.defaults[opType]!;
  }
  return FALLBACK_DEFAULTS[opType];
}

/**
 * Record an operation timing and update the running average.
 * Returns the mutated project (caller should save).
 */
export function recordOperationTiming(
  project: ProjectFile,
  opType: OperationType,
  durationMs: number
): ProjectFile {
  if (!project.timingHeuristics) {
    project.timingHeuristics = {
      averages: {},
      defaults: getDefaultTimingEstimates(),
    };
  }

  const existing = project.timingHeuristics.averages[opType];
  if (existing) {
    existing.totalMs += durationMs;
    existing.count += 1;
    existing.avgMs = Math.round(existing.totalMs / existing.count);
  } else {
    project.timingHeuristics.averages[opType] = {
      totalMs: durationMs,
      count: 1,
      avgMs: Math.round(durationMs),
    };
  }

  return project;
}

/**
 * Build a human-readable operation description.
 */
function getCurrentOperation(project: ProjectFile, phase: string, phaseWeights: Record<string, PhaseWeight>): string {
  const phaseInfo = project.phases[phase];
  if (!phaseInfo || phaseInfo.status !== 'in_progress') return '';

  const phaseEnum = phase as WorkflowPhase;
  const config = PHASE_CONFIGS[phaseEnum];
  const displayName = config?.displayName ?? phase;

  if (PER_ITEM_PHASES.has(phase) && PHASE_CONFIGS[phaseEnum]) {
    const { approved, total } = countApprovedItems(project, phaseEnum);
    const estimated = total > 0 ? total : estimateItemCount(project, phase);
    const opType = phaseWeights[phase]?.operationType ?? 'content_generation';
    const opLabel = opType === 'image_generation' ? 'Generating image'
      : opType === 'video_generation' ? 'Generating video'
      : 'Processing item';
    return `${opLabel} ${approved + 1}/${estimated}`;
  }

  return `${displayName} in progress`;
}

/**
 * Main progress computation function.
 * Iterates phases, sums weighted completion, and computes ETA.
 */
export function computeProgress(project: ProjectFile): HeuristicProgressData {
  const phaseWeights = getPhaseWeights(project);
  const totalWeight = Object.values(phaseWeights).reduce((sum, pw) => sum + pw.weight, 0);

  let overallPercent = 0;
  let estimatedRemainingMs = 0;
  let currentPhase = project.currentPhase;
  let currentPhaseDisplayName = '';

  for (const [phaseId, phaseWeight] of Object.entries(phaseWeights)) {
    const phaseInfo = project.phases[phaseId];
    if (!phaseInfo) continue;

    const normalizedWeight = (phaseWeight.weight / totalWeight) * 100;

    if (phaseInfo.status === 'completed' || phaseInfo.status === 'skipped') {
      overallPercent += normalizedWeight;
      continue;
    }

    if (phaseInfo.status === 'in_progress') {
      currentPhase = phaseId;
      const phaseEnum = phaseId as WorkflowPhase;
      currentPhaseDisplayName = PHASE_CONFIGS[phaseEnum]?.displayName ?? phaseId;

      if (PER_ITEM_PHASES.has(phaseId)) {
        const total = getItemCount(project, phaseId);
        const approved = getProgressCount(project, phaseId);
        const fraction = total > 0 ? approved / total : 0;
        overallPercent += normalizedWeight * fraction;

        // ETA for remaining items in this phase
        const remainingItems = total - approved;
        const avgMs = getEstimateForOperationType(project, phaseWeight.operationType);
        estimatedRemainingMs += avgMs * remainingItems;
      } else {
        // Single-item phase in progress: assume 50%
        overallPercent += normalizedWeight * 0.5;
        const avgMs = getEstimateForOperationType(project, phaseWeight.operationType);
        estimatedRemainingMs += avgMs * 0.5;
      }
      continue;
    }

    // Pending phase — add full ETA
    if (phaseInfo.status === 'pending') {
      const itemCount = getItemCount(project, phaseId);
      const avgMs = getEstimateForOperationType(project, phaseWeight.operationType);
      estimatedRemainingMs += avgMs * itemCount;
    }
  }

  // Handle completed project
  if (project.currentPhase === WorkflowPhase.COMPLETED || project.currentPhase === 'completed') {
    overallPercent = 100;
    estimatedRemainingMs = 0;
    currentPhaseDisplayName = 'Completed';
  }

  // Clamp
  overallPercent = Math.min(100, Math.max(0, Math.round(overallPercent * 10) / 10));

  return {
    overallPercent,
    currentPhase,
    currentPhaseDisplayName: currentPhaseDisplayName || currentPhase,
    estimatedRemainingMs: estimatedRemainingMs > 0 ? Math.round(estimatedRemainingMs) : null,
    currentOperation: getCurrentOperation(project, currentPhase, phaseWeights),
  };
}

/**
 * Map tool names to operation types for timing tracking.
 */
export function toolToOperationType(toolName: string): OperationType | null {
  switch (toolName) {
    case 'generate_image':
      return 'image_generation';
    case 'edit_image':
      return 'image_editing';
    case 'generate_video':
    case 'generate_video_from_image':
      return 'video_generation';
    case 'assemble_from_timeline':
      return 'assembly';
    default:
      return null;
  }
}

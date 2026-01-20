/**
 * Legacy Workflow Definition
 * 
 * NOTE: This workflow is currently INACTIVE and not used in the codebase.
 * It is kept for potential future use if legacy story-first workflows are needed.
 * 
 * Phases:
 * 1. PLOT - Analyze input and create plot outline
 * 2. STORY - Generate full story from plot
 * 3. CHARACTERS_SETTINGS - Plan character and setting descriptions
 * 4. SCENES - Break story into visual scenes
 * 5. CHARACTER_SETTING_IMAGES - Generate reference images
 * 6. SCENE_IMAGES - Generate scene images
 * 7. VIDEO - Generate video clips
 * 8. VIDEO_COMBINE - Stitch videos together
 * 9. COMPLETED - Workflow complete
 */

import { WorkflowPhase, type PhaseConfig } from '../types.js';

/**
 * Legacy workflow phases in execution order.
 * These phases are NOT used in the active YouTube workflow.
 */
export const LEGACY_PHASES: WorkflowPhase[] = [
  WorkflowPhase.PLOT,
  WorkflowPhase.STORY,
  WorkflowPhase.CHARACTERS_SETTINGS,
  WorkflowPhase.SCENES,
  WorkflowPhase.CHARACTER_SETTING_IMAGES,
  WorkflowPhase.SCENE_IMAGES,
  WorkflowPhase.VIDEO,
  WorkflowPhase.VIDEO_COMBINE,
  WorkflowPhase.COMPLETED,
];

/**
 * Phase configurations for legacy workflow.
 * Only includes phases that exist in the legacy workflow.
 * 
 * NOTE: This is a placeholder. Full configs would be extracted from the original
 * PHASE_CONFIGS if legacy workflow is ever activated.
 */
export const LEGACY_PHASE_CONFIGS: Partial<Record<WorkflowPhase, PhaseConfig>> = {
  // Placeholder - would contain full configs if legacy workflow is activated
  // For now, this file exists but is not used
};

/**
 * Get the next phase in the legacy workflow.
 * Returns null if already at the last phase.
 * 
 * NOTE: This function is not currently used.
 */
export function getNextLegacyPhase(currentPhase: WorkflowPhase): WorkflowPhase | null {
  const currentIndex = LEGACY_PHASES.indexOf(currentPhase);
  
  if (currentIndex >= 0 && currentIndex < LEGACY_PHASES.length - 1) {
    return LEGACY_PHASES[currentIndex + 1];
  }
  
  return null;
}

/**
 * Check if a phase is part of the legacy workflow.
 * 
 * NOTE: This function is not currently used.
 */
export function isLegacyPhase(phase: WorkflowPhase): boolean {
  return LEGACY_PHASES.includes(phase);
}

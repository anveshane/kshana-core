/**
 * Workflow Manager
 * 
 * Central manager for workflow selection and phase transitions.
 * Currently, only YouTube workflow is active.
 */

import { WorkflowPhase, type InputType, type PhaseConfig, type ProjectFile } from '../types.js';
import { 
  YOUTUBE_PHASES, 
  getNextYouTubePhase, 
  isYouTubePhase, 
  getYouTubePhaseConfig 
} from './youtube-workflow.js';

/**
 * Workflow type identifier
 */
export type WorkflowType = 'youtube' | 'legacy';

/**
 * Get the active workflow type for a given input type.
 * Currently, always returns 'youtube' as it's the only active workflow.
 */
export function getActiveWorkflowType(inputType: InputType): WorkflowType {
  // For now, YouTube workflow is the only active workflow
  // All input types use YouTube workflow
  return 'youtube';
}

/**
 * Get the workflow phases for a given input type.
 * Currently, always returns YouTube phases.
 */
export function getWorkflowPhases(inputType: InputType): WorkflowPhase[] {
  const workflowType = getActiveWorkflowType(inputType);
  
  if (workflowType === 'youtube') {
    return YOUTUBE_PHASES;
  }
  
  // Legacy workflow would go here, but it's not active
  return YOUTUBE_PHASES; // Default to YouTube
}

/**
 * Get the next phase in the workflow for a given current phase and input type.
 * Returns null if already at the last phase or phase is not in the workflow.
 */
export function getNextPhase(
  currentPhase: WorkflowPhase,
  inputType: InputType
): WorkflowPhase | null {
  const workflowType = getActiveWorkflowType(inputType);
  
  if (workflowType === 'youtube') {
    return getNextYouTubePhase(currentPhase);
  }
  
  // Legacy workflow would go here, but it's not active
  return getNextYouTubePhase(currentPhase); // Default to YouTube
}

/**
 * Check if a phase is valid for the given workflow (input type).
 */
export function isValidPhaseForWorkflow(phase: WorkflowPhase, inputType: InputType): boolean {
  const workflowType = getActiveWorkflowType(inputType);
  
  if (workflowType === 'youtube') {
    return isYouTubePhase(phase);
  }
  
  // Legacy workflow would go here, but it's not active
  return isYouTubePhase(phase); // Default to YouTube
}

/**
 * Get phase configuration for a phase in the given workflow.
 * Returns undefined if the phase is not part of the workflow.
 */
export function getPhaseConfig(phase: WorkflowPhase, inputType: InputType): PhaseConfig | undefined {
  const workflowType = getActiveWorkflowType(inputType);
  
  if (workflowType === 'youtube') {
    return getYouTubePhaseConfig(phase);
  }
  
  // Legacy workflow would go here, but it's not active
  return getYouTubePhaseConfig(phase); // Default to YouTube
}

/**
 * Get the start phase for a given input type.
 * For YouTube workflow, this is TRANSCRIPT_INPUT (or CONTENT_PLANNING for script input).
 */
export function getStartPhase(inputType: InputType): WorkflowPhase {
  const workflowType = getActiveWorkflowType(inputType);
  
  if (workflowType === 'youtube') {
    if (inputType === 'script') {
      return WorkflowPhase.CONTENT_PLANNING; // Scripts skip transcript input
    }
    return WorkflowPhase.TRANSCRIPT_INPUT; // Default start for YouTube workflow
  }
  
  // Legacy workflow would go here, but it's not active
  return WorkflowPhase.TRANSCRIPT_INPUT; // Default
}

/**
 * Check if the given input type uses YouTube workflow.
 * Currently, all input types use YouTube workflow.
 */
export function isYouTubeWorkflow(inputType: InputType): boolean {
  return getActiveWorkflowType(inputType) === 'youtube';
}

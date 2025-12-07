/**
 * Workflow module exports.
 * Provides state-based video generation workflow functionality.
 */

// Types
export {
  WorkflowPhase,
  PlannerStage,
  type PhaseStatus,
  type PhaseInfo,
  type CharacterData,
  type SettingData,
  type SceneData,
  type AssetInfo,
  type ProjectFile,
  type PhaseConfig,
  type StateTransitionResult,
  PHASE_CONFIGS,
  PHASE_ORDER,
  PROJECT_DIR,
  PROJECT_FILE,
  AUTO_APPROVE_TIMEOUT_MS,
  determineNextPhase,
  canTransitionToNextPhase,
} from './types.js';

// Project Manager
export {
  getProjectDir,
  getProjectFilePath,
  projectExists,
  createProjectStructure,
  createProject,
  loadProject,
  saveProject,
  getOrCreateProject,
  getCurrentPhase,
  updatePhaseStatus,
  updatePlannerStage,
  transitionToNextPhase,
  planFileHasContent,
  readProjectFile,
  writeProjectFile,
  saveCharacter,
  loadCharacter,
  saveSetting,
  loadSetting,
  addScene,
  addAsset,
  getAssets,
  getProjectSummary,
  getStateTransitionPrompt,
} from './ProjectManager.js';

// File Tools
export {
  readFileTool,
  writeFileTool,
  readProjectTool,
  updateProjectTool,
  getWorkflowFileTools,
} from './FileTools.js';

// Stitch Video Tool
export {
  stitchVideosTool,
  getStitchingJobStatus,
  getStitchingTools,
  type VideoTransition,
} from './StitchVideoTool.js';

// Combined tool getter
import { getWorkflowFileTools } from './FileTools.js';
import { getStitchingTools } from './StitchVideoTool.js';
import type { ToolDefinition } from '../../../core/llm/index.js';

/**
 * Get all workflow-related tools.
 */
export function getAllWorkflowTools(): ToolDefinition[] {
  return [...getWorkflowFileTools(), ...getStitchingTools()];
}

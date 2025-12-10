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
  type SceneRef,
  type AssetInfo,
  type ProjectFile,
  type PhaseConfig,
  type StateTransitionResult,
  type ContentTypeName,
  type ContentStatus,
  type ContentEntry,
  type ContentRegistry,
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
  deleteProject,
  createProjectStructure,
  createProject,
  loadProject,
  saveProject,
  getOrCreateProject,
  getOriginalInput,
  getCurrentPhase,
  updatePhaseStatus,
  updatePlannerStage,
  transitionToNextPhase,
  planFileHasContent,
  readProjectFile,
  writeProjectFile,
  saveCharacter,
  loadCharacterMarkdown,
  saveSetting,
  loadSettingMarkdown,
  addScene,
  addAsset,
  getAssets,
  getProjectSummary,
  getStateTransitionPrompt,
  // Content Registry functions
  createDefaultContentRegistry,
  updateContentStatus,
  addContentItem,
  getContentContext,
  getContentRegistryJson,
  hasRequiredContent,
  markContentAvailable,
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

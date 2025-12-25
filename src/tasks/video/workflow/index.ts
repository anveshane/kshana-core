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
  type ItemApprovalStatus,
  type ItemApprovalEntry,
  type AgentType,
  type ItemProcessMode,
  type ContentType,
  type FinalVideoInfo,
  type ProjectStyle,
  type StyleConfig,
  type InputType,
  type InputTypeConfig,
  PHASE_CONFIGS,
  PHASE_ORDER,
  PROJECT_DIR,
  PROJECT_FILE,
  PROJECT_VERSION,
  AUTO_APPROVE_TIMEOUT_MS,
  STYLE_CONFIGS,
  INPUT_TYPE_CONFIGS,
  determineNextPhase,
  canTransitionToNextPhase,
  getPhaseItems,
  getNextUnapprovedItem,
  areAllItemsApproved,
  countApprovedItems,
  createDefaultCharacterData,
  createDefaultSettingData,
  createDefaultSceneRef,
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
  getProjectStyle,
  getProjectStyleConfig,
  setProjectInputType,
  updatePhaseStatus,
  updatePlannerStage,
  transitionToNextPhase,
  planFileHasContent,
  readProjectFile,
  writeProjectFile,
  // Character functions
  saveCharacter,
  loadCharacterMarkdown,
  addCharacter,
  updateCharacter,
  updateCharacterApproval,
  // Setting functions
  saveSetting,
  loadSettingMarkdown,
  addSetting,
  updateSetting,
  updateSettingApproval,
  // Scene functions
  addScene,
  addNewScene,
  updateScene,
  updateSceneApproval,
  // Asset functions
  addAsset,
  getAssets,
  // Utility functions
  getProjectSummary,
  getStateTransitionPrompt,
  isProjectCompatible,
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

// Workflow Logger
export {
  getWorkflowLogger,
  resetWorkflowLogger,
  type WorkflowLoggerConfig,
} from './WorkflowLogger.js';

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

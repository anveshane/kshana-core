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
  type PersistedTodo,
  PHASE_CONFIGS,
  PHASE_ORDER,
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

// Active Project
export {
  getActiveProjectDir,
  setActiveProjectDir,
} from './activeProject.js';

// Project Manager
export {
  getProjectDir,
  getProjectFilePath,
  projectExists,
  deleteProject,
  scanProjects,
  inferProjectDirName,
  type ProjectInfo,
  createProjectStructure,
  createProject,
  loadProject,
  saveProject,
  updateProjectConfiguration,
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
  // Setting functions
  saveSetting,
  loadSettingMarkdown,
  addSetting,
  updateSetting,
  // Scene functions
  addScene,
  addNewScene,
  updateScene,
  saveImagePrompt,
  loadImagePrompt,
  saveVideoPrompt,
  loadVideoPrompt,
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
  // Todo persistence functions
  saveTodos,
  loadTodos,
  clearPersistedTodos,
  // File registration functions
  registerFile,
  generateFileSummary,
} from './ProjectManager.js';

// File Tools
export {
  readFileTool,
  importFileTool,
  readProjectTool,
  updateProjectTool,
  getWorkflowFileTools,
  getAllFileTools,
  getAllArtifactTools,
} from './FileTools.js';

// Workflow Logger
export {
  getWorkflowLogger,
  resetWorkflowLogger,
  type WorkflowLoggerConfig,
} from './WorkflowLogger.js';


// Generic Project Manager (v3.0 template-aware)
export {
  GenericProjectManager,
  createProjectManager,
  PROJECT_VERSION as GENERIC_PROJECT_VERSION,
  type CreateProjectOptions,
} from './GenericProjectManager.js';

// Infographic Placements Parser
export {
  parseInfographicPlacements,
  parseInfographicPlacementsWithErrors,
  type ParsedInfographicPlacement,
  type InfographicParseResult,
  type InfographicParseError,
  type InfographicType,
  INFOGRAPHIC_TYPES,
} from './infographicPlacementsParser.js';

// Infographic Prompt Expander
export {
  expandInfographicPlacementPrompt,
  type ExpandInfographicContext,
  type ExpandInfographicResult,
  type ExpandInfographicError,
} from './infographicPromptExpander.js';

// Combined tool getter
import { getWorkflowFileTools } from './FileTools.js';
import type { ToolDefinition } from '../../../core/llm/index.js';

/**
 * Get all workflow-related tools.
 */
export function getAllWorkflowTools(): ToolDefinition[] {
  return [...getWorkflowFileTools()];
}

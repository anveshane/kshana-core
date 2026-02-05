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
  type ProjectPlan,
  type CharacterData,
  type SettingData,
  type SceneRef,
  type TranscriptEntry,
  type ImagePlacement,
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
  AGENT_DIR,
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
  // Execution context detection
  getExecutionContext,
  getCLIProjectBasePath,
  getCLIAgentDir,
  getUserProjectAgentDir,
  // Project base path management
  setCurrentProjectBasePath,
  getCurrentProjectBasePath,
  // Path utilities (context-aware)
  getProjectDir,
  getAgentDir,
  getIndexDir,
  getManifestFilePath,
  getProjectIndexPath,
  getProjectFilePath,
  // Project operations (CLI context: uses CLI's own directory by default)
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
  updatePlanStage,
  updatePlannerStage, // Deprecated - redirects to updatePlanStage
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
  // Index functions
  generateProjectIndex,
  readProjectIndex,
  rebuildProjectIndex,
} from './ProjectManager.js';

// File Tools
export {
  readFileTool,
  writeFileTool,
  readProjectTool,
  updateProjectTool,
  readTranscriptTool,
  writePlacementPlanTool,
  writeInfographicPlacementPlanTool,
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

// Placement Parsers
export {
  parseImagePlacements,
  type ParsedImagePlacement,
} from './imagePlacementsParser.js';

export {
  parseVideoPlacements,
  parseVideoPlacementsWithErrors,
  type ParsedVideoPlacement,
  type VideoParseResult,
  type VideoParseError,
} from './videoPlacementsParser.js';

export {
  parseInfographicPlacements,
  parseInfographicPlacementsWithErrors,
  type ParsedInfographicPlacement,
  type InfographicParseResult,
  type InfographicParseError,
} from './infographicPlacementsParser.js';

export {
  validatePlacementSets,
  validateSinglePlacementAgainstExisting,
  type PlacementType,
  type PlacementValidationConfig,
  type ValidatePlacementSetsInput,
  type ValidatePlacementSetsResult,
  type ValidateSinglePlacementInput,
  type ValidateSinglePlacementResult,
} from './PlacementValidator.js';

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

/**
 * Workflow module exports.
 * Provides state-based video generation workflow functionality.
 */

// Types
export {
  WorkflowPhase,
  type PhaseStatus,
  type PhaseInfo,
  type ThreeActsPhaseInfo,
  type CharacterData,
  type SettingData,
  type StoryboardScene,
  type AssetInfo,
  type ProjectFile,
  type PhaseConfig,
  PHASE_CONFIGS,
  PHASE_ORDER,
  PROJECT_DIR,
  PROJECT_FILE,
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
  updatePhaseStatus,
  getCurrentPhase,
  planFileHasContent,
  readProjectFile,
  writeProjectFile,
  saveCharacter,
  loadCharacter,
  saveSetting,
  loadSetting,
  addAsset,
  getAssets,
  getProjectSummary,
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

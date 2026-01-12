/**
 * Video editing workflow exports.
 */

// Types
export * from './types.js';

// Project management
export {
  // Path helpers
  getProjectDir,
  getProjectFilePath,
  projectExists,

  // Project structure
  createProjectStructure,
  deleteProject,

  // Project CRUD
  createProject,
  loadProject,
  saveProject,
  isProjectCompatible,
  getOrCreateProject,

  // Phase management
  getCurrentPhase,
  updatePhaseStatus,
  updatePlannerStage,
  transitionToNextPhase,

  // Source video management
  setSourceVideo,
  updateSourceMetadata,

  // Script management
  setScript,
  setScriptSegments,

  // Enhancement management
  addEnhancement,
  updateEnhancementApproval,
  getPendingEnhancements,
  getApprovedEnhancements,
  areAllEnhancementsApproved,

  // Asset management
  addAsset,
  getAssetsByType,
  getAssetByEnhancementId,

  // Timeline management
  addTimelineTrack,
  getTimelineTrack,
  saveTimeline,
  addComposedSegment,
  updateSegmentApproval,
  getPendingSegments,
  areAllSegmentsApproved,

  // Export management
  setExportConfig,
  recordExportedVideo,
  recordNLEExport,

  // File operations
  readProjectFile,
  writeProjectFile,
  planFileHasContent,

  // Summary and prompts
  getProjectSummary,
  getStateTransitionPrompt,
} from './ProjectManager.js';

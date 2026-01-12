/**
 * ProjectManager - Handles project file management for the video editing workflow.
 * Manages the .kshana-edit directory structure and project.json file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  type VideoEditProjectFile,
  type PhaseInfo,
  type PhaseStatus,
  type EnhancementSuggestion,
  type AssetInfo,
  type ScriptSegment,
  type TimelineTrack,
  type ComposedSegment,
  type VideoMetadata,
  type VideoExportConfig,
  type NLEExportInfo,
  type ScriptFormat,
  type InputSourceType,
  type CloudProvider,
  type TrackType,
  type ItemApprovalStatus,
  EditWorkflowPhase,
  PlannerStage,
  PHASE_CONFIGS,
  PROJECT_DIR,
  PROJECT_FILE,
  PROJECT_VERSION,
  determineNextPhase,
  createDefaultPhaseInfo,
  createDefaultTrack,
} from './types.js';

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the project directory path for the current working directory.
 */
export function getProjectDir(basePath: string = process.cwd()): string {
  return join(basePath, PROJECT_DIR);
}

/**
 * Get the project file path.
 */
export function getProjectFilePath(basePath: string = process.cwd()): string {
  return join(getProjectDir(basePath), PROJECT_FILE);
}

/**
 * Check if a project exists in the current directory.
 */
export function projectExists(basePath: string = process.cwd()): boolean {
  return existsSync(getProjectFilePath(basePath));
}

// ============================================================================
// Project Structure
// ============================================================================

/**
 * Create the initial project directory structure.
 */
export function createProjectStructure(basePath: string = process.cwd()): void {
  const projectDir = getProjectDir(basePath);

  // Create directory structure per PRD
  const dirs = [
    projectDir,
    join(projectDir, 'plans'),
    join(projectDir, 'source'),
    join(projectDir, 'source', 'original'),
    join(projectDir, 'source', 'thumbnails'),
    join(projectDir, 'script'),
    join(projectDir, 'enhancements'),
    join(projectDir, 'assets'),
    join(projectDir, 'assets', 'images'),
    join(projectDir, 'assets', 'video_clips'),
    join(projectDir, 'assets', 'motion_graphics'),
    join(projectDir, 'assets', 'audio'),
    join(projectDir, 'assets', 'audio', 'music'),
    join(projectDir, 'assets', 'audio', 'sfx'),
    join(projectDir, 'assets', 'audio', 'user'),
    join(projectDir, 'timeline'),
    join(projectDir, 'timeline', 'previews'),
    join(projectDir, 'export'),
    join(projectDir, 'export', 'nle'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Create empty assets manifest
  const manifestPath = join(projectDir, 'assets', 'manifest.json');
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify({ assets: [] }, null, 2), 'utf-8');
  }
}

/**
 * Delete an existing project and all its files.
 */
export function deleteProject(basePath: string = process.cwd()): boolean {
  const projectDir = getProjectDir(basePath);

  if (!existsSync(projectDir)) {
    return false;
  }

  try {
    rmSync(projectDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Project Creation & Loading
// ============================================================================

/**
 * Create a new video editing project.
 */
export function createProject(
  title: string,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  // Ensure directory structure exists
  createProjectStructure(basePath);

  const now = Date.now();
  const projectId = `proj-${now}-${Math.random().toString(36).slice(2, 8)}`;

  const project: VideoEditProjectFile = {
    version: '3.0',
    id: projectId,
    title,
    createdAt: now,
    updatedAt: now,

    source: {
      type: 'local_file',
      path: '',
      importedAt: 0,
    },

    script: {
      format: 'auto_detect',
      content: '',
      segments: [],
    },

    currentPhase: EditWorkflowPhase.INGEST,
    phases: {
      ingest: createDefaultPhaseInfo(),
      script_parse: createDefaultPhaseInfo(),
      analysis: createDefaultPhaseInfo(),
      enhancement_plan: createDefaultPhaseInfo(),
      asset_generation: createDefaultPhaseInfo(),
      composition: createDefaultPhaseInfo(),
      preview: createDefaultPhaseInfo(),
      export: createDefaultPhaseInfo(),
    },

    enhancements: [],
    assets: [],

    timeline: {
      durationMs: 0,
      frameRate: 30,
      resolution: { width: 1920, height: 1080 },
      tracks: [],
      segments: [],
    },
  };

  // Save project file
  saveProject(project, basePath);

  return project;
}

/**
 * Load an existing project file.
 * Returns null if project doesn't exist or is incompatible.
 */
export function loadProject(basePath: string = process.cwd()): VideoEditProjectFile | null {
  const filePath = getProjectFilePath(basePath);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const project = JSON.parse(content);

    // Check version - must be 3.0 for video editing workflow
    if (!project.version || project.version !== PROJECT_VERSION) {
      console.warn(`[ProjectManager] Incompatible project version: ${project.version ?? 'unknown'}. Expected: ${PROJECT_VERSION}`);
      console.warn('[ProjectManager] Please delete the .kshana-edit directory and start a new project.');
      return null;
    }

    return project as VideoEditProjectFile;
  } catch {
    return null;
  }
}

/**
 * Check if an existing project is compatible with the current workflow.
 */
export function isProjectCompatible(basePath: string = process.cwd()): {
  compatible: boolean;
  version?: string;
  reason?: string;
} {
  const filePath = getProjectFilePath(basePath);

  if (!existsSync(filePath)) {
    return { compatible: true, reason: 'No existing project' };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const project = JSON.parse(content);

    if (!project.version) {
      return { compatible: false, version: 'unknown', reason: 'Old project without version. Delete .kshana-edit directory to start fresh.' };
    }

    if (project.version !== PROJECT_VERSION) {
      return { compatible: false, version: project.version, reason: `Incompatible version ${project.version}. Expected ${PROJECT_VERSION}. Delete .kshana-edit directory to start fresh.` };
    }

    return { compatible: true, version: project.version };
  } catch {
    return { compatible: false, reason: 'Failed to parse project file' };
  }
}

/**
 * Save the project file.
 */
export function saveProject(project: VideoEditProjectFile, basePath: string = process.cwd()): void {
  const filePath = getProjectFilePath(basePath);
  project.updatedAt = Date.now();
  writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
}

/**
 * Get or create a project.
 */
export function getOrCreateProject(
  title: string,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  const existing = loadProject(basePath);
  if (existing) {
    return existing;
  }
  return createProject(title, basePath);
}

// ============================================================================
// Phase Management
// ============================================================================

/**
 * Get the current workflow phase from the project.
 */
export function getCurrentPhase(project: VideoEditProjectFile): EditWorkflowPhase {
  return project.currentPhase;
}

/**
 * Update a phase's status.
 */
export function updatePhaseStatus(
  project: VideoEditProjectFile,
  phase: keyof VideoEditProjectFile['phases'],
  status: PhaseStatus,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  const phaseInfo = project.phases[phase];
  phaseInfo.status = status;

  if (status === 'completed') {
    phaseInfo.completedAt = Date.now();
    phaseInfo.plannerStage = PlannerStage.COMPLETE;

    // Auto-transition to next phase when completed
    const nextPhaseResult = determineNextPhase(project);
    if (nextPhaseResult.nextPhase !== project.currentPhase) {
      project.currentPhase = nextPhaseResult.nextPhase;
      // Mark new phase as in_progress
      const nextPhaseInfo = project.phases[nextPhaseResult.nextPhase as keyof typeof project.phases];
      if (nextPhaseInfo && nextPhaseInfo.status === 'pending') {
        nextPhaseInfo.status = 'in_progress';
        nextPhaseInfo.plannerStage = PlannerStage.PLANNING;
      }
    }
  } else if (status === 'in_progress' && !phaseInfo.plannerStage) {
    phaseInfo.plannerStage = PlannerStage.PLANNING;
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Update a phase's planner stage.
 */
export function updatePlannerStage(
  project: VideoEditProjectFile,
  phase: keyof VideoEditProjectFile['phases'],
  stage: PlannerStage,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  const phaseInfo = project.phases[phase];
  phaseInfo.plannerStage = stage;

  if (stage === PlannerStage.REFINING) {
    phaseInfo.refinementCount = (phaseInfo.refinementCount ?? 0) + 1;
  }

  // When planner stage reaches COMPLETE, check if phase is complete
  if (stage === PlannerStage.COMPLETE) {
    const phaseConfig = PHASE_CONFIGS[phase as EditWorkflowPhase];
    const isPerItemPhase = phaseConfig?.requiresPerItemApproval ?? false;

    if (!isPerItemPhase) {
      // Non-per-item phases are complete when plan is approved
      phaseInfo.status = 'completed';
      phaseInfo.completedAt = Date.now();
    }
    // For per-item phases, status remains 'in_progress' until all items are approved
  }

  saveProject(project, basePath);
  return project;
}

/**
 * Transition to the next phase based on current state.
 */
export function transitionToNextPhase(
  project: VideoEditProjectFile,
  basePath: string = process.cwd()
): { project: VideoEditProjectFile; transitioned: boolean; reason: string } {
  const result = determineNextPhase(project);

  if (result.nextPhase !== project.currentPhase) {
    project.currentPhase = result.nextPhase;

    // Mark new phase as in_progress with planning stage
    const phaseKey = result.nextPhase as keyof typeof project.phases;
    if (project.phases[phaseKey]) {
      project.phases[phaseKey].status = 'in_progress';
      project.phases[phaseKey].plannerStage = PlannerStage.PLANNING;
    }

    saveProject(project, basePath);
    return { project, transitioned: true, reason: result.reason };
  }

  return { project, transitioned: false, reason: result.reason };
}

// ============================================================================
// Source Video Management
// ============================================================================

/**
 * Set the source video for the project.
 */
export function setSourceVideo(
  project: VideoEditProjectFile,
  sourceType: InputSourceType,
  path: string,
  cloudProvider?: CloudProvider,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  project.source = {
    type: sourceType,
    path,
    cloudProvider,
    importedAt: Date.now(),
  };

  saveProject(project, basePath);
  return project;
}

/**
 * Update source video metadata.
 */
export function updateSourceMetadata(
  project: VideoEditProjectFile,
  metadata: VideoMetadata,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  project.source.metadata = metadata;

  // Update timeline properties from source
  project.timeline.durationMs = metadata.durationMs;
  project.timeline.frameRate = metadata.fps;
  project.timeline.resolution = { width: metadata.width, height: metadata.height };

  saveProject(project, basePath);
  return project;
}

// ============================================================================
// Script Management
// ============================================================================

/**
 * Set the script content and format.
 */
export function setScript(
  project: VideoEditProjectFile,
  content: string,
  format: ScriptFormat,
  originalPath?: string,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  project.script = {
    format,
    content,
    originalPath,
    segments: [],
  };

  // Save script content to file
  const scriptDir = join(getProjectDir(basePath), 'script');
  if (!existsSync(scriptDir)) {
    mkdirSync(scriptDir, { recursive: true });
  }

  // Determine extension based on format
  let ext = 'txt';
  if (format === 'srt') ext = 'srt';
  else if (format === 'vtt') ext = 'vtt';
  else if (format === 'screenplay') ext = 'md';

  const scriptPath = join(scriptDir, `original.${ext}`);
  writeFileSync(scriptPath, content, 'utf-8');
  project.script.originalPath = `script/original.${ext}`;

  saveProject(project, basePath);
  return project;
}

/**
 * Set parsed script segments.
 */
export function setScriptSegments(
  project: VideoEditProjectFile,
  segments: ScriptSegment[],
  basePath: string = process.cwd()
): VideoEditProjectFile {
  project.script.segments = segments;
  project.script.parsedAt = Date.now();

  // Save parsed segments to JSON
  const parsedPath = join(getProjectDir(basePath), 'script', 'parsed.json');
  writeFileSync(parsedPath, JSON.stringify(segments, null, 2), 'utf-8');

  saveProject(project, basePath);
  return project;
}

// ============================================================================
// Enhancement Management
// ============================================================================

/**
 * Add an enhancement suggestion.
 */
export function addEnhancement(
  project: VideoEditProjectFile,
  enhancement: EnhancementSuggestion,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  // Check if enhancement already exists
  const existingIndex = project.enhancements.findIndex(e => e.id === enhancement.id);
  if (existingIndex >= 0) {
    project.enhancements[existingIndex] = enhancement;
  } else {
    project.enhancements.push(enhancement);
  }

  // Save enhancements to file
  const suggestionsPath = join(getProjectDir(basePath), 'enhancements', 'suggestions.json');
  writeFileSync(suggestionsPath, JSON.stringify(project.enhancements, null, 2), 'utf-8');

  saveProject(project, basePath);
  return project;
}

/**
 * Update an enhancement's approval status.
 */
export function updateEnhancementApproval(
  project: VideoEditProjectFile,
  enhancementId: string,
  status: ItemApprovalStatus,
  feedback?: string,
  basePath: string = process.cwd()
): EnhancementSuggestion | null {
  const index = project.enhancements.findIndex(e => e.id === enhancementId);
  if (index < 0) return null;

  const enhancement = project.enhancements[index];
  if (!enhancement) return null;

  enhancement.approvalStatus = status;
  if (status === 'approved') {
    enhancement.approvedAt = Date.now();
  }
  if (status === 'regenerating') {
    enhancement.regenerationCount++;
  }
  if (feedback) {
    enhancement.feedback = feedback;
  }

  saveProject(project, basePath);
  return enhancement;
}

/**
 * Get all pending enhancements.
 */
export function getPendingEnhancements(project: VideoEditProjectFile): EnhancementSuggestion[] {
  return project.enhancements.filter(e => e.approvalStatus === 'pending');
}

/**
 * Get all approved enhancements.
 */
export function getApprovedEnhancements(project: VideoEditProjectFile): EnhancementSuggestion[] {
  return project.enhancements.filter(e => e.approvalStatus === 'approved');
}

/**
 * Check if all enhancements are approved.
 */
export function areAllEnhancementsApproved(project: VideoEditProjectFile): boolean {
  return project.enhancements.length > 0 &&
    project.enhancements.every(e => e.approvalStatus === 'approved' || e.approvalStatus === 'rejected');
}

// ============================================================================
// Asset Management
// ============================================================================

/**
 * Add an asset to the project.
 */
export function addAsset(
  project: VideoEditProjectFile,
  asset: AssetInfo,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  // Check if asset already exists
  const existingIndex = project.assets.findIndex(a => a.id === asset.id);
  if (existingIndex >= 0) {
    project.assets[existingIndex] = asset;
  } else {
    project.assets.push(asset);
  }

  // Update manifest file
  const manifestPath = join(getProjectDir(basePath), 'assets', 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ assets: project.assets }, null, 2), 'utf-8');

  saveProject(project, basePath);
  return project;
}

/**
 * Get all assets by type.
 */
export function getAssetsByType(project: VideoEditProjectFile, type: AssetInfo['type']): AssetInfo[] {
  return project.assets.filter(a => a.type === type);
}

/**
 * Get asset by enhancement ID.
 */
export function getAssetByEnhancementId(project: VideoEditProjectFile, enhancementId: string): AssetInfo | undefined {
  return project.assets.find(a => a.enhancementId === enhancementId);
}

// ============================================================================
// Timeline Management
// ============================================================================

/**
 * Add a track to the timeline.
 */
export function addTimelineTrack(
  project: VideoEditProjectFile,
  type: TrackType,
  label: string,
  basePath: string = process.cwd()
): TimelineTrack {
  const index = project.timeline.tracks.length;
  const track = createDefaultTrack(type, label, index);
  project.timeline.tracks.push(track);

  saveTimeline(project, basePath);
  saveProject(project, basePath);
  return track;
}

/**
 * Get timeline track by ID.
 */
export function getTimelineTrack(project: VideoEditProjectFile, trackId: string): TimelineTrack | undefined {
  return project.timeline.tracks.find(t => t.id === trackId);
}

/**
 * Save timeline composition to file.
 */
export function saveTimeline(project: VideoEditProjectFile, basePath: string = process.cwd()): void {
  const timelinePath = join(getProjectDir(basePath), 'timeline', 'composition.json');
  writeFileSync(timelinePath, JSON.stringify(project.timeline, null, 2), 'utf-8');
}

/**
 * Add a composed segment for preview.
 */
export function addComposedSegment(
  project: VideoEditProjectFile,
  segment: ComposedSegment,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  const existingIndex = project.timeline.segments.findIndex(s => s.id === segment.id);
  if (existingIndex >= 0) {
    project.timeline.segments[existingIndex] = segment;
  } else {
    project.timeline.segments.push(segment);
    project.timeline.segments.sort((a, b) => a.timeRange.startMs - b.timeRange.startMs);
  }

  saveTimeline(project, basePath);
  saveProject(project, basePath);
  return project;
}

/**
 * Update segment approval status.
 */
export function updateSegmentApproval(
  project: VideoEditProjectFile,
  segmentId: string,
  status: ItemApprovalStatus,
  feedback?: string,
  basePath: string = process.cwd()
): ComposedSegment | null {
  const index = project.timeline.segments.findIndex(s => s.id === segmentId);
  if (index < 0) return null;

  const segment = project.timeline.segments[index];
  if (!segment) return null;

  segment.approvalStatus = status;
  if (status === 'approved') {
    segment.approvedAt = Date.now();
  }
  if (feedback) {
    segment.feedback = feedback;
  }

  saveTimeline(project, basePath);
  saveProject(project, basePath);
  return segment;
}

/**
 * Get all pending segments for approval.
 */
export function getPendingSegments(project: VideoEditProjectFile): ComposedSegment[] {
  return project.timeline.segments.filter(s => s.approvalStatus === 'pending');
}

/**
 * Check if all segments are approved.
 */
export function areAllSegmentsApproved(project: VideoEditProjectFile): boolean {
  return project.timeline.segments.length > 0 &&
    project.timeline.segments.every(s => s.approvalStatus === 'approved');
}

// ============================================================================
// Export Management
// ============================================================================

/**
 * Set export configuration.
 */
export function setExportConfig(
  project: VideoEditProjectFile,
  config: VideoExportConfig,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  project.exportConfig = config;
  saveProject(project, basePath);
  return project;
}

/**
 * Record exported video file.
 */
export function recordExportedVideo(
  project: VideoEditProjectFile,
  videoPath: string,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  if (!project.exportedFiles) {
    project.exportedFiles = { nleProjects: [] };
  }
  project.exportedFiles.videoPath = videoPath;
  saveProject(project, basePath);
  return project;
}

/**
 * Record exported NLE project.
 */
export function recordNLEExport(
  project: VideoEditProjectFile,
  nleExport: NLEExportInfo,
  basePath: string = process.cwd()
): VideoEditProjectFile {
  if (!project.exportedFiles) {
    project.exportedFiles = { nleProjects: [] };
  }
  project.exportedFiles.nleProjects.push(nleExport);
  saveProject(project, basePath);
  return project;
}

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read a file from the project directory.
 */
export function readProjectFile(relativePath: string, basePath: string = process.cwd()): string | null {
  const filePath = join(getProjectDir(basePath), relativePath);

  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, 'utf-8');
}

/**
 * Write a file to the project directory.
 */
export function writeProjectFile(
  relativePath: string,
  content: string,
  basePath: string = process.cwd()
): void {
  const projectDir = getProjectDir(basePath);
  const filePath = join(projectDir, relativePath);

  // Ensure parent directory exists
  const parentDir = join(filePath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(filePath, content, 'utf-8');
}

/**
 * Check if a plan file has content.
 */
export function planFileHasContent(planFile: string, basePath: string = process.cwd()): boolean {
  const filePath = join(getProjectDir(basePath), planFile);

  if (!existsSync(filePath)) {
    return false;
  }

  const content = readFileSync(filePath, 'utf-8').trim();
  return content.length > 0;
}

// ============================================================================
// Project Summary
// ============================================================================

/**
 * Get the project summary for display.
 */
export function getProjectSummary(basePath: string = process.cwd()): string {
  const project = loadProject(basePath);

  if (!project) {
    return 'No project found. A new project will be created.';
  }

  const currentPhase = project.currentPhase;
  const phaseConfig = PHASE_CONFIGS[currentPhase];
  const phaseInfo = project.phases[currentPhase as keyof typeof project.phases];

  const completedPhases = Object.entries(project.phases)
    .filter(([, info]) => info.status === 'completed')
    .map(([key]) => key);

  // Count approved items
  const approvedEnhancements = project.enhancements.filter(e => e.approvalStatus === 'approved').length;
  const totalEnhancements = project.enhancements.length;
  const approvedSegments = project.timeline.segments.filter(s => s.approvalStatus === 'approved').length;
  const totalSegments = project.timeline.segments.length;

  return `
Project: ${project.title || '(untitled)'}
ID: ${project.id}
Version: ${project.version}
Source: ${project.source.path || 'not imported'}
Script: ${project.script.segments.length} segments (${project.script.format})
Current Phase: ${phaseConfig.displayName} (${currentPhase})
Planner Stage: ${phaseInfo?.plannerStage ?? 'not started'}
Completed Phases: ${completedPhases.length > 0 ? completedPhases.join(', ') : 'none'}
Enhancements: ${approvedEnhancements}/${totalEnhancements} approved
Assets: ${project.assets.length}
Timeline Segments: ${approvedSegments}/${totalSegments} approved
`.trim();
}

/**
 * Get detailed state transition prompt for the agent.
 */
export function getStateTransitionPrompt(basePath: string = process.cwd()): string {
  const project = loadProject(basePath);

  if (!project) {
    return 'No project exists. Create a new project first.';
  }

  const currentPhase = project.currentPhase;
  const phaseConfig = PHASE_CONFIGS[currentPhase];
  const phaseInfo = project.phases[currentPhase as keyof typeof project.phases];
  const plannerStage = phaseInfo?.plannerStage ?? PlannerStage.PLANNING;

  const planFileExists = phaseConfig.planOutputFile
    ? planFileHasContent(phaseConfig.planOutputFile, basePath)
    : false;

  let instruction = `
## Current State
- **Phase**: ${phaseConfig.displayName}
- **Stage**: ${plannerStage}
- **Plan File**: ${phaseConfig.planOutputFile ?? 'N/A'}
- **Plan File Has Content**: ${planFileExists ? 'YES' : 'NO'}
- **Per-Item Approval Required**: ${phaseConfig.requiresPerItemApproval ? 'YES' : 'NO'}

## What to Do Next
`;

  if (phaseConfig.requiresPerItemApproval) {
    instruction += getPerItemPhaseInstructions(project, phaseConfig);
  } else {
    instruction += getStandardPhaseInstructions(phaseConfig, plannerStage, planFileExists);
  }

  return instruction.trim();
}

/**
 * Get instructions for per-item phases.
 */
function getPerItemPhaseInstructions(
  project: VideoEditProjectFile,
  phaseConfig: typeof PHASE_CONFIGS[EditWorkflowPhase]
): string {
  let instruction = '';
  const phase = phaseConfig.phase;

  switch (phase) {
    case EditWorkflowPhase.ENHANCEMENT_PLAN: {
      const pending = getPendingEnhancements(project);
      const total = project.enhancements.length;
      const approved = total - pending.length;

      instruction += `
**Enhancement Planning Phase**

Progress: ${approved}/${total} enhancements approved

`;
      if (total === 0) {
        instruction += `No enhancements suggested yet. Analyze the script and suggest enhancements.`;
      } else if (pending.length > 0) {
        instruction += `Next enhancement to review: ${pending[0]?.description}

Get user approval for each enhancement before proceeding.`;
      } else {
        instruction += `All enhancements approved! Use transition_phase to move to Asset Generation.`;
      }
      break;
    }

    case EditWorkflowPhase.ASSET_GENERATION: {
      const approvedEnhancements = getApprovedEnhancements(project);
      const assetsGenerated = project.assets.filter(a => a.enhancementId).length;

      instruction += `
**Asset Generation Phase**

Approved enhancements: ${approvedEnhancements.length}
Assets generated: ${assetsGenerated}

`;
      if (assetsGenerated < approvedEnhancements.length) {
        const needsAsset = approvedEnhancements.find(e => !getAssetByEnhancementId(project, e.id));
        instruction += `Next asset to generate: ${needsAsset?.description}`;
      } else {
        instruction += `All assets generated! Use transition_phase to move to Composition.`;
      }
      break;
    }

    case EditWorkflowPhase.PREVIEW: {
      const pending = getPendingSegments(project);
      const total = project.timeline.segments.length;
      const approved = total - pending.length;

      instruction += `
**Preview Phase**

Progress: ${approved}/${total} segments approved

`;
      if (total === 0) {
        instruction += `No segments to preview. Render preview segments first.`;
      } else if (pending.length > 0) {
        instruction += `Next segment to preview: Segment ${pending[0]?.index}

Get user approval for each segment before proceeding.`;
      } else {
        instruction += `All segments approved! Use transition_phase to move to Export.`;
      }
      break;
    }

    default:
      instruction += `Process each item and get user approval before proceeding.`;
  }

  return instruction;
}

/**
 * Get instructions for standard (non-per-item) phases.
 */
function getStandardPhaseInstructions(
  phaseConfig: typeof PHASE_CONFIGS[EditWorkflowPhase],
  plannerStage: PlannerStage,
  planFileExists: boolean
): string {
  let instruction = '';

  switch (plannerStage) {
    case PlannerStage.PLANNING:
      if (planFileExists) {
        instruction += `
Plan already exists. Mark this phase as COMPLETE and transition to the next phase.
`;
      } else {
        instruction += `
Create a plan for ${phaseConfig.displayName}.
1. Analyze the project context
2. Create a detailed plan
3. Write the plan to ${phaseConfig.planOutputFile}
4. Move to VERIFY stage
`;
      }
      break;

    case PlannerStage.VERIFY:
      instruction += `
Present the plan to the user for approval.
1. Read the plan from ${phaseConfig.planOutputFile}
2. Present a summary using ask_user
3. If approved, move to COMPLETE
4. If feedback given, move to REFINING
`;
      break;

    case PlannerStage.REFINING:
      instruction += `
Update the plan based on user feedback.
1. Read the current plan
2. Apply user feedback
3. Update the plan in ${phaseConfig.planOutputFile}
4. Move back to VERIFY stage
`;
      break;

    case PlannerStage.COMPLETE:
      instruction += `
Phase ${phaseConfig.displayName} is complete.
Use transition_phase to move to: ${phaseConfig.nextPhase ? PHASE_CONFIGS[phaseConfig.nextPhase].displayName : 'DONE'}
`;
      break;
  }

  return instruction;
}

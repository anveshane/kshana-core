/**
 * Type definitions for the state-based video generation workflow.
 * Simplified workflow: plot → story → scenes → images → video
 */

/**
 * Video workflow phases in execution order.
 * Simplified to focus only on: plot → story → scenes → images → video
 */
export enum WorkflowPhase {
  /** Initial phase - analyze input and create project structure */
  PLOT = 'plot',

  /** Expand plot into full story with characters and settings */
  STORY = 'story',

  /** Break story into individual scenes */
  SCENES = 'scenes',

  /** Generate images for each scene */
  IMAGES = 'images',

  /** Generate and stitch videos */
  VIDEO = 'video',

  /** Workflow complete */
  COMPLETED = 'completed',
}

/**
 * Planner stage within a phase.
 * Each planning agent goes through these stages.
 */
export enum PlannerStage {
  /** Initial planning - creating the first draft */
  PLANNING = 'planning',
  /** Presenting plan to user for verification */
  VERIFY = 'verify',
  /** Refining based on user feedback */
  REFINING = 'refining',
  /** Plan approved, ready to execute */
  COMPLETE = 'complete',
}

/**
 * Phase status values.
 */
export type PhaseStatus = 'pending' | 'in_progress' | 'completed';

/**
 * Phase metadata stored in project.json.
 */
export interface PhaseInfo {
  /** Current status of the phase */
  status: PhaseStatus;
  /** Current planner stage (if in_progress) */
  plannerStage?: PlannerStage;
  /** Path to the plan file (relative to .kshana/) */
  planFile?: string;
  /** Timestamp when phase was completed */
  completedAt: number | null;
  /** Number of refinement iterations */
  refinementCount?: number;
}

/**
 * Character data stored in characters/[name].md.
 * The .md file contains markdown-formatted character description.
 */
export interface CharacterData {
  name: string;
  description: string;
  visualDescription: string;
  referenceImageId?: string;
  referenceImagePath?: string;
}

/**
 * Setting data stored in settings/[name].md.
 * The .md file contains markdown-formatted setting description.
 */
export interface SettingData {
  name: string;
  description: string;
  visualDescription: string;
  referenceImageId?: string;
  referenceImagePath?: string;
}

/**
 * Scene reference in project.json index.
 * Full scene content is stored in plans/scenes.md or scenes/*.md files.
 */
export interface SceneRef {
  /** Scene number/identifier */
  sceneNumber: number;
  /** Reference to scene file (relative to .kshana/) */
  file?: string;
  /** Generated image artifact ID */
  imageArtifactId?: string;
  /** Generated video artifact ID */
  videoArtifactId?: string;
}

/**
 * Asset metadata stored in assets/manifest.json.
 */
export interface AssetInfo {
  id: string;
  type: 'character_ref' | 'setting_ref' | 'scene_image' | 'scene_video' | 'final_video';
  path: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Content type supported by the content registry.
 */
export type ContentTypeName = 'plot' | 'story' | 'characters' | 'settings' | 'scenes' | 'images' | 'videos';

/**
 * Status of content availability.
 */
export type ContentStatus = 'available' | 'partial' | 'missing';

/**
 * Content entry in the registry.
 * Tracks what content exists and where to find it.
 */
export interface ContentEntry {
  /** Current status of this content */
  status: ContentStatus;
  /** Path to the main file for this content (relative to .kshana/) */
  file: string;
  /** For itemized content (characters/settings), list of item names */
  items?: string[];
  /** For itemized content, paths to individual item files */
  itemFiles?: Record<string, string>;
}

/**
 * Content Registry - tracks what creative content is available.
 * This is the single source of truth for both readers and writers.
 */
export interface ContentRegistry {
  plot: ContentEntry;
  story: ContentEntry;
  characters: ContentEntry;
  settings: ContentEntry;
  scenes: ContentEntry;
  images: ContentEntry;
  videos: ContentEntry;
}

/**
 * Main project file structure (project.json).
 * This is an INDEX file - content lives in .md files, this just tracks references.
 */
export interface ProjectFile {
  /** Unique project identifier */
  id: string;
  /** Project title */
  title: string;
  /** Path to original input file (relative to .kshana/) */
  originalInputFile: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;

  /** Current workflow phase */
  currentPhase: WorkflowPhase;

  /** Phase status tracking */
  phases: {
    plot: PhaseInfo;
    story: PhaseInfo;
    scenes: PhaseInfo;
    images: PhaseInfo;
    video: PhaseInfo;
  };

  /** Content registry - tracks what creative content is available */
  content: ContentRegistry;

  /** Character names (full data in characters/*.json) */
  characters: string[];
  /** Setting names (full data in settings/*.json) */
  settings: string[];
  /** Scene references (full data in plans/scenes.md or scenes/*.md) */
  scenes: SceneRef[];
  /** Asset IDs (detailed info in assets/manifest.json) */
  assets: string[];
}

/**
 * Configuration for each workflow phase.
 */
export interface PhaseConfig {
  /** Phase identifier */
  phase: WorkflowPhase;
  /** Human-readable name */
  displayName: string;
  /** Next phase after completion */
  nextPhase: WorkflowPhase | null;
  /** Prompt file name (without .json) for planner agent */
  promptFile: string;
  /** Path to plan output file (relative to .kshana/) */
  planOutputFile?: string;
  /** Tools available in this phase */
  allowedTools: string[];
  /** Is this an expensive phase (image/video generation)? */
  isExpensive: boolean;
  /** Description of what this phase does */
  description: string;
}

/**
 * Phase configurations map.
 */
export const PHASE_CONFIGS: Record<WorkflowPhase, PhaseConfig> = {
  [WorkflowPhase.PLOT]: {
    phase: WorkflowPhase.PLOT,
    displayName: 'Plot Development',
    nextPhase: WorkflowPhase.STORY,
    promptFile: 'plot',
    planOutputFile: 'plans/plot.md',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project'],
    isExpensive: false,
    description: 'Develop the basic plot outline from user input',
  },
  [WorkflowPhase.STORY]: {
    phase: WorkflowPhase.STORY,
    displayName: 'Story Development',
    nextPhase: WorkflowPhase.SCENES,
    promptFile: 'story',
    planOutputFile: 'plans/story.md',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project'],
    isExpensive: false,
    description: 'Expand plot into full story with characters and settings',
  },
  [WorkflowPhase.SCENES]: {
    phase: WorkflowPhase.SCENES,
    displayName: 'Scene Breakdown',
    nextPhase: WorkflowPhase.IMAGES,
    promptFile: 'scenes',
    planOutputFile: 'plans/scenes.md',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project'],
    isExpensive: false,
    description: 'Break story into individual visual scenes',
  },
  [WorkflowPhase.IMAGES]: {
    phase: WorkflowPhase.IMAGES,
    displayName: 'Image Generation',
    nextPhase: WorkflowPhase.VIDEO,
    promptFile: 'images',
    planOutputFile: 'plans/images.md',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'dispatch_image_agent',
      'generate_image',
      'wait_for_job',
    ],
    isExpensive: true,
    description: 'Generate reference images and scene images',
  },
  [WorkflowPhase.VIDEO]: {
    phase: WorkflowPhase.VIDEO,
    displayName: 'Video Generation',
    nextPhase: WorkflowPhase.COMPLETED,
    promptFile: 'video',
    planOutputFile: 'plans/video.md',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'generate_video',
      'stitch_videos',
      'wait_for_job',
    ],
    isExpensive: true,
    description: 'Generate videos from images and stitch into final video',
  },
  [WorkflowPhase.COMPLETED]: {
    phase: WorkflowPhase.COMPLETED,
    displayName: 'Completed',
    nextPhase: null,
    promptFile: 'completed',
    allowedTools: ['think', 'read_file', 'read_project'],
    isExpensive: false,
    description: 'Workflow complete',
  },
};

/**
 * Order of phases for iteration.
 */
export const PHASE_ORDER: WorkflowPhase[] = [
  WorkflowPhase.PLOT,
  WorkflowPhase.STORY,
  WorkflowPhase.SCENES,
  WorkflowPhase.IMAGES,
  WorkflowPhase.VIDEO,
  WorkflowPhase.COMPLETED,
];

/**
 * Default project directory name.
 */
export const PROJECT_DIR = '.kshana';

/**
 * Project file name within PROJECT_DIR.
 */
export const PROJECT_FILE = 'project.json';

/**
 * Auto-approve timeout in milliseconds (15 seconds).
 * If user doesn't respond to ask_user within this time, assume approval.
 */
export const AUTO_APPROVE_TIMEOUT_MS = 15000;

/**
 * State transition rules - determines what phase to go to next.
 */
export interface StateTransitionResult {
  /** Next phase to transition to */
  nextPhase: WorkflowPhase;
  /** Reason for the transition */
  reason: string;
  /** Whether this is an automatic transition (no user input needed) */
  isAutomatic: boolean;
}

/**
 * Determine the next state based on current project state.
 */
export function determineNextPhase(project: ProjectFile): StateTransitionResult {
  const currentPhase = project.currentPhase;
  const phaseInfo = project.phases[currentPhase as keyof typeof project.phases];

  // If current phase is completed, move to next
  if (phaseInfo?.status === 'completed') {
    const config = PHASE_CONFIGS[currentPhase];
    if (config.nextPhase) {
      return {
        nextPhase: config.nextPhase,
        reason: `${config.displayName} completed, moving to ${PHASE_CONFIGS[config.nextPhase].displayName}`,
        isAutomatic: true,
      };
    }
  }

  // If current phase is in progress, stay in it
  if (phaseInfo?.status === 'in_progress') {
    return {
      nextPhase: currentPhase,
      reason: `${PHASE_CONFIGS[currentPhase].displayName} is in progress`,
      isAutomatic: false,
    };
  }

  // If current phase is pending, start it
  if (phaseInfo?.status === 'pending') {
    return {
      nextPhase: currentPhase,
      reason: `Starting ${PHASE_CONFIGS[currentPhase].displayName}`,
      isAutomatic: true,
    };
  }

  // Default: stay in current phase
  return {
    nextPhase: currentPhase,
    reason: 'No transition needed',
    isAutomatic: false,
  };
}

/**
 * Check if a phase can transition to the next phase.
 */
export function canTransitionToNextPhase(project: ProjectFile, phase: WorkflowPhase): boolean {
  const phaseKey = phase as keyof typeof project.phases;
  const phaseInfo = project.phases[phaseKey];

  if (!phaseInfo) return false;

  // Phase must be completed to transition
  if (phaseInfo.status !== 'completed') return false;

  // Planner stage must be complete
  if (phaseInfo.plannerStage && phaseInfo.plannerStage !== PlannerStage.COMPLETE) {
    return false;
  }

  return true;
}

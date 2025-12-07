/**
 * Type definitions for the state-based video generation workflow.
 * Defines phases, project structure, and configuration types.
 */

/**
 * Video workflow phases in execution order.
 */
export enum WorkflowPhase {
  /** Initial phase - analyze input and create project structure */
  PROJECT_INIT = 'project_init',

  /** Gather story details - characters, scenes, story arc */
  STORY_DISCOVERY = 'story_discovery',

  /** Create visual descriptions, generate reference images */
  CHARACTER_DESCRIPTIONS = 'character_descriptions',

  /** Break story into Intro, Middle, Climax acts */
  THREE_ACTS = 'three_acts',

  /** Generate storyboard images using character references */
  STORYBOARD_IMAGES = 'storyboard_images',

  /** Generate videos from storyboard */
  VIDEO_GENERATION = 'video_generation',

  /** Stitch videos sequentially */
  VIDEO_STITCHING = 'video_stitching',

  /** Final user review */
  FINAL_SIGNOFF = 'final_signoff',

  /** Workflow complete */
  COMPLETED = 'completed',
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
  /** Path to the plan file (relative to .kshana/) */
  planFile?: string;
  /** Timestamp when phase was completed */
  completedAt: number | null;
}

/**
 * Extended phase info for 3 Acts phase with sub-plan files.
 */
export interface ThreeActsPhaseInfo extends PhaseInfo {
  /** Plan files for each act's scene breakdown */
  actPlanFiles: {
    intro: string;
    middle: string;
    climax: string;
  };
}

/**
 * Character data stored in characters/[name].json.
 */
export interface CharacterData {
  name: string;
  description: string;
  visualDescription: string;
  personality?: string;
  backstory?: string;
  referenceImageId?: string;
  referenceImagePath?: string;
}

/**
 * Setting data stored in settings/[name].json.
 */
export interface SettingData {
  name: string;
  description: string;
  visualDescription: string;
  mood?: string;
  referenceImageId?: string;
  referenceImagePath?: string;
}

/**
 * Storyboard scene data.
 */
export interface StoryboardScene {
  sceneNumber: number;
  act: 'intro' | 'middle' | 'climax';
  description: string;
  characters: string[];
  setting: string;
  action: string;
  dialogue?: string;
  imagePrompt?: string;
  imageArtifactId?: string;
  videoArtifactId?: string;
  duration?: number;
}

/**
 * Asset metadata stored in assets/manifest.json.
 */
export interface AssetInfo {
  id: string;
  type: 'character_ref' | 'setting_ref' | 'storyboard' | 'video' | 'final_video';
  path: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Main project file structure (project.json).
 */
export interface ProjectFile {
  /** Unique project identifier */
  id: string;
  /** Project title (set during story discovery) */
  title: string;
  /** User's original input/prompt */
  originalInput: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;

  /** Phase status tracking */
  phases: {
    story_discovery: PhaseInfo;
    character_descriptions: PhaseInfo;
    three_acts: ThreeActsPhaseInfo;
    storyboard_images: PhaseInfo;
    video_generation: PhaseInfo;
    video_stitching: PhaseInfo;
    final_signoff: PhaseInfo;
  };

  /** Character names (full data in characters/*.json) */
  characters: string[];
  /** Setting names (full data in settings/*.json) */
  settings: string[];
  /** Storyboard scenes */
  storyboard: StoryboardScene[];
  /** Asset manifest (detailed info in assets/manifest.json) */
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
  /** Does this phase require user approval before proceeding? */
  requiresCheckpoint: boolean;
  /** Prompt file name (without .json) for planner agent */
  promptFile: string;
  /** Path to plan output file (relative to .kshana/) */
  planOutputFile?: string;
  /** Tools available in this phase */
  allowedTools: string[];
  /** Is this an expensive phase (image/video generation)? */
  isExpensive: boolean;
}

/**
 * Phase configurations map.
 */
export const PHASE_CONFIGS: Record<WorkflowPhase, PhaseConfig> = {
  [WorkflowPhase.PROJECT_INIT]: {
    phase: WorkflowPhase.PROJECT_INIT,
    displayName: 'Project Initialization',
    nextPhase: WorkflowPhase.STORY_DISCOVERY,
    requiresCheckpoint: false,
    promptFile: 'project-init',
    allowedTools: ['think', 'read_project', 'update_project', 'write_file'],
    isExpensive: false,
  },
  [WorkflowPhase.STORY_DISCOVERY]: {
    phase: WorkflowPhase.STORY_DISCOVERY,
    displayName: 'Story Discovery',
    nextPhase: WorkflowPhase.CHARACTER_DESCRIPTIONS,
    requiresCheckpoint: true,
    promptFile: 'story-discovery',
    planOutputFile: 'plans/story-discovery.md',
    allowedTools: ['think', 'ask_user', 'dispatch_agent', 'read_file', 'write_file', 'read_project', 'update_project'],
    isExpensive: false,
  },
  [WorkflowPhase.CHARACTER_DESCRIPTIONS]: {
    phase: WorkflowPhase.CHARACTER_DESCRIPTIONS,
    displayName: 'Character Descriptions',
    nextPhase: WorkflowPhase.THREE_ACTS,
    requiresCheckpoint: true,
    promptFile: 'character-descriptions',
    planOutputFile: 'plans/characters.md',
    allowedTools: [
      'think',
      'ask_user',
      'dispatch_agent',
      'dispatch_image_agent',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'generate_image',
      'wait_for_job',
    ],
    isExpensive: true,
  },
  [WorkflowPhase.THREE_ACTS]: {
    phase: WorkflowPhase.THREE_ACTS,
    displayName: '3-Act Structure',
    nextPhase: WorkflowPhase.STORYBOARD_IMAGES,
    requiresCheckpoint: true,
    promptFile: 'three-acts',
    planOutputFile: 'plans/three-acts.md',
    allowedTools: ['think', 'ask_user', 'dispatch_agent', 'read_file', 'write_file', 'read_project', 'update_project'],
    isExpensive: false,
  },
  [WorkflowPhase.STORYBOARD_IMAGES]: {
    phase: WorkflowPhase.STORYBOARD_IMAGES,
    displayName: 'Storyboard Images',
    nextPhase: WorkflowPhase.VIDEO_GENERATION,
    requiresCheckpoint: true,
    promptFile: 'storyboard-images',
    planOutputFile: 'plans/storyboard.md',
    allowedTools: [
      'think',
      'ask_user',
      'dispatch_agent',
      'dispatch_image_agent',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'generate_image',
      'wait_for_job',
    ],
    isExpensive: true,
  },
  [WorkflowPhase.VIDEO_GENERATION]: {
    phase: WorkflowPhase.VIDEO_GENERATION,
    displayName: 'Video Generation',
    nextPhase: WorkflowPhase.VIDEO_STITCHING,
    requiresCheckpoint: true,
    promptFile: 'video-generation',
    planOutputFile: 'plans/video-generation.md',
    allowedTools: [
      'think',
      'ask_user',
      'dispatch_agent',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'generate_video',
      'wait_for_job',
    ],
    isExpensive: true,
  },
  [WorkflowPhase.VIDEO_STITCHING]: {
    phase: WorkflowPhase.VIDEO_STITCHING,
    displayName: 'Video Stitching',
    nextPhase: WorkflowPhase.FINAL_SIGNOFF,
    requiresCheckpoint: false,
    promptFile: 'video-stitching',
    allowedTools: ['think', 'read_file', 'read_project', 'update_project', 'stitch_videos'],
    isExpensive: false,
  },
  [WorkflowPhase.FINAL_SIGNOFF]: {
    phase: WorkflowPhase.FINAL_SIGNOFF,
    displayName: 'Final Review',
    nextPhase: WorkflowPhase.COMPLETED,
    requiresCheckpoint: true,
    promptFile: 'final-signoff',
    allowedTools: ['think', 'ask_user', 'read_file', 'read_project'],
    isExpensive: false,
  },
  [WorkflowPhase.COMPLETED]: {
    phase: WorkflowPhase.COMPLETED,
    displayName: 'Completed',
    nextPhase: null,
    requiresCheckpoint: false,
    promptFile: 'completed',
    allowedTools: [],
    isExpensive: false,
  },
};

/**
 * Order of phases for iteration.
 */
export const PHASE_ORDER: WorkflowPhase[] = [
  WorkflowPhase.PROJECT_INIT,
  WorkflowPhase.STORY_DISCOVERY,
  WorkflowPhase.CHARACTER_DESCRIPTIONS,
  WorkflowPhase.THREE_ACTS,
  WorkflowPhase.STORYBOARD_IMAGES,
  WorkflowPhase.VIDEO_GENERATION,
  WorkflowPhase.VIDEO_STITCHING,
  WorkflowPhase.FINAL_SIGNOFF,
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

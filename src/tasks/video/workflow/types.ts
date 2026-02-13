/**
 * Type definitions for the state-based video generation workflow.
 * Workflow supports legacy story-first and new transcript-first pipelines.
 */

/**
 * Project file version - used to detect incompatible old projects.
 */
export const PROJECT_VERSION = '2.0';

/**
 * Visual style for the project.
 * This determines the overall aesthetic of generated images and videos.
 */
export type ProjectStyle = 'cinematic_realism' | 'anime';

/**
 * Style configuration with display names and prompt modifiers.
 */
export interface StyleConfig {
  /** Display name shown to user */
  displayName: string;
  /** Short description of the style */
  description: string;
  /** Positive prompt additions for this style */
  promptModifier: string;
  /** Negative prompt additions for this style */
  negativePromptModifier: string;
}

/**
 * Style configurations for each project style.
 */
export const STYLE_CONFIGS: Record<ProjectStyle, StyleConfig> = {
  cinematic_realism: {
    displayName: 'Cinematic Realism',
    description: 'Photorealistic, cinematic look with dramatic lighting and film-quality visuals',
    promptModifier: 'cinematic, photorealistic, dramatic lighting, high detail, film quality, 8k, professional photography',
    negativePromptModifier: 'anime, cartoon, illustration, drawing, sketch, 2d, cel shaded',
  },
  anime: {
    displayName: 'Anime',
    description: 'Japanese anime style with vibrant colors and expressive characters',
    promptModifier: 'anime style, anime art, vibrant colors, detailed anime, studio quality anime, anime aesthetic',
    negativePromptModifier: 'photorealistic, realistic, photograph, live action, 3d render',
  },
};

/**
 * Video workflow phases in execution order.
 * 8-phase workflow matching Sequence.md specification.
 */
export enum WorkflowPhase {
  /** Phase 1 (YouTube): Accept raw SRT text from user input */
  TRANSCRIPT_INPUT = 'transcript_input',

  /** Phase 2 (YouTube): Create content plan for visual placements */
  CONTENT_PLANNING = 'content_planning',
  
  /** Legacy: Keep PLANNING for backward compatibility (maps to CONTENT_PLANNING) */
  PLANNING = 'planning',

  /** Phase 3 (YouTube): Map images to transcript timestamps */
  IMAGE_PLACEMENT = 'image_placement',

  /** Phase 4 (YouTube): Generate images for placements */
  IMAGE_GENERATION = 'image_generation',

  /** Phase 4.5 (YouTube): Map infographics to transcript timestamps */
  INFOGRAPHICS_PLACEMENT = 'infographics_placement',

  /** Phase 4.6 (YouTube): Generate infographics via Remotion */
  INFOGRAPHICS_GENERATION = 'infographics_generation',

  /** Phase 4.7 (YouTube): Map videos to transcript timestamps */
  VIDEO_PLACEMENT = 'video_placement',

  /** Phase 5 (YouTube): Generate videos for placements */
  VIDEO_GENERATION = 'video_generation',

  /** Phase 6 (YouTube): Replace video segments with images */
  VIDEO_REPLACEMENT = 'video_replacement',

  /** Legacy: Analyze input and create plot outline */
  PLOT = 'plot',

  /** Legacy: Generate full story from plot (or accept direct story input) */
  STORY = 'story',

  /** Legacy: Plan and create detailed descriptions for each character and setting */
  CHARACTERS_SETTINGS = 'characters_settings',

  /** Legacy: Break story into individual visual scenes with descriptions */
  SCENES = 'scenes',

  /** Legacy: Generate reference images for each character and setting (text-to-image) */
  CHARACTER_SETTING_IMAGES = 'character_setting_images',

  /** Legacy: Generate scene images using character/setting references (image+text-to-image) */
  SCENE_IMAGES = 'scene_images',

  /** Legacy: Generate video clip for each scene image */
  VIDEO = 'video',

  /** Stitch all scene videos into final video */
  VIDEO_COMBINE = 'video_combine',

  /** Workflow complete */
  COMPLETED = 'completed',
}

/**
 * Type of input provided by the user.
 * This determines which phases can be skipped.
 */
export type InputType = 'idea' | 'story' | 'youtube_srt' | 'script';

/**
 * Input type configuration with display names and phase implications.
 */
export interface InputTypeConfig {
  /** Display name shown to user */
  displayName: string;
  /** Description of this input type */
  description: string;
  /** Which phase to start from */
  startPhase: WorkflowPhase;
  /** Phases to mark as skipped/completed */
  skipPhases: WorkflowPhase[];
}

/**
 * Input type configurations.
 */
export const INPUT_TYPE_CONFIGS: Record<InputType, InputTypeConfig> = {
  idea: {
    displayName: 'Story Idea',
    description: 'A brief concept or premise that needs to be developed into a full story',
    startPhase: WorkflowPhase.PLOT,
    skipPhases: [],
  },
  story: {
    displayName: 'Complete Story',
    description: 'A full story, chapter, or detailed narrative ready for visualization',
    startPhase: WorkflowPhase.CHARACTERS_SETTINGS,
    skipPhases: [WorkflowPhase.PLOT, WorkflowPhase.STORY],
  },
  youtube_srt: {
    displayName: 'YouTube SRT Transcript',
    description: 'Raw SRT subtitle content for a YouTube documentary workflow',
    startPhase: WorkflowPhase.TRANSCRIPT_INPUT,
    skipPhases: [
      WorkflowPhase.PLOT,
      WorkflowPhase.STORY,
      WorkflowPhase.CHARACTERS_SETTINGS,
      WorkflowPhase.SCENES,
      WorkflowPhase.CHARACTER_SETTING_IMAGES,
      WorkflowPhase.SCENE_IMAGES,
      WorkflowPhase.VIDEO,
    ],
  },
  script: {
    displayName: 'Documentary Script',
    description: 'A non-SRT documentary script that follows the YouTube workflow',
    startPhase: WorkflowPhase.CONTENT_PLANNING,
    skipPhases: [
      WorkflowPhase.TRANSCRIPT_INPUT,
      WorkflowPhase.PLOT,
      WorkflowPhase.STORY,
      WorkflowPhase.CHARACTERS_SETTINGS,
      WorkflowPhase.SCENES,
      WorkflowPhase.CHARACTER_SETTING_IMAGES,
      WorkflowPhase.SCENE_IMAGES,
      WorkflowPhase.VIDEO,
    ],
  },
};

/**
 * Planner stage for the project-level master plan.
 * The project goes through these stages ONCE before executing phases.
 */
export enum PlannerStage {
  /** Initial planning - creating the first draft */
  PLANNING = 'planning',
  /** Presenting plan to user for verification */
  VERIFY = 'verify',
  /** Refining based on user feedback */
  REFINING = 'refining',
  /** Plan approved, ready to execute phases */
  COMPLETE = 'complete',
}

/**
 * Project-level master plan.
 * A single plan that covers all phases of the video generation workflow.
 */
export interface ProjectPlan {
  /** Unique identifier for the plan */
  planId: string;
  /** Path to the master plan file (relative to .kshana/) */
  planFile: string;
  /** Current stage of the planning process */
  stage: PlannerStage;
  /** Number of refinement iterations */
  refinementCount: number;
  /** Timestamp when plan was created */
  createdAt: number;
  /** Timestamp when plan was approved (stage = COMPLETE) */
  approvedAt: number | null;
}

/**
 * Phase status values.
 */
export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/**
 * Phase metadata stored in project.json.
 * Note: Planning is done at project level via ProjectPlan, not per-phase.
 */
export interface PhaseInfo {
  /** Current status of the phase */
  status: PhaseStatus;
  /** Timestamp when phase was completed */
  completedAt: number | null;
}

/**
 * Approval status for an individual item (character, setting, scene, etc.).
 */
export type ItemApprovalStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'regenerating';

/**
 * Individual item tracking for per-item approval phases.
 */
export interface ItemApprovalEntry {
  /** Unique identifier for this item */
  id: string;
  /** Item type */
  type: 'character' | 'setting' | 'scene';
  /** Item name */
  name: string;
  /** Current approval status */
  status: ItemApprovalStatus;
  /** Number of regeneration attempts */
  regenerationCount: number;
  /** Associated content artifact ID (if generated) */
  contentArtifactId?: string;
  /** Associated image artifact ID (if generated) */
  imageArtifactId?: string;
  /** Associated video artifact ID (if generated) */
  videoArtifactId?: string;
  /** User feedback (if rejected) */
  feedback?: string;
  /** Timestamp when approved */
  approvedAt?: number;
}

/**
 * Character data stored in characters/[name].md.
 * The .md file contains markdown-formatted character description.
 */
export interface CharacterData {
  name: string;
  description: string;
  visualDescription: string;
  /** Approval status for the character description (CHARACTERS_SETTINGS phase) */
  approvalStatus: ItemApprovalStatus;
  /** Approval status for the reference image (CHARACTER_SETTING_IMAGES phase) */
  referenceImageApprovalStatus?: ItemApprovalStatus;
  /** Content artifact ID for the description */
  contentArtifactId?: string;
  /** Reference image artifact ID */
  referenceImageId?: string;
  /** Reference image file path */
  referenceImagePath?: string;
  /** Timestamp when content was approved */
  approvedAt?: number;
  /** Timestamp when reference image was approved */
  referenceImageApprovedAt?: number;
  /** Number of regeneration attempts */
  regenerationCount: number;
}

/**
 * Setting data stored in settings/[name].md.
 * The .md file contains markdown-formatted setting description.
 */
export interface SettingData {
  name: string;
  description: string;
  visualDescription: string;
  /** Approval status for the setting description (CHARACTERS_SETTINGS phase) */
  approvalStatus: ItemApprovalStatus;
  /** Approval status for the reference image (CHARACTER_SETTING_IMAGES phase) */
  referenceImageApprovalStatus?: ItemApprovalStatus;
  /** Content artifact ID for the description */
  contentArtifactId?: string;
  /** Reference image artifact ID */
  referenceImageId?: string;
  /** Reference image file path */
  referenceImagePath?: string;
  /** Timestamp when content was approved */
  approvedAt?: number;
  /** Timestamp when reference image was approved */
  referenceImageApprovedAt?: number;
  /** Number of regeneration attempts */
  regenerationCount: number;
}

/**
 * Scene reference in project.json index.
 * Full scene content is stored in agent/scenes/scene-XXX/scene.md files.
 * Tracks approval status separately for content, image, and video phases.
 */
export interface SceneRef {
  /** Scene number/identifier */
  sceneNumber: number;
  /** Reference to scene folder (relative to agent/, e.g., "scenes/scene-001") */
  folder?: string;
  /** Reference to scene file (relative to agent/, e.g., "scenes/scene-001/scene.md") */
  file?: string;
  /** Scene title */
  title?: string;
  /** Scene description summary */
  description?: string;

  // Content approval (SCENES phase)
  /** Approval status for the scene description */
  contentApprovalStatus: ItemApprovalStatus;
  /** Content artifact ID for the description */
  contentArtifactId?: string;
  /** Timestamp when content was approved */
  contentApprovedAt?: number;

  // Image approval (SCENE_IMAGES phase)
  /** Approval status for the scene image */
  imageApprovalStatus: ItemApprovalStatus;
  /** Generated image artifact ID */
  imageArtifactId?: string;
  /** Image generation prompt used */
  imagePrompt?: string;
  /** Timestamp when image was approved */
  imageApprovedAt?: number;

  // Video approval (VIDEO phase)
  /** Approval status for the scene video */
  videoApprovalStatus: ItemApprovalStatus;
  /** Generated video artifact ID */
  videoArtifactId?: string;
  /** Timestamp when video was approved */
  videoApprovedAt?: number;

  /** Number of regeneration attempts across all phases */
  regenerationCount: number;
  /** Latest feedback from user */
  feedback?: string;
}

/**
 * Transcript entry parsed from SRT input.
 */
export interface TranscriptEntry {
  index: number;
  startTime: number; // seconds
  endTime: number;
  text: string;
}

/**
 * Planned image placement aligned to transcript entries.
 */
export interface ImagePlacement {
  transcriptIndex: number;
  startTime: number;
  endTime: number;
  imagePrompt: string;
  imagePath?: string;
  imageArtifactId?: string;
}

/**
 * Planned video placement aligned to transcript entries.
 * Videos complement images in different time segments.
 */
export interface VideoPlacement {
  transcriptIndex: number;
  startTime: number;
  endTime: number;
  videoPrompt: string;
  videoType: 'cinematic_realism' | 'stock_footage' | 'motion_graphics'; // Based on content needs
  videoDuration: number; // Calculated from endTime - startTime
  videoPath?: string;
  videoArtifactId?: string;
}

/**
 * Planned infographic placement aligned to transcript entries.
 * Infographics (charts, diagrams, statistics) are generated via Remotion.
 */
export interface InfographicPlacement {
  transcriptIndex: number;
  startTime: number;
  endTime: number;
  infographicType: 'bar_chart' | 'line_chart' | 'diagram' | 'statistic' | 'list';
  prompt: string;
  /** Optional structured data for Remotion (labels, values, etc.) */
  data?: Record<string, unknown>;
  infographicPath?: string;
  infographicArtifactId?: string;
}

/**
 * Supported background generation pipeline kinds.
 */
export type BackgroundGenerationKind = 'image' | 'video';

/**
 * Status for an individual background generation item.
 */
export type BackgroundGenerationItemStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Status for a background generation batch.
 */
export type BackgroundGenerationBatchStatus = 'queued' | 'running' | 'completed' | 'failed';

/**
 * Item tracked inside a background generation batch.
 */
export interface BackgroundGenerationItem {
  placementNumber: number;
  startTime: string;
  endTime: string;
  prompt: string;
  status: BackgroundGenerationItemStatus;
  attempts: number;
  updatedAt: number;
  jobId?: string;
  artifactId?: string;
  filePath?: string;
  error?: string;
  metadata?: {
    duration?: number;
    videoType?: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
    negativePrompt?: string;
  };
}

/**
 * Persistent batch metadata for non-blocking generation.
 */
export interface BackgroundGenerationBatch {
  id: string;
  kind: BackgroundGenerationKind;
  phase: WorkflowPhase.IMAGE_GENERATION | WorkflowPhase.VIDEO_GENERATION;
  sourceFile: string;
  status: BackgroundGenerationBatchStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  expandPrompts: boolean;
  autoFillGaps?: boolean;
  retryOfBatchId?: string;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  items: BackgroundGenerationItem[];
}

/**
 * Persistent state container for background generation batches.
 */
export interface BackgroundGenerationState {
  batches: BackgroundGenerationBatch[];
  activeBatchIds: string[];
  lastResumedAt?: number;
}

/**
 * Asset metadata stored in agent/manifest.json.
 */
export interface AssetInfo {
  id: string;
  type: 'character_ref' | 'setting_ref' | 'scene_image' | 'scene_video' | 'scene_infographic' | 'final_video';
  path: string;
  createdAt: number;
  scene_number?: number; // For scene-specific assets (also used as placementNumber for placements)
  version?: number; // Version number of the asset (defaults to 1)
  metadata?: Record<string, unknown>; // Can include placementNumber, jobId, promptId, etc.
}

/**
 * Project index structure for .kshana/index/project_index.json.
 * Contains state and pointers only, derived from agent/project.json and agent/manifest.json.
 * Follows Kshana Indexing Architecture: Control Plane with no content, only pointers/versions/state.
 */
export interface ProjectIndex {
  index_version: '1.0';
  project_id: string;
  last_modified: number;

  // Context variables (from ContextStore) - merged into consolidated index
  context?: {
    variables: Record<string, import('../../../core/context/index.js').StoredContextMeta>;
  };

  workflow: {
    current_phase: WorkflowPhase;
    completed_phases: WorkflowPhase[];
    is_blocked: boolean;
    blocking_reasons: string[];
  };

  routing: {
    scenes: Record<string, SceneRoutingEntry>;
    entities: {
      characters: Record<string, EntityRoutingEntry>;
      settings: Record<string, EntityRoutingEntry>;
    };
  };

  stats: {
    total_scenes: number;
    total_duration: number;
    asset_counts: {
      video: number;
      audio: number;
      image: number;
    };
  };
}

/**
 * Scene routing entry in the index.
 * Describes where the scene lives, what version is active, and its current status.
 */
export interface SceneRoutingEntry {
  id: string;
  folder: string;
  active: {
    video?: number;
    audio?: string;
    image?: number;
  };
  status: {
    content: ItemApprovalStatus;
    image: ItemApprovalStatus;
    video: ItemApprovalStatus;
    audio?: ItemApprovalStatus;
  };
  duration?: number;
}

/**
 * Entity routing entry (character or setting).
 * Describes where the entity lives and its readiness state.
 */
export interface EntityRoutingEntry {
  path: string;
  ready: boolean;
  has_ref_image?: boolean;
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
  /** Path to the main file for this content (relative to agent/) */
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
 * Final video information after stitching.
 */
export interface FinalVideoInfo {
  /** Artifact ID of the final video */
  artifactId: string;
  /** File path to the final video */
  path: string;
  /** Total duration in seconds */
  duration: number;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Main project file structure (project.json).
 * This is an INDEX file - content lives in .md files, this just tracks references.
 * Version 2.0 - 8-phase workflow with per-item approval and project-level planning.
 */
export interface ProjectFile {
  /** Project version - must be '2.0' for 8-phase workflow */
  version: '2.0';
  /** Unique project identifier */
  id: string;
  /** Project title */
  title: string;
  /** Path to original input file (relative to agent/) */
  originalInputFile: string;
  /** Visual style for the project (cinematic_realism or anime) */
  style: ProjectStyle;
  /** Type of input provided (idea or story) - determines which phases to skip */
  inputType: InputType;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;

  /** Current workflow phase */
  currentPhase: WorkflowPhase;

  /** 
   * Project-level master plan.
   * A single plan that covers all phases - created once at the start.
   * All phases execute based on this approved plan.
   */
  plan: ProjectPlan;

  /** Phase status tracking for transcript-first and legacy phases */
  phases: {
    transcript_input: PhaseInfo;
    planning: PhaseInfo;
    image_placement: PhaseInfo;
    image_generation: PhaseInfo;
    infographics_placement: PhaseInfo;
    infographics_generation: PhaseInfo;
    video_placement: PhaseInfo;
    video_generation: PhaseInfo;
    video_replacement: PhaseInfo;
    plot: PhaseInfo;
    story: PhaseInfo;
    characters_settings: PhaseInfo;
    scenes: PhaseInfo;
    character_setting_images: PhaseInfo;
    scene_images: PhaseInfo;
    video: PhaseInfo;
    video_combine: PhaseInfo;
  };

  /** Content registry - tracks what creative content is available */
  content: ContentRegistry;

  /** Character data with approval tracking */
  characters: CharacterData[];
  /** Setting data with approval tracking */
  settings: SettingData[];
  /** Scene references with approval tracking (full data in plans/scenes.md or scenes/*.md) */
  scenes: SceneRef[];
  /** Asset IDs (detailed info in assets/manifest.json) */
  assets: string[];

  /** Final video information (populated after VIDEO_COMBINE phase) */
  finalVideo?: FinalVideoInfo;

  /** Parsed transcript entries from SRT */
  transcriptEntries?: TranscriptEntry[];
  /** Image placement plan aligned to transcript entries */
  imagePlacements?: ImagePlacement[];
  /** Video placement plan aligned to transcript entries */
  videoPlacements?: VideoPlacement[];
  /** Infographic placement plan aligned to transcript entries */
  infographicPlacements?: InfographicPlacement[];
  /** Persistent background generation state for non-blocking image/video batches */
  backgroundGeneration?: BackgroundGenerationState;
}

/**
 * Agent type for a phase.
 */
export type AgentType = 'planning' | 'content' | 'image' | 'video';

/**
 * Item processing mode for a phase.
 * Determines how items are iterated in per-item approval phases.
 */
export type ItemProcessMode =
  | 'single'             // Single item (plot, story, video_combine)
  | 'list_characters'    // Process each character
  | 'list_settings'      // Process each setting
  | 'list_scenes'        // Process each scene
  | 'list_all_refs'      // Process all character + setting refs
  | 'list_scene_images'; // Process each scene for image generation

/**
 * Content type for content agent dispatch.
 */
export type ContentType =
  | 'plot'
  | 'story'
  | 'character'
  | 'setting'
  | 'scene'
  | 'narration'
  | 'transcript_analysis'
  | 'image_placement_plan'
  | 'image_prompt';

/**
 * Configuration for each workflow phase.
 * Note: Planning is done at project level, not per-phase.
 */
export interface PhaseConfig {
  /** Phase identifier */
  phase: WorkflowPhase;
  /** Human-readable name */
  displayName: string;
  /** Next phase after completion */
  nextPhase: WorkflowPhase | null;
  /** Prompt file name (without .json) for agent */
  promptFile: string;
  /** Primary agent type for this phase */
  agentType: AgentType;
  /** Tools available in this phase */
  allowedTools: string[];
  /** How items are processed in this phase */
  itemProcessMode: ItemProcessMode;
  /** Whether each item requires individual user approval */
  requiresPerItemApproval: boolean;
  /** Is this an expensive phase (image/video generation)? */
  isExpensive: boolean;
  /** Description of what this phase does */
  description: string;
  /** Content type for content agent (if agentType is 'content') */
  contentType?: ContentType;
}

/**
 * Phase configurations map.
 * 
 * NOTE: This is kept for backward compatibility. New code should use
 * workflow manager (getPhaseConfig from workflows/workflow-manager.ts)
 * which automatically selects the correct workflow based on input type.
 * 
 * Currently, this only contains YouTube workflow phases since that's the
 * only active workflow. Legacy phases are not included.
 */
export const PHASE_CONFIGS: Partial<Record<WorkflowPhase, PhaseConfig>> = {
  [WorkflowPhase.TRANSCRIPT_INPUT]: {
    phase: WorkflowPhase.TRANSCRIPT_INPUT,
    displayName: 'Transcript Input',
    nextPhase: WorkflowPhase.CONTENT_PLANNING,
    promptFile: 'transcript-input',
    agentType: 'content',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'read_transcript',
      'validate_srt',
      'parse_srt',
      'Task',
    ],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Accept raw SRT text, validate and parse transcript entries',
  },

  [WorkflowPhase.CONTENT_PLANNING]: {
    phase: WorkflowPhase.CONTENT_PLANNING,
    displayName: 'Content Planning',
    nextPhase: WorkflowPhase.IMAGE_PLACEMENT,
    promptFile: 'content-planning',
    agentType: 'planning',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'Task'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Create content plan for visual placements',
  },

  [WorkflowPhase.IMAGE_PLACEMENT]: {
    phase: WorkflowPhase.IMAGE_PLACEMENT,
    displayName: 'Image Placement',
    nextPhase: WorkflowPhase.IMAGE_GENERATION,
    promptFile: 'image-placement',
    agentType: 'content',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'write_placement_plan',
      'create_image_placement',
      'update_image_placement',
      'Task',
    ],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Map placements to transcript timestamps and prepare image prompts',
  },

  [WorkflowPhase.IMAGE_GENERATION]: {
    phase: WorkflowPhase.IMAGE_GENERATION,
    displayName: 'Image Generation',
    nextPhase: WorkflowPhase.INFOGRAPHICS_PLACEMENT,
    promptFile: 'image-generation',
    agentType: 'image',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'generate_all_images', 'read_background_generation', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Generate documentary-style images for planned placements',
  },

  [WorkflowPhase.INFOGRAPHICS_PLACEMENT]: {
    phase: WorkflowPhase.INFOGRAPHICS_PLACEMENT,
    displayName: 'Infographics Placement',
    nextPhase: WorkflowPhase.INFOGRAPHICS_GENERATION,
    promptFile: 'infographic-placement',
    agentType: 'content',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'write_infographic_placement_plan',
      'Task',
    ],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Map infographics to transcript timestamps (charts, diagrams, statistics)',
  },

  [WorkflowPhase.INFOGRAPHICS_GENERATION]: {
    phase: WorkflowPhase.INFOGRAPHICS_GENERATION,
    displayName: 'Infographics Generation',
    nextPhase: WorkflowPhase.VIDEO_PLACEMENT,
    promptFile: 'infographic-generation',
    agentType: 'image',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'generate_all_infographics', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Generate infographics via Remotion (charts, diagrams, data viz)',
  },

  [WorkflowPhase.VIDEO_PLACEMENT]: {
    phase: WorkflowPhase.VIDEO_PLACEMENT,
    displayName: 'Video Placement',
    nextPhase: WorkflowPhase.VIDEO_GENERATION,
    promptFile: 'video-placement',
    agentType: 'video',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'Task', 'todo_write'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Identify moments for video generation (distinct from image placements)',
  },

  [WorkflowPhase.VIDEO_GENERATION]: {
    phase: WorkflowPhase.VIDEO_GENERATION,
    displayName: 'Video Generation',
    nextPhase: WorkflowPhase.COMPLETED,
    promptFile: 'video-generation',
    agentType: 'video',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'generate_all_videos', 'read_background_generation', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Generate AI videos for planned placements',
  },

  [WorkflowPhase.VIDEO_REPLACEMENT]: {
    phase: WorkflowPhase.VIDEO_REPLACEMENT,
    displayName: 'Video Replacement',
    nextPhase: WorkflowPhase.VIDEO_COMBINE,
    promptFile: 'video-replacement',
    agentType: 'video',
    allowedTools: [
      'think',
      'ask_user',
      'read_file',
      'write_file',
      'read_project',
      'update_project',
      'generate_replacement_plan',
      'replace_video_segment',
      'sync_audio_with_images',
      'Task',
    ],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Replace video segments with generated images',
  },

  [WorkflowPhase.PLOT]: {
    phase: WorkflowPhase.PLOT,
    displayName: 'Plot Development',
    nextPhase: WorkflowPhase.STORY,
    promptFile: 'plot',
    agentType: 'content',
    contentType: 'plot',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'dispatch_content_agent'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Generate plot outline from user input',
  },

  [WorkflowPhase.STORY]: {
    phase: WorkflowPhase.STORY,
    displayName: 'Story Development',
    nextPhase: WorkflowPhase.CHARACTERS_SETTINGS,
    promptFile: 'story',
    agentType: 'content',
    contentType: 'story',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'dispatch_content_agent'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Generate full story from plot (or accept direct story input)',
  },

  [WorkflowPhase.CHARACTERS_SETTINGS]: {
    phase: WorkflowPhase.CHARACTERS_SETTINGS,
    displayName: 'Character & Setting Descriptions',
    nextPhase: WorkflowPhase.SCENES,
    promptFile: 'characters-settings',
    agentType: 'content',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'dispatch_agent', 'dispatch_content_agent', 'todo_write'],
    itemProcessMode: 'list_all_refs',
    requiresPerItemApproval: true,
    isExpensive: false,
    description: 'Plan and create detailed descriptions for each character and setting',
  },

  [WorkflowPhase.SCENES]: {
    phase: WorkflowPhase.SCENES,
    displayName: 'Scene Breakdown',
    nextPhase: WorkflowPhase.CHARACTER_SETTING_IMAGES,
    promptFile: 'scenes',
    agentType: 'content',
    contentType: 'scene',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'dispatch_agent', 'dispatch_content_agent', 'todo_write'],
    itemProcessMode: 'list_scenes',
    requiresPerItemApproval: true,
    isExpensive: false,
    description: 'Break story into individual visual scenes with descriptions',
  },

  [WorkflowPhase.CHARACTER_SETTING_IMAGES]: {
    phase: WorkflowPhase.CHARACTER_SETTING_IMAGES,
    displayName: 'Reference Image Generation',
    nextPhase: WorkflowPhase.SCENE_IMAGES,
    promptFile: 'character-setting-images',
    agentType: 'image',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'dispatch_image_agent', 'generate_image', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'list_all_refs',
    requiresPerItemApproval: true,
    isExpensive: true,
    description: 'Generate reference images for each character and setting (text-to-image)',
  },

  [WorkflowPhase.SCENE_IMAGES]: {
    phase: WorkflowPhase.SCENE_IMAGES,
    displayName: 'Scene Image Generation',
    nextPhase: WorkflowPhase.VIDEO,
    promptFile: 'scene-images',
    agentType: 'image',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'dispatch_image_agent', 'generate_image', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'list_scene_images',
    requiresPerItemApproval: true,
    isExpensive: true,
    description: 'Generate scene images using character/setting references (image+text-to-image)',
  },

  [WorkflowPhase.VIDEO]: {
    phase: WorkflowPhase.VIDEO,
    displayName: 'Video Generation',
    nextPhase: WorkflowPhase.VIDEO_COMBINE,
    promptFile: 'video',
    agentType: 'video',
    allowedTools: ['think', 'ask_user', 'read_file', 'write_file', 'read_project', 'update_project', 'dispatch_video_agent', 'generate_video', 'wait_for_job', 'todo_write'],
    itemProcessMode: 'list_scenes',
    requiresPerItemApproval: true,
    isExpensive: true,
    description: 'Generate video clip for each scene image',
  },

  [WorkflowPhase.VIDEO_COMBINE]: {
    phase: WorkflowPhase.VIDEO_COMBINE,
    displayName: 'Video Stitching',
    nextPhase: WorkflowPhase.COMPLETED,
    promptFile: 'video-combine',
    agentType: 'video',
    allowedTools: ['think', 'ask_user', 'read_file', 'read_project', 'update_project', 'stitch_videos', 'wait_for_job'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Stitch all scene videos into final video',
  },

  [WorkflowPhase.COMPLETED]: {
    phase: WorkflowPhase.COMPLETED,
    displayName: 'Completed',
    nextPhase: null,
    promptFile: 'completed',
    agentType: 'planning',
    allowedTools: ['think', 'read_file', 'read_project'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Workflow complete - present final video to user',
  },
};

/**
 * Order of phases for iteration (8-phase workflow).
 */
export const PHASE_ORDER: WorkflowPhase[] = [
  WorkflowPhase.TRANSCRIPT_INPUT,
  WorkflowPhase.CONTENT_PLANNING,
  WorkflowPhase.IMAGE_PLACEMENT,
  WorkflowPhase.IMAGE_GENERATION,
  WorkflowPhase.VIDEO_REPLACEMENT,
  WorkflowPhase.VIDEO_COMBINE,
  WorkflowPhase.COMPLETED,
  WorkflowPhase.PLOT,
  WorkflowPhase.STORY,
  WorkflowPhase.CHARACTERS_SETTINGS,
  WorkflowPhase.SCENES,
  WorkflowPhase.CHARACTER_SETTING_IMAGES,
  WorkflowPhase.SCENE_IMAGES,
  WorkflowPhase.VIDEO,
];

/**
 * Execution context for the application.
 * CLI manages .kshana/agent/* in its own project directory.
 * Desktop manages user project workspaces and coordinates with .kshana/agent/* in user space.
 */
export type ExecutionContext = 'cli' | 'desktop';

/**
 * Default project directory name.
 */
export const PROJECT_DIR = '.kshana';

/**
 * Agent subdirectory within PROJECT_DIR.
 */
export const AGENT_DIR = 'agent';

/**
 * Index subdirectory within PROJECT_DIR.
 */
export const INDEX_DIR = 'index';

/**
 * Project file name within AGENT_DIR.
 */
export const PROJECT_FILE = 'project.json';

/**
 * Manifest file name within AGENT_DIR.
 */
export const MANIFEST_FILE = 'manifest.json';

/**
 * Project index file name within INDEX_DIR.
 */
export const PROJECT_INDEX_FILE = 'project_index.json';

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
 * Uses workflow manager to get the correct next phase based on input type.
 * 
 * NOTE: This function now uses the workflow manager, which ensures
 * YouTube workflows can never transition to legacy phases (PLOT/STORY).
 * 
 * Uses dynamic import to avoid circular dependency (workflow-manager imports types).
 */
export async function determineNextPhase(project: ProjectFile): Promise<StateTransitionResult> {
  // Dynamic import to avoid circular dependency
  const { getNextPhase, getPhaseConfig } = await import('./workflows/workflow-manager.js');
  const { isYouTubePhase, getNextYouTubePhase } = await import('./workflows/youtube-workflow.js');
  
  const currentPhase = project.currentPhase;
  const phaseInfo = project.phases[currentPhase as keyof typeof project.phases];
  
  // Defensive check: if phaseInfo doesn't exist, return no transition
  if (!phaseInfo) {
    return {
      nextPhase: currentPhase,
      reason: `Phase ${currentPhase} not found in project phases`,
      isAutomatic: false,
    };
  }
  
  const phaseConfig = getPhaseConfig(currentPhase, project.inputType) || PHASE_CONFIGS[currentPhase];
  if (!phaseConfig) {
    return {
      nextPhase: currentPhase,
      reason: `No configuration found for phase ${currentPhase}`,
      isAutomatic: false,
    };
  }

  // If current phase is completed, move to next phase in workflow order
  if (phaseInfo.status === 'completed') {
    // For YouTube workflow, use strict sequence from youtube-workflow.ts
    if (isYouTubePhase(currentPhase)) {
      const nextPhase = getNextYouTubePhase(currentPhase);

      if (
        currentPhase === WorkflowPhase.IMAGE_GENERATION &&
        nextPhase !== WorkflowPhase.INFOGRAPHICS_PLACEMENT
      ) {
        return {
          nextPhase: currentPhase,
          reason:
            `Transition invariant violation: expected ${WorkflowPhase.INFOGRAPHICS_PLACEMENT} after ${WorkflowPhase.IMAGE_GENERATION}, ` +
            `but got ${nextPhase ?? 'null'}.`,
          isAutomatic: false,
        };
      }
      
      if (nextPhase) {
        const nextPhaseConfig = getPhaseConfig(nextPhase, project.inputType);
        if (nextPhaseConfig) {
          return {
            nextPhase,
            reason: `${phaseConfig.displayName} completed, moving to ${nextPhaseConfig.displayName}`,
            isAutomatic: true,
          };
        }
      } else {
        // Reached end of workflow
        return {
          nextPhase: WorkflowPhase.COMPLETED,
          reason: 'Workflow complete',
          isAutomatic: true,
        };
      }
    }
    
    // Fallback to workflow manager for non-YouTube workflows
    const nextPhase = getNextPhase(currentPhase, project.inputType);
    
    if (nextPhase) {
      const nextPhaseConfig = getPhaseConfig(nextPhase, project.inputType) || (PHASE_CONFIGS[nextPhase] as PhaseConfig | undefined);
      if (nextPhaseConfig) {
        return {
          nextPhase,
          reason: `${phaseConfig.displayName} completed, moving to ${nextPhaseConfig.displayName}`,
          isAutomatic: true,
        };
      }
    }
    
    // No next phase - workflow complete
    return {
      nextPhase: currentPhase,
      reason: 'Workflow complete',
      isAutomatic: false,
    };
  }

  // If current phase is in progress, stay in it
  if (phaseInfo?.status === 'in_progress') {
    return {
      nextPhase: currentPhase,
      reason: `Continue working on ${phaseConfig.displayName}. Phase is in progress.`,
      isAutomatic: false,
    };
  }

  // If current phase is pending, start it
  if (phaseInfo?.status === 'pending') {
    return {
      nextPhase: currentPhase,
      reason: `Starting ${phaseConfig.displayName}`,
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
 * Note: Planning is done at project level, so we only check phase status.
 */
export function canTransitionToNextPhase(project: ProjectFile, phase: WorkflowPhase): boolean {
  const phaseKey = phase as keyof typeof project.phases;
  const phaseInfo = project.phases[phaseKey];

  if (!phaseInfo) return false;

  // Phase must be completed to transition
  if (phaseInfo.status !== 'completed') return false;

  // Project-level plan must be approved before any phase can complete
  if (project.plan.stage !== PlannerStage.COMPLETE) {
    return false;
  }

  return true;
}

/**
 * Get items to process for a given phase.
 * Returns an array of ItemApprovalEntry objects for phases with per-item approval.
 */
export function getPhaseItems(project: ProjectFile, phase: WorkflowPhase): ItemApprovalEntry[] {
  const config = PHASE_CONFIGS[phase];
  if (!config) {
    return []; // No config, return empty array
  }

  switch (config.itemProcessMode) {
    case 'single':
      return [];

    case 'list_characters':
      return project.characters.map(char => ({
        id: `char_${char.name.toLowerCase().replace(/\s+/g, '_')}`,
        type: 'character' as const,
        name: char.name,
        status: char.approvalStatus,
        regenerationCount: char.regenerationCount,
        contentArtifactId: char.contentArtifactId,
        imageArtifactId: char.referenceImageId,
        approvedAt: char.approvedAt,
      }));

    case 'list_settings':
      return project.settings.map(setting => ({
        id: `setting_${setting.name.toLowerCase().replace(/\s+/g, '_')}`,
        type: 'setting' as const,
        name: setting.name,
        status: setting.approvalStatus,
        regenerationCount: setting.regenerationCount,
        contentArtifactId: setting.contentArtifactId,
        imageArtifactId: setting.referenceImageId,
        approvedAt: setting.approvedAt,
      }));

    case 'list_all_refs':
      // Combine characters and settings
      // For CHARACTER_SETTING_IMAGES phase, check referenceImageApprovalStatus
      // For CHARACTERS_SETTINGS phase, check approvalStatus (content approval)
      const isImagePhase = phase === WorkflowPhase.CHARACTER_SETTING_IMAGES;
      const charItems: ItemApprovalEntry[] = project.characters.map(char => ({
        id: `char_${char.name.toLowerCase().replace(/\s+/g, '_')}`,
        type: 'character' as const,
        name: char.name,
        status: isImagePhase
          ? (char.referenceImageApprovalStatus || 'pending')
          : char.approvalStatus,
        regenerationCount: char.regenerationCount,
        contentArtifactId: char.contentArtifactId,
        imageArtifactId: char.referenceImageId,
        approvedAt: isImagePhase ? char.referenceImageApprovedAt : char.approvedAt,
      }));
      const settingItems: ItemApprovalEntry[] = project.settings.map(setting => ({
        id: `setting_${setting.name.toLowerCase().replace(/\s+/g, '_')}`,
        type: 'setting' as const,
        name: setting.name,
        status: isImagePhase
          ? (setting.referenceImageApprovalStatus || 'pending')
          : setting.approvalStatus,
        regenerationCount: setting.regenerationCount,
        contentArtifactId: setting.contentArtifactId,
        imageArtifactId: setting.referenceImageId,
        approvedAt: isImagePhase ? setting.referenceImageApprovedAt : setting.approvedAt,
      }));
      return [...charItems, ...settingItems];

    case 'list_scenes':
    case 'list_scene_images':
      // For scenes, return based on the phase-specific approval status
      return project.scenes.map(scene => {
        // Determine which approval status to use based on phase
        let status: ItemApprovalStatus;
        let approvedAt: number | undefined;
        let artifactId: string | undefined;

        if (phase === WorkflowPhase.SCENES) {
          status = scene.contentApprovalStatus;
          approvedAt = scene.contentApprovedAt;
          artifactId = scene.contentArtifactId;
        } else if (phase === WorkflowPhase.SCENE_IMAGES) {
          status = scene.imageApprovalStatus;
          approvedAt = scene.imageApprovedAt;
          artifactId = scene.imageArtifactId;
        } else if (phase === WorkflowPhase.VIDEO) {
          status = scene.videoApprovalStatus;
          approvedAt = scene.videoApprovedAt;
          artifactId = scene.videoArtifactId;
        } else {
          status = 'pending';
        }

        return {
          id: `scene_${scene.sceneNumber}`,
          type: 'scene' as const,
          name: scene.title || `Scene ${scene.sceneNumber}`,
          status,
          regenerationCount: scene.regenerationCount,
          contentArtifactId: scene.contentArtifactId,
          imageArtifactId: scene.imageArtifactId,
          videoArtifactId: scene.videoArtifactId,
          approvedAt,
          feedback: scene.feedback,
        };
      });

    default:
      return [];
  }
}

/**
 * Get the next unapproved item for a given phase.
 * Returns null if all items are approved.
 */
export function getNextUnapprovedItem(project: ProjectFile, phase: WorkflowPhase): ItemApprovalEntry | null {
  const items = getPhaseItems(project, phase);
  return items.find(item => item.status !== 'approved') || null;
}

/**
 * Check if all items in a phase are approved.
 */
export function areAllItemsApproved(project: ProjectFile, phase: WorkflowPhase): boolean {
  const config = PHASE_CONFIGS[phase];
  if (!config) {
    return false; // No config, can't determine approval status
  }

  // Single-item phases don't have per-item approval
  if (config.itemProcessMode === 'single') {
    return true;
  }

  const items = getPhaseItems(project, phase);
  return items.length > 0 && items.every(item => item.status === 'approved');
}

/**
 * Count approved items in a phase.
 */
export function countApprovedItems(project: ProjectFile, phase: WorkflowPhase): { approved: number; total: number } {
  const items = getPhaseItems(project, phase);
  const approved = items.filter(item => item.status === 'approved').length;
  return { approved, total: items.length };
}

/**
 * Create a default CharacterData entry.
 */
export function createDefaultCharacterData(name: string): CharacterData {
  return {
    name,
    description: '',
    visualDescription: '',
    approvalStatus: 'pending',
    regenerationCount: 0,
  };
}

/**
 * Create a default SettingData entry.
 */
export function createDefaultSettingData(name: string): SettingData {
  return {
    name,
    description: '',
    visualDescription: '',
    approvalStatus: 'pending',
    regenerationCount: 0,
  };
}

/**
 * Create a default SceneRef entry.
 */
export function createDefaultSceneRef(sceneNumber: number, title?: string): SceneRef {
  const sceneFolder = `agent/scenes/scene-${String(sceneNumber).padStart(3, '0')}`;
  return {
    sceneNumber,
    folder: sceneFolder,
    file: `${sceneFolder}/scene.md`,
    title,
    contentApprovalStatus: 'pending',
    imageApprovalStatus: 'pending',
    videoApprovalStatus: 'pending',
    regenerationCount: 0,
  };
}

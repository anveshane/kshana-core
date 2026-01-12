/**
 * Type definitions for the video editing workflow.
 * 8-phase workflow: ingest → script_parse → analysis → enhancement_plan → asset_generation → composition → preview → export
 */

/**
 * Project file version for video editing workflow.
 */
export const PROJECT_VERSION = '3.0';

/**
 * Project directory name for video editing projects.
 */
export const PROJECT_DIR = '.kshana-edit';

/**
 * Project file name within PROJECT_DIR.
 */
export const PROJECT_FILE = 'project.json';

// ============================================================================
// Input Types
// ============================================================================

/**
 * Source type for the input video.
 */
export type InputSourceType = 'local_file' | 'url' | 'cloud_storage';

/**
 * Cloud storage provider.
 */
export type CloudProvider = 'google_drive' | 'dropbox' | 's3';

/**
 * Script format types that can be auto-detected or specified.
 */
export type ScriptFormat = 'srt' | 'vtt' | 'screenplay' | 'timestamped_text' | 'plain_text' | 'auto_detect';

// ============================================================================
// Enhancement Types
// ============================================================================

/**
 * Types of AI-generated enhancements.
 */
export type EnhancementType =
  | 'ai_image'        // AI-generated illustrations, diagrams, B-roll
  | 'ai_video_clip'   // Short animated content (5-10 sec)
  | 'motion_graphic'  // Lower thirds, text animations, transitions
  | 'audio_music'     // Background music (AI or stock)
  | 'audio_sfx';      // Sound effects

/**
 * Composition mode for how enhancements are placed on the video.
 */
export type CompositionMode =
  | 'pip_overlay'     // Picture-in-picture overlay
  | 'broll_cut'       // Full replacement cut (B-roll)
  | 'split_screen'    // Side-by-side or grid layout
  | 'lower_third'     // Text overlay at bottom
  | 'full_overlay';   // Full screen overlay with transparency

/**
 * Source of the enhancement suggestion.
 */
export type SuggestionSource = 'ai_suggested' | 'user_hint';

// ============================================================================
// Workflow Phases
// ============================================================================

/**
 * Video editing workflow phases in execution order.
 */
export enum EditWorkflowPhase {
  /** Phase 1: Import video from local/URL/cloud, extract metadata */
  INGEST = 'ingest',

  /** Phase 2: Auto-detect format, parse script, align with video */
  SCRIPT_PARSE = 'script_parse',

  /** Phase 3: Identify enhancement opportunities from script */
  ANALYSIS = 'analysis',

  /** Phase 4: AI suggests placements + user hints, create enhancement timeline */
  ENHANCEMENT_PLAN = 'enhancement_plan',

  /** Phase 5: Generate AI images, video clips, motion graphics, audio */
  ASSET_GENERATION = 'asset_generation',

  /** Phase 6: Compose timeline with PIP/B-roll/split-screen */
  COMPOSITION = 'composition',

  /** Phase 7: Interactive timeline preview, per-segment approval */
  PREVIEW = 'preview',

  /** Phase 8: Render final video + export NLE project files */
  EXPORT = 'export',

  /** Workflow complete */
  COMPLETED = 'completed',
}

/**
 * Planner stage within a phase.
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
export type PhaseStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

/**
 * Phase metadata stored in project.json.
 */
export interface PhaseInfo {
  /** Current status of the phase */
  status: PhaseStatus;
  /** Current planner stage (if in_progress) */
  plannerStage?: PlannerStage;
  /** Path to the plan file (relative to project dir) */
  planFile?: string;
  /** Timestamp when phase was completed */
  completedAt: number | null;
  /** Number of refinement iterations */
  refinementCount?: number;
}

/**
 * Approval status for individual items.
 */
export type ItemApprovalStatus = 'pending' | 'in_review' | 'approved' | 'rejected' | 'regenerating';

// ============================================================================
// Time & Position Types
// ============================================================================

/**
 * Time range in milliseconds.
 */
export interface TimeRange {
  /** Start time in milliseconds */
  startMs: number;
  /** End time in milliseconds */
  endMs: number;
}

/**
 * Timecode representation (HH:MM:SS:FF).
 */
export interface Timecode {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  /** Total time in milliseconds */
  totalMs: number;
}

/**
 * Position on screen (normalized 0-1).
 */
export interface Position {
  x: number;
  y: number;
}

// ============================================================================
// Video Metadata
// ============================================================================

/**
 * Video metadata extracted from source.
 */
export interface VideoMetadata {
  /** Duration in milliseconds */
  durationMs: number;
  /** Width in pixels */
  width: number;
  /** Height in pixels */
  height: number;
  /** Frames per second */
  fps: number;
  /** Video codec */
  codec: string;
  /** Bitrate in kbps */
  bitrate: number;
  /** File size in bytes */
  fileSize: number;
  /** Container format (mp4, mov, etc.) */
  format: string;
  /** Audio tracks info */
  audioTracks: AudioTrackInfo[];
  /** Path to thumbnail image */
  thumbnailPath?: string;
}

/**
 * Audio track information.
 */
export interface AudioTrackInfo {
  /** Track index */
  index: number;
  /** Audio codec */
  codec: string;
  /** Number of channels */
  channels: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Language code (if available) */
  language?: string;
}

// ============================================================================
// Script Types
// ============================================================================

/**
 * Parsed script segment.
 */
export interface ScriptSegment {
  /** Unique identifier */
  id: string;
  /** Sequential index */
  index: number;
  /** Time range in the video (if timestamped) */
  timeRange?: TimeRange;
  /** The text content */
  text: string;
  /** Speaker name (for dialogue) */
  speaker?: string;
  /** Scene number (for screenplay format) */
  sceneNumber?: number;
  /** Type of segment */
  type: 'dialogue' | 'narration' | 'action' | 'scene_heading' | 'transition' | 'unknown';
  /** Keywords extracted for enhancement matching */
  keywords?: string[];
}

// ============================================================================
// Enhancement Types
// ============================================================================

/**
 * Enhancement suggestion from AI or user.
 */
export interface EnhancementSuggestion {
  /** Unique identifier */
  id: string;
  /** Type of enhancement */
  type: EnhancementType;
  /** How to compose on the video */
  compositionMode: CompositionMode;
  /** Where in the video to place this */
  timeRange: TimeRange;
  /** Source of the suggestion */
  source: SuggestionSource;
  /** Confidence score (0-1) for AI suggestions */
  confidence: number;
  /** Human-readable description */
  description: string;
  /** Prompt for AI generation (if applicable) */
  prompt?: string;
  /** User's original hint text */
  userHint?: string;
  /** Associated script segment ID */
  scriptSegmentId?: string;
  /** Approval status */
  approvalStatus: ItemApprovalStatus;
  /** User feedback (if rejected) */
  feedback?: string;
  /** Timestamp when approved */
  approvedAt?: number;
  /** Number of regeneration attempts */
  regenerationCount: number;
}

// ============================================================================
// Asset Types
// ============================================================================

/**
 * Asset type for generated content.
 */
export type AssetType =
  | 'source_video'
  | 'thumbnail'
  | 'ai_image'
  | 'ai_video_clip'
  | 'motion_graphic'
  | 'audio_music'
  | 'audio_sfx'
  | 'audio_user'
  | 'preview_segment'
  | 'final_video';

/**
 * Generated or imported asset.
 */
export interface AssetInfo {
  /** Unique identifier */
  id: string;
  /** Asset type */
  type: AssetType;
  /** File path relative to project directory */
  path: string;
  /** Thumbnail path (for video/image assets) */
  thumbnailPath?: string;
  /** Duration in milliseconds (for video/audio) */
  durationMs?: number;
  /** Creation timestamp */
  createdAt: number;
  /** Associated enhancement ID */
  enhancementId?: string;
  /** Generation metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Timeline Types
// ============================================================================

/**
 * Timeline track type.
 */
export type TrackType = 'primary' | 'broll' | 'pip' | 'overlay' | 'audio' | 'motion_graphics';

/**
 * Timeline track containing clips.
 */
export interface TimelineTrack {
  /** Unique identifier */
  id: string;
  /** Track type */
  type: TrackType;
  /** Display label */
  label: string;
  /** Layer index (0 = bottom) */
  index: number;
  /** Clips on this track */
  clips: TimelineClip[];
  /** Whether track is muted */
  muted: boolean;
  /** Track opacity (0-1) for video tracks */
  opacity: number;
  /** Track volume (0-1) for audio tracks */
  volume: number;
}

/**
 * Transition effect between clips.
 */
export interface TransitionEffect {
  type: 'cut' | 'fade' | 'dissolve' | 'wipe' | 'slide';
  durationMs: number;
  easing?: string;
}

/**
 * Clip on a timeline track.
 */
export interface TimelineClip {
  /** Unique identifier */
  id: string;
  /** Parent track ID */
  trackId: string;
  /** Asset ID (null for source video) */
  assetId?: string;
  /** Whether this is the source video */
  isSourceVideo: boolean;
  /** Position on timeline */
  timeRange: TimeRange;
  /** Source range within the asset */
  sourceRange?: TimeRange;
  /** Composition mode */
  compositionMode: CompositionMode;
  /** Position for PIP/overlay (normalized 0-1) */
  position?: Position;
  /** Scale factor */
  scale?: number;
  /** Opacity (0-1) */
  opacity: number;
  /** Transition in effect */
  transitionIn?: TransitionEffect;
  /** Transition out effect */
  transitionOut?: TransitionEffect;
}

/**
 * Composed segment for preview/approval.
 */
export interface ComposedSegment {
  /** Unique identifier */
  id: string;
  /** Sequential index */
  index: number;
  /** Time range in the final video */
  timeRange: TimeRange;
  /** Path to rendered preview */
  previewPath?: string;
  /** Thumbnail path */
  thumbnailPath?: string;
  /** Track IDs involved */
  trackIds: string[];
  /** Enhancement IDs involved */
  enhancementIds: string[];
  /** Approval status */
  approvalStatus: ItemApprovalStatus;
  /** User feedback */
  feedback?: string;
  /** Timestamp when approved */
  approvedAt?: number;
}

// ============================================================================
// Export Types
// ============================================================================

/**
 * Video export configuration.
 */
export interface VideoExportConfig {
  /** Output format */
  format: 'mp4' | 'mov' | 'webm';
  /** Video codec */
  codec: 'h264' | 'h265' | 'prores' | 'vp9';
  /** Output resolution */
  resolution: { width: number; height: number };
  /** Frame rate */
  fps: number;
  /** Bitrate in kbps (optional, uses default if not set) */
  bitrate?: number;
  /** Audio codec */
  audioCodec: 'aac' | 'mp3' | 'pcm';
  /** Audio sample rate */
  audioSampleRate: 44100 | 48000;
}

/**
 * NLE export format.
 */
export type NLEFormat = 'davinci_resolve' | 'premiere_pro' | 'final_cut' | 'edl' | 'xml';

/**
 * NLE project export information.
 */
export interface NLEExportInfo {
  /** Export format */
  format: NLEFormat;
  /** Output file path */
  path: string;
  /** Export timestamp */
  exportedAt: number;
}

// ============================================================================
// Main Project File
// ============================================================================

/**
 * Main project file structure for video editing workflow.
 */
export interface VideoEditProjectFile {
  /** Project version - must be '3.0' for video editing workflow */
  version: '3.0';
  /** Unique project identifier */
  id: string;
  /** Project title */
  title: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;

  /** Source video information */
  source: {
    /** Input source type */
    type: InputSourceType;
    /** Path to source video (local path or URL) */
    path: string;
    /** Cloud provider (if cloud_storage) */
    cloudProvider?: CloudProvider;
    /** Extracted metadata */
    metadata?: VideoMetadata;
    /** Import timestamp */
    importedAt: number;
  };

  /** Script information */
  script: {
    /** Detected or specified format */
    format: ScriptFormat;
    /** Original script file path (if uploaded) */
    originalPath?: string;
    /** Raw script content */
    content: string;
    /** Parse timestamp */
    parsedAt?: number;
    /** Parsed segments */
    segments: ScriptSegment[];
  };

  /** Current workflow phase */
  currentPhase: EditWorkflowPhase;

  /** Phase status tracking */
  phases: {
    ingest: PhaseInfo;
    script_parse: PhaseInfo;
    analysis: PhaseInfo;
    enhancement_plan: PhaseInfo;
    asset_generation: PhaseInfo;
    composition: PhaseInfo;
    preview: PhaseInfo;
    export: PhaseInfo;
  };

  /** Enhancement suggestions */
  enhancements: EnhancementSuggestion[];

  /** Generated assets */
  assets: AssetInfo[];

  /** Timeline composition */
  timeline: {
    /** Total duration in milliseconds */
    durationMs: number;
    /** Frame rate */
    frameRate: number;
    /** Resolution */
    resolution: { width: number; height: number };
    /** Timeline tracks */
    tracks: TimelineTrack[];
    /** Composed segments for preview */
    segments: ComposedSegment[];
  };

  /** Export configuration */
  exportConfig?: VideoExportConfig;

  /** Exported files */
  exportedFiles?: {
    /** Final video path */
    videoPath?: string;
    /** NLE project exports */
    nleProjects: NLEExportInfo[];
  };
}

// ============================================================================
// Phase Configuration
// ============================================================================

/**
 * Agent type for a phase.
 */
export type AgentType = 'pipeline' | 'content' | 'planning' | 'image' | 'video' | 'preview' | 'export';

/**
 * Item processing mode for a phase.
 */
export type ItemProcessMode =
  | 'single'              // Single operation (ingest, export)
  | 'list_enhancements'   // Process each enhancement
  | 'list_assets'         // Process each asset to generate
  | 'list_segments'       // Process each timeline segment
  | 'list_preview_segments'; // Process each preview segment

/**
 * Configuration for each workflow phase.
 */
export interface PhaseConfig {
  /** Phase identifier */
  phase: EditWorkflowPhase;
  /** Human-readable name */
  displayName: string;
  /** Next phase after completion */
  nextPhase: EditWorkflowPhase | null;
  /** Prompt file name (without extension) */
  promptFile: string;
  /** Path to plan output file (relative to project dir) */
  planOutputFile?: string;
  /** Primary agent type */
  agentType: AgentType;
  /** Allowed tools in this phase */
  allowedTools: string[];
  /** How items are processed */
  itemProcessMode: ItemProcessMode;
  /** Whether each item requires individual approval */
  requiresPerItemApproval: boolean;
  /** Is this an expensive phase (generation)? */
  isExpensive: boolean;
  /** Description of what this phase does */
  description: string;
}

/**
 * Phase configurations for the 8-phase video editing workflow.
 */
export const PHASE_CONFIGS: Record<EditWorkflowPhase, PhaseConfig> = {
  [EditWorkflowPhase.INGEST]: {
    phase: EditWorkflowPhase.INGEST,
    displayName: 'Video Import',
    nextPhase: EditWorkflowPhase.SCRIPT_PARSE,
    promptFile: 'ingest',
    planOutputFile: 'plans/ingest.md',
    agentType: 'pipeline',
    allowedTools: ['import_video', 'extract_metadata', 'generate_thumbnails', 'read_project', 'update_project'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Import source video and extract metadata',
  },

  [EditWorkflowPhase.SCRIPT_PARSE]: {
    phase: EditWorkflowPhase.SCRIPT_PARSE,
    displayName: 'Script Parsing',
    nextPhase: EditWorkflowPhase.ANALYSIS,
    promptFile: 'script-parse',
    planOutputFile: 'plans/script-parse.md',
    agentType: 'content',
    allowedTools: ['parse_script', 'detect_script_format', 'align_script_to_video', 'read_file', 'write_file', 'read_project', 'update_project'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Parse script and align segments with video',
  },

  [EditWorkflowPhase.ANALYSIS]: {
    phase: EditWorkflowPhase.ANALYSIS,
    displayName: 'Content Analysis',
    nextPhase: EditWorkflowPhase.ENHANCEMENT_PLAN,
    promptFile: 'analysis',
    planOutputFile: 'plans/analysis.md',
    agentType: 'content',
    allowedTools: ['identify_enhancement_opportunities', 'extract_frame', 'read_file', 'read_project', 'update_project'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Identify enhancement opportunities from script',
  },

  [EditWorkflowPhase.ENHANCEMENT_PLAN]: {
    phase: EditWorkflowPhase.ENHANCEMENT_PLAN,
    displayName: 'Enhancement Planning',
    nextPhase: EditWorkflowPhase.ASSET_GENERATION,
    promptFile: 'enhancement-plan',
    planOutputFile: 'plans/enhancement-plan.md',
    agentType: 'planning',
    allowedTools: ['suggest_enhancement', 'approve_enhancement', 'reject_enhancement', 'add_user_hint', 'ask_user', 'read_project', 'update_project', 'todo_write'],
    itemProcessMode: 'list_enhancements',
    requiresPerItemApproval: true,
    isExpensive: false,
    description: 'Create and approve enhancement plan',
  },

  [EditWorkflowPhase.ASSET_GENERATION]: {
    phase: EditWorkflowPhase.ASSET_GENERATION,
    displayName: 'Asset Generation',
    nextPhase: EditWorkflowPhase.COMPOSITION,
    promptFile: 'asset-generation',
    planOutputFile: 'plans/asset-generation.md',
    agentType: 'image',
    allowedTools: ['generate_image', 'generate_motion_graphic', 'generate_ai_video_clip', 'generate_ai_audio', 'import_stock_asset', 'wait_for_job', 'read_project', 'update_project', 'todo_write'],
    itemProcessMode: 'list_assets',
    requiresPerItemApproval: true,
    isExpensive: true,
    description: 'Generate AI images, video clips, motion graphics, and audio',
  },

  [EditWorkflowPhase.COMPOSITION]: {
    phase: EditWorkflowPhase.COMPOSITION,
    displayName: 'Timeline Composition',
    nextPhase: EditWorkflowPhase.PREVIEW,
    promptFile: 'composition',
    planOutputFile: 'plans/composition.md',
    agentType: 'video',
    allowedTools: ['create_track', 'add_clip', 'set_clip_properties', 'add_transition', 'compose_pip', 'compose_broll_cut', 'compose_split_screen', 'get_timeline_state', 'read_project', 'update_project', 'todo_write'],
    itemProcessMode: 'list_segments',
    requiresPerItemApproval: true,
    isExpensive: false,
    description: 'Compose timeline with enhancements',
  },

  [EditWorkflowPhase.PREVIEW]: {
    phase: EditWorkflowPhase.PREVIEW,
    displayName: 'Preview & Approval',
    nextPhase: EditWorkflowPhase.EXPORT,
    promptFile: 'preview',
    planOutputFile: 'plans/preview.md',
    agentType: 'preview',
    allowedTools: ['render_preview_segment', 'generate_timeline_preview', 'approve_segment', 'reject_segment', 'ask_user', 'read_project', 'update_project', 'todo_write'],
    itemProcessMode: 'list_preview_segments',
    requiresPerItemApproval: true,
    isExpensive: true,
    description: 'Interactive timeline preview with per-segment approval',
  },

  [EditWorkflowPhase.EXPORT]: {
    phase: EditWorkflowPhase.EXPORT,
    displayName: 'Final Export',
    nextPhase: EditWorkflowPhase.COMPLETED,
    promptFile: 'export',
    planOutputFile: 'plans/export.md',
    agentType: 'export',
    allowedTools: ['render_final_video', 'export_davinci_project', 'export_premiere_project', 'export_fcpxml', 'get_export_status', 'wait_for_job', 'read_project', 'update_project'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: true,
    description: 'Render final video and export NLE project files',
  },

  [EditWorkflowPhase.COMPLETED]: {
    phase: EditWorkflowPhase.COMPLETED,
    displayName: 'Completed',
    nextPhase: null,
    promptFile: 'completed',
    agentType: 'planning',
    allowedTools: ['read_project'],
    itemProcessMode: 'single',
    requiresPerItemApproval: false,
    isExpensive: false,
    description: 'Workflow complete - present final outputs to user',
  },
};

/**
 * Order of phases for iteration.
 */
export const PHASE_ORDER: EditWorkflowPhase[] = [
  EditWorkflowPhase.INGEST,
  EditWorkflowPhase.SCRIPT_PARSE,
  EditWorkflowPhase.ANALYSIS,
  EditWorkflowPhase.ENHANCEMENT_PLAN,
  EditWorkflowPhase.ASSET_GENERATION,
  EditWorkflowPhase.COMPOSITION,
  EditWorkflowPhase.PREVIEW,
  EditWorkflowPhase.EXPORT,
  EditWorkflowPhase.COMPLETED,
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert milliseconds to timecode.
 */
export function msToTimecode(ms: number, fps: number = 30): Timecode {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const frames = Math.floor((ms % 1000) / (1000 / fps));

  return {
    hours,
    minutes,
    seconds,
    frames,
    totalMs: ms,
  };
}

/**
 * Convert timecode to milliseconds.
 */
export function timecodeToMs(tc: Timecode): number {
  return tc.totalMs;
}

/**
 * Format timecode as string (HH:MM:SS:FF).
 */
export function formatTimecode(tc: Timecode): string {
  const pad = (n: number, len: number = 2) => n.toString().padStart(len, '0');
  return `${pad(tc.hours)}:${pad(tc.minutes)}:${pad(tc.seconds)}:${pad(tc.frames)}`;
}

/**
 * Format milliseconds as MM:SS.
 */
export function formatTimeShort(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Create a default phase info object.
 */
export function createDefaultPhaseInfo(): PhaseInfo {
  return {
    status: 'pending',
    completedAt: null,
  };
}

/**
 * Create a default enhancement suggestion.
 */
export function createDefaultEnhancement(
  type: EnhancementType,
  timeRange: TimeRange,
  description: string
): EnhancementSuggestion {
  return {
    id: `enh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    compositionMode: 'broll_cut',
    timeRange,
    source: 'ai_suggested',
    confidence: 0.5,
    description,
    approvalStatus: 'pending',
    regenerationCount: 0,
  };
}

/**
 * Create a default timeline track.
 */
export function createDefaultTrack(type: TrackType, label: string, index: number): TimelineTrack {
  return {
    id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    label,
    index,
    clips: [],
    muted: false,
    opacity: 1,
    volume: 1,
  };
}

/**
 * Create a default timeline clip.
 */
export function createDefaultClip(
  trackId: string,
  timeRange: TimeRange,
  isSourceVideo: boolean = false
): TimelineClip {
  return {
    id: `clip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    trackId,
    isSourceVideo,
    timeRange,
    compositionMode: isSourceVideo ? 'broll_cut' : 'pip_overlay',
    opacity: 1,
  };
}

/**
 * Determine the next phase based on current project state.
 */
export function determineNextPhase(project: VideoEditProjectFile): {
  nextPhase: EditWorkflowPhase;
  reason: string;
  isAutomatic: boolean;
} {
  const currentPhase = project.currentPhase;
  const phaseKey = currentPhase as keyof typeof project.phases;
  const phaseInfo = project.phases[phaseKey];

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

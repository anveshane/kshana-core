/**
 * Timeline Types
 *
 * Types for the duration-aware planning and multi-layer timeline system.
 * The timeline serves as the single source of truth for the final video —
 * what content goes where, for how long, and how layers composite.
 */

/**
 * How layers within a segment interact visually.
 */
export type CompositingMode = 'replace' | 'side_by_side' | 'pip' | 'overlay';

/**
 * Visual transition type between segments.
 *
 * Basic:
 *   cut         — hard cut, no transition
 *   crossfade   — dissolve between clips (alias for dissolve)
 *   fade        — fade through black
 *   dissolve    — cross-dissolve
 *
 * Cinematic (FFmpeg xfade):
 *   dip_to_black    — fade out → brief black → fade in (trailer-style breather)
 *   flash_to_white  — quick white flash between cuts (impact/smash cut)
 *   wipe_left       — directional wipe
 *   wipe_right      — directional wipe
 *   wipe_up         — directional wipe
 *   wipe_down       — directional wipe
 *   circle_open     — iris open (expanding circle reveal)
 *   circle_close    — iris close (contracting circle, "blink" effect)
 *   radial          — radial wipe
 *   slide_left      — new shot slides in from right
 *   slide_right     — new shot slides in from left
 */
export type TransitionType =
  | 'cut' | 'crossfade' | 'fade' | 'dissolve'
  | 'dip_to_black' | 'flash_to_white'
  | 'wipe_left' | 'wipe_right' | 'wipe_up' | 'wipe_down'
  | 'circle_open' | 'circle_close' | 'radial'
  | 'slide_left' | 'slide_right';

/**
 * Easing function for compositing transitions.
 */
export type EasingType = 'ease_in_out' | 'ease_in' | 'ease_out' | 'linear';

/**
 * Type of content a layer represents.
 */
export type LayerType = 'visual' | 'audio' | 'overlay' | 'narration_video';

/**
 * How complete a segment's content is.
 */
export type SegmentFillStatus = 'empty' | 'planned' | 'filled';

/**
 * Where a layer's asset comes from.
 */
export type LayerAssetSource = 'generated' | 'imported' | 'user_provided' | 'placeholder';

/**
 * Animated change in compositing mode between adjacent segments.
 * Only relevant when the previous segment's compositingMode differs from the current one.
 */
export interface CompositingTransition {
  /** Whether to animate smoothly or cut instantly */
  type: 'animate' | 'cut';
  /** How long the compositing morph takes (ms) */
  durationMs: number;
  /** Easing function for the animation */
  easing: EasingType;
}

/**
 * Transition configuration for a segment.
 * Defines how this segment transitions from the previous one.
 */
export interface SegmentTransition {
  /** Visual transition type for the primary content */
  type: TransitionType;
  /** How long the visual transition takes (ms) */
  durationMs: number;
  /** Animated change in compositing mode (only when adjacent segments differ) */
  compositingTransition?: CompositingTransition;
}

/**
 * Metadata for compositing configuration.
 * Provides parameters for non-trivial compositing modes.
 */
export interface CompositingMetadata {
  /** For pip: position of the inset window */
  pipPosition?: 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right';
  /** For pip: size as percentage of frame (0-1) */
  pipScale?: number;
  /** For side_by_side: split ratio (0-1, proportion of left side) */
  splitRatio?: number;
  /** For overlay: opacity of the overlay layer (0-1) */
  overlayOpacity?: number;
}

/**
 * A single layer entry within a segment.
 * References an asset (by artifact ID or file path) and defines its role.
 */
export interface TimelineLayerEntry {
  /** Layer type determining its role */
  type: LayerType;
  /** Reference to the asset's artifact ID (from the project's artifact system) */
  artifactId?: string;
  /** Direct file path to the asset (alternative to artifactId) */
  filePath?: string;
  /** Human-readable label for this layer */
  label: string;
  /** Where this asset came from */
  source: LayerAssetSource;
  /** Optional metadata (e.g., volume for audio, position for overlay) */
  metadata?: Record<string, unknown>;
}

/**
 * A time slot in the timeline.
 * Each segment represents a portion of the video with its own layers and compositing.
 */
export interface TimelineSegment {
  /** Unique segment identifier */
  id: string;
  /** Human-readable label (e.g., "Scene 1: The Discovery") */
  label: string;
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Duration in seconds (endTime - startTime) */
  duration: number;
  /** How layers interact in this segment */
  compositingMode: CompositingMode;
  /** Additional compositing parameters */
  compositingMetadata?: CompositingMetadata;
  /** How complete this segment's content is */
  fillStatus: SegmentFillStatus;
  /** Content layers for this segment */
  layers: TimelineLayerEntry[];
  /** Transition from the previous segment */
  transition?: SegmentTransition;
  /** History of previous layer versions (auto-populated on regeneration) */
  layerHistory?: LayerSnapshot[];
  /** Current version info for this segment */
  versionInfo?: SegmentVersionInfo;
  /** Optional segment metadata for shot identity, prompt provenance, etc. */
  metadata?: Record<string, unknown>;
}

/**
 * Snapshot of a segment's layers at a point in time.
 * Created automatically when update_segment replaces existing filled layers.
 */
export interface LayerSnapshot {
  version: number;
  layers: TimelineLayerEntry[];
  createdAt: string;
  /** The prompt/instruction that produced these layers */
  prompt?: string;
  /** Human-readable note */
  note?: string;
}

export interface SegmentVersionInfo {
  activeVersion: number;
  totalVersions: number;
}

/**
 * A gap in the timeline where no content exists.
 */
export interface TimelineGap {
  /** Start time of the gap in seconds */
  startTime: number;
  /** End time of the gap in seconds */
  endTime: number;
  /** Duration of the gap in seconds */
  duration: number;
}

/**
 * Validation result for a timeline.
 */
export interface TimelineValidation {
  /** Whether the timeline is complete and ready for assembly */
  isComplete: boolean;
  /** Total duration covered by filled segments */
  filledDuration: number;
  /** Time gaps where no content exists */
  gaps: TimelineGap[];
  /** Warning messages */
  warnings: string[];
}

/**
 * A global layer spanning the full video (e.g., narration audio, background music).
 */
export interface TimelineGlobalLayer {
  /** Layer type */
  type: LayerType;
  /** Path to the audio/video file */
  filePath?: string;
  /** Artifact ID reference */
  artifactId?: string;
  /** Human-readable label */
  label: string;
  /** Where this asset came from */
  source: LayerAssetSource;
}

/**
 * The complete timeline for a video project.
 * Serves as the single source of truth for the final video assembly.
 */
export interface Timeline {
  /** Schema version */
  version: '1.0' | '1.1';
  /** Total target duration in seconds */
  totalDuration: number;
  /** Default compositing mode for new segments */
  defaultCompositingMode: CompositingMode;
  /** Ordered list of time segments */
  segments: TimelineSegment[];
  /** Layers that span the entire video */
  globalLayers: TimelineGlobalLayer[];
  /** Validation state (recomputed on demand) */
  validation: TimelineValidation;
}

/**
 * Constraints for segment durations based on generation capabilities.
 */
export interface DurationConstraints {
  /** Maximum duration for a single generated video clip (seconds) */
  maxClipDuration: number;
  /** Maximum duration for displaying a single image (seconds) */
  maxImageDuration: number;
  /** Minimum segment duration (seconds) */
  minSegmentDuration: number;
}

/**
 * Descriptor for creating a segment in the skeleton.
 * Used when the agent plans segments before content is generated.
 */
export interface SegmentDescriptor {
  /** Human-readable label */
  label: string;
  /** Suggested duration in seconds (optional — will be auto-calculated if omitted) */
  suggestedDuration?: number;
  /** Compositing mode override for this segment */
  compositingMode?: CompositingMode;
  /** Custom segment ID (defaults to segment_N if omitted) */
  id?: string;
}

/**
 * Timeline Module
 *
 * Duration-aware planning and multi-layer timeline system.
 * The timeline serves as the single source of truth for video assembly.
 */

// Types
export type {
  Timeline,
  TimelineSegment,
  TimelineLayerEntry,
  TimelineValidation,
  TimelineGap,
  TimelineGlobalLayer,
  CompositingMode,
  CompositingMetadata,
  CompositingTransition,
  SegmentTransition,
  TransitionType,
  EasingType,
  LayerType,
  SegmentFillStatus,
  LayerAssetSource,
  DurationConstraints,
  SegmentDescriptor,
} from './types.js';

// Manager functions
export {
  createTimelineSkeleton,
  updateSegmentLayers,
  setSegmentCompositing,
  setSegmentTransition,
  addGlobalLayer,
  validateTimeline,
  calculateSegmentDurations,
  loadTimeline,
  saveTimeline,
} from './TimelineManager.js';

// Tool creators
export {
  createManageTimelineTool,
  createAssembleFromTimelineTool,
  createTimelineTools,
  type TimelineToolContext,
} from './TimelineTools.js';

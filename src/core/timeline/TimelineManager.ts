/**
 * TimelineManager
 *
 * Pure functions for creating, updating, validating, and persisting timelines.
 * No tool concerns — this module is the core logic layer.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type {
  Timeline,
  TimelineSegment,
  TimelineLayerEntry,
  TimelineValidation,
  TimelineGap,
  TimelineGlobalLayer,
  CompositingMode,
  SegmentFillStatus,
  DurationConstraints,
  SegmentDescriptor,
} from './types.js';

/** Default constraints based on current generation capabilities */
const DEFAULT_CONSTRAINTS: DurationConstraints = {
  maxClipDuration: 10,
  maxImageDuration: 10,
  minSegmentDuration: 3,
};

const TIMELINE_FILENAME = 'timeline.json';

/**
 * Calculate how to divide total duration among segments.
 *
 * If descriptors provide suggested durations, those are used as weights
 * for proportional allocation. Otherwise, duration is split equally.
 */
export function calculateSegmentDurations(
  totalDuration: number,
  descriptors: SegmentDescriptor[],
  constraints: DurationConstraints = DEFAULT_CONSTRAINTS
): number[] {
  const count = descriptors.length;
  if (count === 0) return [];

  // Check if any descriptors have suggested durations
  const hasSuggestions = descriptors.some(d => d.suggestedDuration !== undefined);

  let durations: number[];

  if (hasSuggestions) {
    // Use suggested durations as proportional weights
    const totalSuggested = descriptors.reduce(
      (sum, d) => sum + (d.suggestedDuration ?? totalDuration / count),
      0
    );
    const scale = totalDuration / totalSuggested;
    durations = descriptors.map(
      d => (d.suggestedDuration ?? totalDuration / count) * scale
    );
  } else {
    // Equal split
    durations = new Array(count).fill(totalDuration / count);
  }

  // Enforce minimum segment duration
  durations = durations.map(d => Math.max(d, constraints.minSegmentDuration));

  // Re-normalize to fit total duration after enforcing minimums
  const currentTotal = durations.reduce((sum, d) => sum + d, 0);
  if (currentTotal !== totalDuration && currentTotal > 0) {
    const adjustmentFactor = totalDuration / currentTotal;
    durations = durations.map(d => Math.round(d * adjustmentFactor * 100) / 100);
  }

  // Fix any floating point drift on the last segment
  const almostTotal = durations.slice(0, -1).reduce((sum, d) => sum + d, 0);
  durations[durations.length - 1] = Math.round((totalDuration - almostTotal) * 100) / 100;

  return durations;
}

/**
 * Create a timeline skeleton from segment descriptors and total duration.
 *
 * This divides the total duration among segments and sets up empty layers.
 * Called after segments are planned but before content is generated.
 */
export function createTimelineSkeleton(
  totalDuration: number,
  descriptors: SegmentDescriptor[],
  defaultCompositingMode: CompositingMode = 'replace'
): Timeline {
  const durations = calculateSegmentDurations(totalDuration, descriptors);

  let currentTime = 0;
  const segments: TimelineSegment[] = descriptors.map((desc, index) => {
    const duration = durations[index] ?? 0;
    const segment: TimelineSegment = {
      id: `segment_${index}`,
      label: desc.label,
      startTime: Math.round(currentTime * 100) / 100,
      endTime: Math.round((currentTime + duration) * 100) / 100,
      duration: Math.round(duration * 100) / 100,
      compositingMode: desc.compositingMode ?? defaultCompositingMode,
      fillStatus: 'empty',
      layers: [],
    };
    currentTime += duration;
    return segment;
  });

  const timeline: Timeline = {
    version: '1.0',
    totalDuration,
    defaultCompositingMode,
    segments,
    globalLayers: [],
    validation: validateTimeline({
      version: '1.0',
      totalDuration,
      defaultCompositingMode,
      segments,
      globalLayers: [],
      validation: { isComplete: false, filledDuration: 0, gaps: [], warnings: [] },
    }),
  };

  return timeline;
}

/**
 * Update a segment's layers and fill status.
 *
 * Returns a new timeline with the updated segment.
 */
export function updateSegmentLayers(
  timeline: Timeline,
  segmentId: string,
  layers: TimelineLayerEntry[],
  fillStatus?: SegmentFillStatus
): Timeline {
  const segmentIndex = timeline.segments.findIndex(s => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new Error(`Segment not found: ${segmentId}`);
  }

  const updatedSegments = [...timeline.segments];
  const existing = updatedSegments[segmentIndex]!;

  // Determine fill status: if layers contain a visual, mark as filled
  const hasVisual = layers.some(l => l.type === 'visual' || l.type === 'narration_video');
  const newFillStatus = fillStatus ?? (hasVisual ? 'filled' : 'planned');

  updatedSegments[segmentIndex] = {
    ...existing,
    layers,
    fillStatus: newFillStatus,
  };

  const updated: Timeline = {
    ...timeline,
    segments: updatedSegments,
  };
  updated.validation = validateTimeline(updated);
  return updated;
}

/**
 * Set the compositing mode for a segment.
 */
export function setSegmentCompositing(
  timeline: Timeline,
  segmentId: string,
  compositingMode: CompositingMode,
  compositingMetadata?: Record<string, unknown>
): Timeline {
  const segmentIndex = timeline.segments.findIndex(s => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new Error(`Segment not found: ${segmentId}`);
  }

  const updatedSegments = [...timeline.segments];
  const existing = updatedSegments[segmentIndex]!;

  updatedSegments[segmentIndex] = {
    ...existing,
    compositingMode,
    ...(compositingMetadata ? { compositingMetadata } : {}),
  };

  return {
    ...timeline,
    segments: updatedSegments,
  };
}

/**
 * Set the transition for a segment.
 */
export function setSegmentTransition(
  timeline: Timeline,
  segmentId: string,
  transition: TimelineSegment['transition']
): Timeline {
  const segmentIndex = timeline.segments.findIndex(s => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new Error(`Segment not found: ${segmentId}`);
  }

  const updatedSegments = [...timeline.segments];
  const existing = updatedSegments[segmentIndex]!;

  updatedSegments[segmentIndex] = {
    ...existing,
    transition,
  };

  return {
    ...timeline,
    segments: updatedSegments,
  };
}

/**
 * Add a global layer (narration audio, background music, etc.).
 */
export function addGlobalLayer(
  timeline: Timeline,
  layer: TimelineGlobalLayer
): Timeline {
  return {
    ...timeline,
    globalLayers: [...timeline.globalLayers, layer],
  };
}

/**
 * Validate a timeline for completeness and consistency.
 *
 * Checks for:
 * - Segments with empty visual layers
 * - Time gaps between segments
 * - Time overlaps between segments
 * - Duration sum matching total duration
 */
export function validateTimeline(timeline: Timeline): TimelineValidation {
  const warnings: string[] = [];
  const gaps: TimelineGap[] = [];
  let filledDuration = 0;

  // Check each segment
  for (const segment of timeline.segments) {
    if (segment.fillStatus === 'filled') {
      filledDuration += segment.duration;
    }

    if (segment.fillStatus === 'empty') {
      warnings.push(`Segment "${segment.label}" (${segment.id}) has no content`);
    }

    const hasVisualLayer = segment.layers.some(
      l => l.type === 'visual' || l.type === 'narration_video'
    );
    if (segment.fillStatus === 'filled' && !hasVisualLayer) {
      warnings.push(
        `Segment "${segment.label}" (${segment.id}) is marked filled but has no visual layer`
      );
    }
  }

  // Check for gaps and overlaps between segments (sorted by startTime)
  const sorted = [...timeline.segments].sort((a, b) => a.startTime - b.startTime);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;

    const gapSize = curr.startTime - prev.endTime;
    if (gapSize > 0.01) {
      gaps.push({
        startTime: prev.endTime,
        endTime: curr.startTime,
        duration: Math.round(gapSize * 100) / 100,
      });
      warnings.push(
        `Gap of ${gapSize.toFixed(2)}s between "${prev.label}" and "${curr.label}"`
      );
    } else if (gapSize < -0.01) {
      warnings.push(
        `Overlap of ${Math.abs(gapSize).toFixed(2)}s between "${prev.label}" and "${curr.label}"`
      );
    }
  }

  // Check total duration coverage
  if (sorted.length > 0) {
    const firstStart = sorted[0]!.startTime;
    const lastEnd = sorted[sorted.length - 1]!.endTime;

    if (firstStart > 0.01) {
      gaps.unshift({
        startTime: 0,
        endTime: firstStart,
        duration: Math.round(firstStart * 100) / 100,
      });
      warnings.push(`Timeline starts at ${firstStart.toFixed(2)}s instead of 0s`);
    }

    const durationDiff = Math.abs(lastEnd - timeline.totalDuration);
    if (durationDiff > 0.1) {
      warnings.push(
        `Segments end at ${lastEnd.toFixed(2)}s but total duration is ${timeline.totalDuration}s`
      );
    }
  }

  const allFilled = timeline.segments.every(s => s.fillStatus === 'filled');
  const isComplete = allFilled && gaps.length === 0 && timeline.segments.length > 0;

  return {
    isComplete,
    filledDuration: Math.round(filledDuration * 100) / 100,
    gaps,
    warnings,
  };
}

/**
 * Split a scene segment into multiple shot sub-segments.
 *
 * Replaces the target segment with N shot segments, proportionally scaling
 * shot durations to fill the scene's allocated time. New segment IDs follow
 * the pattern `{sceneSegmentId}_shot_{n}`.
 *
 * @param timeline - The current timeline
 * @param sceneSegmentId - ID of the scene segment to split
 * @param shots - Array of shot descriptors with label, duration, and optional metadata
 * @returns Updated timeline with shot segments replacing the scene segment
 */
export function splitSegmentIntoShots(
  timeline: Timeline,
  sceneSegmentId: string,
  shots: Array<{ label: string; duration: number; metadata?: Record<string, unknown> }>
): Timeline {
  const segmentIndex = timeline.segments.findIndex(s => s.id === sceneSegmentId);
  if (segmentIndex === -1) {
    throw new Error(`Segment not found: ${sceneSegmentId}`);
  }
  if (shots.length === 0) {
    throw new Error('shots array must not be empty');
  }

  const sceneSegment = timeline.segments[segmentIndex]!;
  const sceneStart = sceneSegment.startTime;
  const sceneDuration = sceneSegment.duration;

  // Proportionally scale shot durations to fill the scene's allocated time
  const totalShotDuration = shots.reduce((sum, s) => sum + s.duration, 0);
  const scale = sceneDuration / totalShotDuration;

  const shotSegments: TimelineSegment[] = [];
  let currentTime = sceneStart;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    const isLast = i === shots.length - 1;
    const shotDuration = isLast
      ? Math.round((sceneSegment.endTime - currentTime) * 100) / 100
      : Math.round(shot.duration * scale * 100) / 100;

    shotSegments.push({
      id: `${sceneSegmentId}_shot_${i + 1}`,
      label: shot.label,
      startTime: Math.round(currentTime * 100) / 100,
      endTime: Math.round((currentTime + shotDuration) * 100) / 100,
      duration: shotDuration,
      compositingMode: sceneSegment.compositingMode,
      fillStatus: 'planned',
      layers: [],
      ...(shot.metadata ? { metadata: shot.metadata } : {}),
    });

    currentTime += shotDuration;
  }

  // Replace the scene segment with the shot segments
  const updatedSegments = [
    ...timeline.segments.slice(0, segmentIndex),
    ...shotSegments,
    ...timeline.segments.slice(segmentIndex + 1),
  ];

  const updated: Timeline = {
    ...timeline,
    segments: updatedSegments,
  };
  updated.validation = validateTimeline(updated);
  return updated;
}

/**
 * Load a timeline from disk.
 * Returns null if the file doesn't exist.
 */
export function loadTimeline(projectDir: string): Timeline | null {
  const filePath = join(projectDir, TIMELINE_FILENAME);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Timeline;
  } catch {
    return null;
  }
}

/**
 * Save a timeline to disk.
 * Creates the project directory if it doesn't exist.
 */
export function saveTimeline(projectDir: string, timeline: Timeline): void {
  const filePath = join(projectDir, TIMELINE_FILENAME);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Revalidate before saving
  timeline.validation = validateTimeline(timeline);

  writeFileSync(filePath, JSON.stringify(timeline, null, 2), 'utf-8');
}

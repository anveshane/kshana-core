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
  LayerSnapshot,
  SegmentVersionInfo,
} from './types.js';

export type LayerDowngradeReason =
  | 'missing_artifact_id'
  | 'missing_file_path'
  | 'video_over_weaker_media'
  | 'metadata_cleared';

export interface DowngradePrevention {
  preservedIndexes: number[];
  reasons: Array<{
    index: number;
    reason: LayerDowngradeReason;
  }>;
}

export interface UpdateSegmentLayersResult extends Timeline {
  downgradePrevention?: DowngradePrevention;
}

export interface UpsertSceneShotsResult {
  timeline: Timeline;
  preservedExistingShots: boolean;
  mergedMetadataIntoExistingShots: boolean;
}

function buildShotSegmentsFromContainer(
  sceneSegmentId: string,
  container: Pick<TimelineSegment, 'startTime' | 'endTime' | 'duration' | 'compositingMode'>,
  shots: Array<{ label: string; duration: number; metadata?: Record<string, unknown> }>
): TimelineSegment[] {
  if (shots.length === 0) {
    throw new Error('shots array must not be empty');
  }

  const totalShotDuration = shots.reduce((sum, s) => sum + s.duration, 0);
  const scale = container.duration / totalShotDuration;

  const shotSegments: TimelineSegment[] = [];
  let currentTime = container.startTime;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    const isLast = i === shots.length - 1;
    const shotDuration = isLast
      ? Math.round((container.endTime - currentTime) * 100) / 100
      : Math.round(shot.duration * scale * 100) / 100;

    shotSegments.push({
      id: `${sceneSegmentId}_shot_${i + 1}`,
      label: shot.label,
      startTime: Math.round(currentTime * 100) / 100,
      endTime: Math.round((currentTime + shotDuration) * 100) / 100,
      duration: shotDuration,
      compositingMode: container.compositingMode,
      fillStatus: 'planned',
      layers: [],
      ...(shot.metadata ? { metadata: shot.metadata } : {}),
    });

    currentTime += shotDuration;
  }

  return shotSegments;
}

/** Default constraints based on current generation capabilities */
const DEFAULT_CONSTRAINTS: DurationConstraints = {
  maxClipDuration: 10,
  maxImageDuration: 10,
  minSegmentDuration: 3,
};

const TIMELINE_FILENAME = 'timeline.json';

function isVisualLikeLayer(layer: TimelineLayerEntry | undefined): boolean {
  return layer?.type === 'visual' || layer?.type === 'narration_video';
}

function detectLayerMediaType(layer: TimelineLayerEntry | undefined): 'video' | 'image' | null {
  if (!layer) return null;
  if (layer.type === 'narration_video') return 'video';

  const path = layer.filePath?.toLowerCase() ?? '';
  if (/\.(mp4|mov|webm|m4v|avi|mkv)$/.test(path)) return 'video';
  if (/\.(png|jpe?g|webp|gif|avif|bmp)$/.test(path)) return 'image';

  const artifactId = layer.artifactId?.toLowerCase() ?? '';
  if (artifactId.startsWith('vid_')) return 'video';
  if (artifactId.startsWith('img_')) return 'image';

  const label = layer.label.toLowerCase();
  if (label.includes('video')) return 'video';
  if (label.includes('image')) return 'image';

  return null;
}

function mergeLayerMetadata(
  existingMetadata?: Record<string, unknown>,
  incomingMetadata?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!existingMetadata && !incomingMetadata) return undefined;
  return { ...(existingMetadata ?? {}), ...(incomingMetadata ?? {}) };
}

function hasUsefulMetadata(metadata?: Record<string, unknown>): boolean {
  if (!metadata) return false;
  const usefulKeys = [
    'prompt',
    'promptFile',
    'prompt_file',
    'motionPrompt',
    'motion_prompt',
    'negativePrompt',
    'negative_prompt',
    'shotType',
    'shot_type',
  ];
  return usefulKeys.some((key) => metadata[key] !== undefined);
}

function layersHaveEquivalentAssetIdentity(
  existing: TimelineLayerEntry[],
  next: TimelineLayerEntry[]
): boolean {
  const max = Math.max(existing.length, next.length);
  for (let i = 0; i < max; i++) {
    const left = existing[i];
    const right = next[i];
    if (!left || !right) return false;
    if (!isVisualLikeLayer(left) && !isVisualLikeLayer(right)) continue;
    if (left.type !== right.type) return false;
    if ((left.artifactId ?? '') !== (right.artifactId ?? '')) return false;
    if ((left.filePath ?? '') !== (right.filePath ?? '')) return false;
  }
  return true;
}

function isCompatibleShotUpdate(
  existingSegment: TimelineSegment,
  incomingShot: { label: string; duration: number; metadata?: Record<string, unknown> }
): boolean {
  if (Math.abs(existingSegment.duration - incomingShot.duration) > 0.01) {
    return false;
  }

  const existingShotType = existingSegment.metadata?.['shotType'];
  const incomingShotType = incomingShot.metadata?.['shotType'];
  if (
    typeof existingShotType === 'string' &&
    typeof incomingShotType === 'string' &&
    existingShotType !== incomingShotType
  ) {
    return false;
  }

  const existingShotNumber = existingSegment.metadata?.['shotNumber'];
  const incomingShotNumber = incomingShot.metadata?.['shotNumber'];
  if (
    typeof existingShotNumber === 'number' &&
    typeof incomingShotNumber === 'number' &&
    existingShotNumber !== incomingShotNumber
  ) {
    return false;
  }

  return true;
}

function getSceneShotSegments(
  timeline: Timeline,
  sceneSegmentId: string
): TimelineSegment[] {
  return timeline.segments.filter(segment => segment.id.startsWith(`${sceneSegmentId}_shot_`));
}

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
      id: desc.id ?? `segment_${index}`,
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
 * Automatically preserves version history: if the segment already has filled
 * visual layers, the current layers are snapshotted into `layerHistory` before
 * being replaced. First-time fills simply initialize `versionInfo`.
 *
 * Returns a new timeline with the updated segment.
 */
export function updateSegmentLayers(
  timeline: Timeline,
  segmentId: string,
  layers: TimelineLayerEntry[],
  fillStatus?: SegmentFillStatus,
  prompt?: string,
  note?: string
): UpdateSegmentLayersResult {
  const segmentIndex = timeline.segments.findIndex(s => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new Error(`Segment not found: ${segmentId}`);
  }

  const updatedSegments = [...timeline.segments];
  const existing = updatedSegments[segmentIndex]!;
  const downgradePrevention: DowngradePrevention = {
    preservedIndexes: [],
    reasons: [],
  };

  const newLayers = layers.map((incomingLayer, index) => {
    const existingLayer = existing.layers[index];
    if (!isVisualLikeLayer(existingLayer) || !isVisualLikeLayer(incomingLayer)) {
      return prompt
        ? {
            ...incomingLayer,
            metadata: index === 0
              ? { ...(incomingLayer.metadata ?? {}), prompt }
              : incomingLayer.metadata,
          }
        : incomingLayer;
    }

    const strongExistingLayer = existingLayer;

    const reasons: LayerDowngradeReason[] = [];

    if (strongExistingLayer.artifactId && !incomingLayer.artifactId) {
      reasons.push('missing_artifact_id');
    }
    if (strongExistingLayer.filePath && !incomingLayer.filePath) {
      reasons.push('missing_file_path');
    }

    const existingMediaType = detectLayerMediaType(strongExistingLayer);
    const incomingMediaType = detectLayerMediaType(incomingLayer);
    if (existingMediaType === 'video' && incomingMediaType !== 'video') {
      reasons.push('video_over_weaker_media');
    }

    if (
      hasUsefulMetadata(strongExistingLayer.metadata) &&
      incomingLayer.metadata !== undefined &&
      !hasUsefulMetadata(incomingLayer.metadata)
    ) {
      reasons.push('metadata_cleared');
    }

    const mergedMetadata = mergeLayerMetadata(strongExistingLayer.metadata, incomingLayer.metadata);

    if (reasons.length === 0) {
      return prompt
        ? {
            ...incomingLayer,
            metadata: index === 0 ? { ...(mergedMetadata ?? {}), prompt } : mergedMetadata,
          }
        : {
            ...incomingLayer,
            metadata: mergedMetadata,
          };
    }

    downgradePrevention.preservedIndexes.push(index);
    for (const reason of reasons) {
      downgradePrevention.reasons.push({ index, reason });
    }

    return {
      ...incomingLayer,
      type: existingMediaType === 'video' && incomingMediaType !== 'video'
        ? strongExistingLayer.type
        : incomingLayer.type,
      artifactId: incomingLayer.artifactId ?? strongExistingLayer.artifactId,
      filePath: incomingLayer.filePath ?? strongExistingLayer.filePath,
      metadata: index === 0 && prompt
        ? { ...(mergedMetadata ?? {}), ['prompt']: (mergedMetadata ?? {})['prompt'] ?? prompt }
        : mergedMetadata,
    };
  });

  // Determine fill status: if layers contain a visual, mark as filled
  const hasVisual = newLayers.some(l => l.type === 'visual' || l.type === 'narration_video');
  const newFillStatus = fillStatus ?? (hasVisual ? 'filled' : 'planned');

  // --- Version history ---
  const existingHasVisual = existing.layers.some(
    l => l.type === 'visual' || l.type === 'narration_video'
  );
  const assetIdentityChanged = !layersHaveEquivalentAssetIdentity(existing.layers, newLayers);
  const isReplacement =
    existingHasVisual &&
    hasVisual &&
    assetIdentityChanged &&
    downgradePrevention.preservedIndexes.length === 0;

  let layerHistory = existing.layerHistory ? [...existing.layerHistory] : [];
  let versionInfo: SegmentVersionInfo;

  if (isReplacement) {
    // Snapshot current layers before replacing
    const currentVersion = existing.versionInfo?.activeVersion ?? 1;
    const snapshot: LayerSnapshot = {
      version: currentVersion,
      layers: [...existing.layers],
      createdAt: new Date().toISOString(),
      prompt: existing.layers[0]?.metadata?.['prompt'] as string | undefined,
      note: note ?? undefined,
    };
    layerHistory.push(snapshot);
    versionInfo = {
      activeVersion: currentVersion + 1,
      totalVersions: currentVersion + 1,
    };
  } else {
    // First-time fill — initialize version info
    versionInfo = existing.versionInfo ?? { activeVersion: 1, totalVersions: 1 };
  }

  updatedSegments[segmentIndex] = {
    ...existing,
    layers: newLayers,
    fillStatus: newFillStatus,
    layerHistory: layerHistory.length > 0 ? layerHistory : undefined,
    versionInfo,
  };

  const updated: Timeline = {
    ...timeline,
    version: layerHistory.length > 0 ? '1.1' : timeline.version,
    segments: updatedSegments,
  };
  updated.validation = validateTimeline(updated);
  return downgradePrevention.preservedIndexes.length > 0
    ? { ...updated, downgradePrevention }
    : updated;
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
  const sceneSegment = timeline.segments[segmentIndex]!;
  const shotSegments = buildShotSegmentsFromContainer(sceneSegmentId, sceneSegment, shots);

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

export function upsertSceneShots(
  timeline: Timeline,
  sceneSegmentId: string,
  shots: Array<{ label: string; duration: number; metadata?: Record<string, unknown> }>
): UpsertSceneShotsResult {
  const existingShotSegments = getSceneShotSegments(timeline, sceneSegmentId);
  const sceneSegment = timeline.segments.find(segment => segment.id === sceneSegmentId);
  const hasFilledShots = existingShotSegments.some(segment => segment.fillStatus === 'filled');
  const canMergeIntoExistingShots =
    existingShotSegments.length === shots.length &&
    existingShotSegments.every((segment, index) => isCompatibleShotUpdate(segment, shots[index]!));

  if (existingShotSegments.length > 0 && canMergeIntoExistingShots) {
    const mergedSegments = timeline.segments.map(segment => {
      const shotMatch = segment.id.match(new RegExp(`^${sceneSegmentId}_shot_(\\d+)$`));
      if (!shotMatch?.[1]) return segment;
      const shotIndex = Number(shotMatch[1]) - 1;
      const incomingShot = shots[shotIndex];
      if (!incomingShot) return segment;

      return {
        ...segment,
        label: incomingShot.label ?? segment.label,
        metadata: incomingShot.metadata
          ? { ...(segment.metadata ?? {}), ...incomingShot.metadata }
          : segment.metadata,
      };
    });

    const updatedTimeline: Timeline = {
      ...timeline,
      segments: mergedSegments,
    };
    updatedTimeline.validation = validateTimeline(updatedTimeline);

    return {
      timeline: updatedTimeline,
      preservedExistingShots: true,
      mergedMetadataIntoExistingShots: true,
    };
  }

  if (existingShotSegments.length > 0 && hasFilledShots) {
    return {
      timeline,
      preservedExistingShots: true,
      mergedMetadataIntoExistingShots: false,
    };
  }

  if (!sceneSegment && existingShotSegments.length > 0) {
    const sortedExisting = [...existingShotSegments].sort((a, b) => a.startTime - b.startTime);
    const replacementSegments = buildShotSegmentsFromContainer(
      sceneSegmentId,
      {
        startTime: sortedExisting[0]!.startTime,
        endTime: sortedExisting[sortedExisting.length - 1]!.endTime,
        duration: Math.round((sortedExisting[sortedExisting.length - 1]!.endTime - sortedExisting[0]!.startTime) * 100) / 100,
        compositingMode: sortedExisting[0]!.compositingMode,
      },
      shots,
    );

    const existingIds = new Set(sortedExisting.map(segment => segment.id));
    const insertionIndex = timeline.segments.findIndex(segment => segment.id === sortedExisting[0]!.id);
    const remainingSegments = timeline.segments.filter(segment => !existingIds.has(segment.id));
    const updatedSegments = [
      ...remainingSegments.slice(0, insertionIndex),
      ...replacementSegments,
      ...remainingSegments.slice(insertionIndex),
    ];

    const updatedTimeline: Timeline = {
      ...timeline,
      segments: updatedSegments,
    };
    updatedTimeline.validation = validateTimeline(updatedTimeline);

    return {
      timeline: updatedTimeline,
      preservedExistingShots: false,
      mergedMetadataIntoExistingShots: false,
    };
  }

  return {
    timeline: splitSegmentIntoShots(timeline, sceneSegmentId, shots),
    preservedExistingShots: false,
    mergedMetadataIntoExistingShots: false,
  };
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

/**
 * Minimal `inspectTimeline` for callers (e.g. GenericAgent from the dev
 * merge) that expect the path-canonicalization API. Loads the timeline
 * as-is. The full path-correction pipeline from dev isn't ported yet;
 * we return the timeline unchanged with an empty `pathCorrections`
 * array so callers can safely read `.length`.
 *
 * Returns null when there's no timeline.json on disk.
 */
export function inspectTimeline(
  projectDir: string,
): {
  timeline: Timeline;
  wouldChangeOnSave: boolean;
  pathCorrections: Array<{
    index: number;
    artifactId: string;
    previousFilePath?: string;
    canonicalFilePath: string;
  }>;
} | null {
  const timeline = loadTimeline(projectDir);
  if (!timeline) return null;
  return { timeline, wouldChangeOnSave: false, pathCorrections: [] };
}

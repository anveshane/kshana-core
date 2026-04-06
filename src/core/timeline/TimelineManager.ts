/**
 * TimelineManager
 *
 * Pure functions for creating, updating, validating, and persisting timelines.
 * No tool concerns — this module is the core logic layer.
 */

import { join } from 'path';
import {
  readProjectText,
  writeProjectText,
} from '../../tasks/video/workflow/projectFileIO.js';
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

/** Default constraints based on current generation capabilities */
const DEFAULT_CONSTRAINTS: DurationConstraints = {
  maxClipDuration: 10,
  maxImageDuration: 10,
  minSegmentDuration: 3,
};

const TIMELINE_FILENAME = 'timeline.json';

export interface ParsedShotSegmentId {
  sceneIndex: number;
  sceneNumber: number;
  shotNumber: number;
}

export interface PendingTimelineSegment {
  segmentId: string;
  label: string;
  fillStatus: SegmentFillStatus;
  sceneNumber?: number;
  shotNumber?: number;
}

export interface UpsertSceneShotsResult {
  timeline: Timeline;
  preservedExistingShots: boolean;
  mergedMetadataIntoExistingShots?: boolean;
}

export interface TimelineRepairResult {
  timeline: Timeline;
  repairedSegmentIds: string[];
  unrepairedSegmentIds: string[];
}

interface TimelineIdentity {
  sceneNumber?: number;
  shotNumber?: number;
}

export function buildShotSegmentId(sceneNumber: number, shotNumber: number): string {
  if (!Number.isFinite(sceneNumber) || sceneNumber < 1) {
    throw new Error(`Invalid scene number for shot segment: ${sceneNumber}`);
  }
  if (!Number.isFinite(shotNumber) || shotNumber < 1) {
    throw new Error(`Invalid shot number for shot segment: ${shotNumber}`);
  }

  return `segment_${sceneNumber - 1}_shot_${shotNumber}`;
}

export function parseShotSegmentId(segmentId: string): ParsedShotSegmentId | null {
  const match = /^segment_(\d+)_shot_(\d+)$/.exec(segmentId);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  const sceneIndex = Number(match[1]);
  const shotNumber = Number(match[2]);
  if (!Number.isFinite(sceneIndex) || !Number.isFinite(shotNumber)) {
    return null;
  }

  return {
    sceneIndex,
    sceneNumber: sceneIndex + 1,
    shotNumber,
  };
}

function roundTimelineTime(value: number): number {
  return Math.round(value * 100) / 100;
}

function isVisualLikeLayer(layer: TimelineLayerEntry | undefined): boolean {
  return layer?.type === 'visual' || layer?.type === 'narration_video';
}

function hasResolvableAssetReference(layer: TimelineLayerEntry | undefined): boolean {
  return Boolean(layer?.filePath || layer?.artifactId);
}

function parseIdentityFromText(value: string | undefined): TimelineIdentity {
  if (!value) {
    return {};
  }

  const directMatch =
    /scene[\s_-]*(\d+)[^\d]+shot[\s_-]*(\d+)/i.exec(value) ??
    /segment[_-](\d+)[_-]shot[_-](\d+)/i.exec(value);
  if (!directMatch?.[1] || !directMatch?.[2]) {
    return {};
  }

  if (/segment[_-]/i.test(directMatch[0])) {
    const sceneIndex = Number.parseInt(directMatch[1], 10);
    const shotNumber = Number.parseInt(directMatch[2], 10);
    return Number.isFinite(sceneIndex) && Number.isFinite(shotNumber)
      ? {
          sceneNumber: sceneIndex + 1,
          shotNumber,
        }
      : {};
  }

  const sceneNumber = Number.parseInt(directMatch[1], 10);
  const shotNumber = Number.parseInt(directMatch[2], 10);
  return Number.isFinite(sceneNumber) && Number.isFinite(shotNumber)
    ? {
        sceneNumber,
        shotNumber,
      }
    : {};
}

function getMetadataNumber(
  metadata: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  if (!metadata) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function getSegmentIdentity(segment: TimelineSegment): TimelineIdentity {
  const parsedSegmentId = parseShotSegmentId(segment.id);
  if (parsedSegmentId) {
    return {
      sceneNumber: parsedSegmentId.sceneNumber,
      shotNumber: parsedSegmentId.shotNumber,
    };
  }

  const metadata = segment.metadata;
  return {
    sceneNumber:
      getMetadataNumber(metadata, 'sceneNumber', 'scene_number') ??
      parseIdentityFromText(segment.label).sceneNumber,
    shotNumber:
      getMetadataNumber(metadata, 'shotNumber', 'shot_number') ??
      parseIdentityFromText(segment.label).shotNumber,
  };
}

function getLayerIdentity(layer: TimelineLayerEntry | undefined): TimelineIdentity {
  if (!layer) {
    return {};
  }

  const metadata = layer.metadata;
  const metadataIdentity = {
    sceneNumber: getMetadataNumber(
      metadata,
      'sceneNumber',
      'scene_number',
      'placementNumber',
    ),
    shotNumber: getMetadataNumber(metadata, 'shotNumber', 'shot_number'),
  };
  if (
    metadataIdentity.sceneNumber !== undefined &&
    metadataIdentity.shotNumber !== undefined
  ) {
    return metadataIdentity;
  }

  const textCandidates = [layer.filePath, layer.artifactId, layer.label];
  for (const candidate of textCandidates) {
    const identity = parseIdentityFromText(candidate);
    if (
      identity.sceneNumber !== undefined &&
      identity.shotNumber !== undefined
    ) {
      return identity;
    }
  }

  return metadataIdentity;
}

function isLayerIdentityCompatible(
  segment: TimelineSegment,
  layer: TimelineLayerEntry | undefined
): boolean {
  const segmentIdentity = getSegmentIdentity(segment);
  const layerIdentity = getLayerIdentity(layer);

  if (
    segmentIdentity.sceneNumber === undefined ||
    segmentIdentity.shotNumber === undefined
  ) {
    return true;
  }

  if (
    layerIdentity.sceneNumber === undefined ||
    layerIdentity.shotNumber === undefined
  ) {
    return true;
  }

  return (
    segmentIdentity.sceneNumber === layerIdentity.sceneNumber &&
    segmentIdentity.shotNumber === layerIdentity.shotNumber
  );
}

function findMatchingExistingLayer(
  existingLayers: TimelineLayerEntry[],
  incomingLayer: TimelineLayerEntry,
  index: number
): TimelineLayerEntry | undefined {
  const indexedMatch = existingLayers[index];
  if (indexedMatch?.type === incomingLayer.type) {
    return indexedMatch;
  }

  return existingLayers.find(layer => layer.type === incomingLayer.type);
}

function mergeLayerPreservingRefs(
  incomingLayer: TimelineLayerEntry,
  existingLayer?: TimelineLayerEntry
): TimelineLayerEntry {
  if (!isVisualLikeLayer(incomingLayer) || !existingLayer) {
    return incomingLayer;
  }

  return {
    ...existingLayer,
    ...incomingLayer,
    artifactId: incomingLayer.artifactId ?? existingLayer.artifactId,
    filePath: incomingLayer.filePath ?? existingLayer.filePath,
    metadata: incomingLayer.metadata ?? existingLayer.metadata,
  };
}

function repairLayerFromHistory(
  currentLayer: TimelineLayerEntry,
  recoveredLayer: TimelineLayerEntry
): TimelineLayerEntry {
  return {
    ...recoveredLayer,
    ...currentLayer,
    artifactId: currentLayer.artifactId ?? recoveredLayer.artifactId,
    filePath: currentLayer.filePath ?? recoveredLayer.filePath,
    metadata: currentLayer.metadata ?? recoveredLayer.metadata,
  };
}

function getLatestHistoricalResolvableLayer(
  segment: TimelineSegment
): TimelineLayerEntry | undefined {
  const history = segment.layerHistory ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const snapshot = history[i];
    const recoveredLayer = snapshot?.layers.find(layer =>
      isVisualLikeLayer(layer) &&
      hasResolvableAssetReference(layer) &&
      isLayerIdentityCompatible(segment, layer)
    );
    if (recoveredLayer) {
      return recoveredLayer;
    }
  }

  return undefined;
}

function getVisualLayerIndexes(segment: TimelineSegment): number[] {
  return segment.layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => isVisualLikeLayer(layer))
    .map(({ index }) => index);
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
): Timeline {
  const segmentIndex = timeline.segments.findIndex(s => s.id === segmentId);
  if (segmentIndex === -1) {
    throw new Error(`Segment not found: ${segmentId}`);
  }

  const updatedSegments = [...timeline.segments];
  const existing = updatedSegments[segmentIndex]!;

  // Determine fill status: if layers contain a visual, mark as filled
  const hasVisual = layers.some(l => l.type === 'visual' || l.type === 'narration_video');
  const hasMismatchedVisualLayer = layers.some(
    layer =>
      isVisualLikeLayer(layer) &&
      hasResolvableAssetReference(layer) &&
      !isLayerIdentityCompatible(existing, layer)
  );
  if (hasMismatchedVisualLayer) {
    throw new Error(
      `Incoming visual layer does not match target segment identity: ${segmentId}`
    );
  }
  const newFillStatus = fillStatus ?? (hasVisual ? 'filled' : 'planned');

  // --- Version history ---
  const existingHasVisual = existing.layers.some(
    l => l.type === 'visual' || l.type === 'narration_video'
  );
  const isReplacement = existingHasVisual && existing.fillStatus === 'filled' && hasVisual;

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

  // Store the generation prompt in the first layer's metadata if provided
  const normalizedLayers = layers.map((layer, index) =>
    mergeLayerPreservingRefs(layer, findMatchingExistingLayer(existing.layers, layer, index))
  );

  const newLayers = prompt
    ? normalizedLayers.map((l, i) =>
        i === 0 ? { ...l, metadata: { ...l.metadata, prompt } } : l
      )
    : normalizedLayers;

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
  return updated;
}

export function repairTimelineAssetReferences(timeline: Timeline): TimelineRepairResult {
  const repairedSegmentIds: string[] = [];
  const unrepairedSegmentIds: string[] = [];

  const segments = timeline.segments.map(segment => {
    if (segment.fillStatus !== 'filled') {
      return segment;
    }

    const visualLayerIndexes = getVisualLayerIndexes(segment);
    if (visualLayerIndexes.length === 0) {
      unrepairedSegmentIds.push(segment.id);
      return segment;
    }

    const hasAnyResolvableVisualLayer = visualLayerIndexes.some(index =>
      hasResolvableAssetReference(segment.layers[index])
    );
    if (hasAnyResolvableVisualLayer) {
      return segment;
    }

    const recoveredLayer = getLatestHistoricalResolvableLayer(segment);
    if (!recoveredLayer) {
      unrepairedSegmentIds.push(segment.id);
      return segment;
    }

    const repairedLayers = [...segment.layers];
    const repairIndex = visualLayerIndexes[0]!;
    const currentLayer = repairedLayers[repairIndex]!;
    repairedLayers[repairIndex] = repairLayerFromHistory(currentLayer, recoveredLayer);
    repairedSegmentIds.push(segment.id);

    return {
      ...segment,
      layers: repairedLayers,
    };
  });

  const repairedTimeline: Timeline = {
    ...timeline,
    segments,
  };
  repairedTimeline.validation = validateTimeline(repairedTimeline);

  return {
    timeline: repairedTimeline,
    repairedSegmentIds,
    unrepairedSegmentIds,
  };
}

export function loadTimelineWithRepair(projectDir: string): TimelineRepairResult | null {
  const timeline = loadTimeline(projectDir);
  if (!timeline) {
    return null;
  }

  return repairTimelineAssetReferences(timeline);
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
  let hasInvalidFilledSegment = false;

  // Check each segment
  for (const segment of timeline.segments) {
    if (segment.fillStatus === 'filled') {
      filledDuration += segment.duration;
    }

    if (segment.fillStatus === 'empty') {
      warnings.push(`Segment "${segment.label}" (${segment.id}) has no content`);
    }

    const visualLayers = segment.layers.filter(
      l => l.type === 'visual' || l.type === 'narration_video'
    );
    const hasVisualLayer = visualLayers.length > 0;
    const hasResolvableVisualLayer = visualLayers.some(layer => hasResolvableAssetReference(layer));
    const hasMismatchedVisualIdentity = visualLayers.some(
      layer =>
        hasResolvableAssetReference(layer) &&
        !isLayerIdentityCompatible(segment, layer)
    );
    if (segment.fillStatus === 'filled' && !hasVisualLayer) {
      hasInvalidFilledSegment = true;
      warnings.push(
        `Segment "${segment.label}" (${segment.id}) is marked filled but has no visual layer`
      );
    }
    if (segment.fillStatus === 'filled' && hasVisualLayer && !hasResolvableVisualLayer) {
      hasInvalidFilledSegment = true;
      warnings.push(
        `Segment "${segment.label}" (${segment.id}) is marked filled but its active visual layer has no filePath or artifactId`
      );
    }
    if (segment.fillStatus === 'filled' && hasMismatchedVisualIdentity) {
      hasInvalidFilledSegment = true;
      warnings.push(
        `Segment "${segment.label}" (${segment.id}) is marked filled but its active visual layer points to a different scene/shot`
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
  const isComplete = allFilled && gaps.length === 0 && timeline.segments.length > 0 && !hasInvalidFilledSegment;

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
  if (shots.length === 0) {
    throw new Error('shots array must not be empty');
  }

  const directSegmentIndex = timeline.segments.findIndex(s => s.id === sceneSegmentId);
  const existingShotIndexes = timeline.segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.id.startsWith(`${sceneSegmentId}_shot_`))
    .map(({ index }) => index);

  const segmentIndex = directSegmentIndex >= 0 ? directSegmentIndex : existingShotIndexes[0] ?? -1;
  if (segmentIndex === -1) {
    throw new Error(`Segment not found: ${sceneSegmentId}`);
  }

  const replacementCount = directSegmentIndex >= 0 ? 1 : existingShotIndexes.length;
  const replacementSegments =
    directSegmentIndex >= 0
      ? [timeline.segments[segmentIndex]!]
      : timeline.segments.slice(segmentIndex, segmentIndex + replacementCount);

  const sceneSegment = replacementSegments[0]!;
  const sceneStart = sceneSegment.startTime;
  const sceneDuration = roundTimelineTime(
    replacementSegments.reduce((sum, segment) => sum + segment.duration, 0)
  );
  const totalShotDuration = shots.reduce((sum, s) => sum + s.duration, 0);
  if (!Number.isFinite(totalShotDuration) || totalShotDuration <= 0) {
    throw new Error('shots must have a positive total duration');
  }

  const shotSegments: TimelineSegment[] = [];
  let currentTime = sceneStart;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    if (!Number.isFinite(shot.duration) || shot.duration <= 0) {
      throw new Error(`shot ${i + 1} must have a positive duration`);
    }
    const shotDuration = roundTimelineTime(shot.duration);
    const shotStart = roundTimelineTime(currentTime);
    const shotEnd = roundTimelineTime(currentTime + shotDuration);

    shotSegments.push({
      id: `${sceneSegmentId}_shot_${i + 1}`,
      label: shot.label,
      startTime: shotStart,
      endTime: shotEnd,
      duration: shotDuration,
      compositingMode: replacementSegments[Math.min(i, replacementSegments.length - 1)]?.compositingMode ?? sceneSegment.compositingMode,
      compositingMetadata:
        replacementSegments[Math.min(i, replacementSegments.length - 1)]?.compositingMetadata ??
        sceneSegment.compositingMetadata,
      fillStatus: 'planned',
      layers: [],
      ...(i === 0 && sceneSegment.transition
        ? { transition: sceneSegment.transition }
        : {}),
      ...(shot.metadata ? { metadata: shot.metadata } : {}),
    });

    currentTime = shotEnd;
  }

  const replacementDuration = roundTimelineTime(currentTime - sceneStart);
  const durationDelta = roundTimelineTime(replacementDuration - sceneDuration);

  const shiftedTrailingSegments = timeline.segments
    .slice(segmentIndex + replacementCount)
    .map(segment => ({
      ...segment,
      startTime: roundTimelineTime(segment.startTime + durationDelta),
      endTime: roundTimelineTime(segment.endTime + durationDelta),
    }));

  // Replace the scene segment with the shot segments
  const updatedSegments = [
    ...timeline.segments.slice(0, segmentIndex),
    ...shotSegments,
    ...shiftedTrailingSegments,
  ];

  const updated: Timeline = {
    ...timeline,
    totalDuration: roundTimelineTime(timeline.totalDuration + durationDelta),
    segments: updatedSegments,
  };
  updated.validation = validateTimeline(updated);
  return updated;
}

export function getSceneShotSegments(
  timeline: Timeline,
  sceneSegmentId: string
): TimelineSegment[] {
  return timeline.segments.filter(segment => segment.id.startsWith(`${sceneSegmentId}_shot_`));
}

export function upsertSceneShots(
  timeline: Timeline,
  sceneSegmentId: string,
  shots: Array<{ label: string; duration: number; metadata?: Record<string, unknown> }>
): UpsertSceneShotsResult {
  const existingShotSegments = getSceneShotSegments(timeline, sceneSegmentId);
  const hasFilledShots = existingShotSegments.some(segment => segment.fillStatus === 'filled');
  if (existingShotSegments.length > 0 && hasFilledShots) {
    if (
      existingShotSegments.length === shots.length &&
      existingShotSegments.every((segment, index) => isCompatibleShotUpdate(segment, shots[index]!))
    ) {
      const existingById = new Map(
        existingShotSegments.map(segment => [segment.id, segment] as const)
      );
      const mergedSegments = timeline.segments.map(segment => {
        if (!segment.id.startsWith(`${sceneSegmentId}_shot_`)) {
          return segment;
        }

        const shotMatch = /_shot_(\d+)$/.exec(segment.id);
        const shotIndex = shotMatch?.[1] ? Number(shotMatch[1]) - 1 : -1;
        const incomingShot = shotIndex >= 0 ? shots[shotIndex] : undefined;
        const existingSegment = existingById.get(segment.id);
        if (!incomingShot || !existingSegment) {
          return segment;
        }

        return {
          ...existingSegment,
          label: incomingShot.label ?? existingSegment.label,
          metadata: incomingShot.metadata
            ? { ...(existingSegment.metadata ?? {}), ...incomingShot.metadata }
            : existingSegment.metadata,
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

    return {
      timeline,
      preservedExistingShots: true,
      mergedMetadataIntoExistingShots: false,
    };
  }

  return {
    timeline: splitSegmentIntoShots(timeline, sceneSegmentId, shots),
    preservedExistingShots: false,
    mergedMetadataIntoExistingShots: false,
  };
}

export function getPendingTimelineSegments(timeline: Timeline): PendingTimelineSegment[] {
  return timeline.segments
    .filter(segment => segment.fillStatus !== 'filled')
    .map(segment => {
      const parsed = parseShotSegmentId(segment.id);
      return {
        segmentId: segment.id,
        label: segment.label,
        fillStatus: segment.fillStatus,
        ...(parsed
          ? {
              sceneNumber: parsed.sceneNumber,
              shotNumber: parsed.shotNumber,
            }
          : {}),
      };
    });
}

export function getNextPendingTimelineSegment(
  timeline: Timeline
): PendingTimelineSegment | null {
  return getPendingTimelineSegments(timeline)[0] ?? null;
}

/**
 * Load a timeline from disk.
 * Returns null if the file doesn't exist.
 */
export function loadTimeline(projectDir: string): Timeline | null {
  try {
    const raw = readProjectText(join(projectDir, TIMELINE_FILENAME));
    if (!raw) {
      return null;
    }
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
  // Revalidate before saving
  timeline.validation = validateTimeline(timeline);

  writeProjectText(
    join(projectDir, TIMELINE_FILENAME),
    JSON.stringify(timeline, null, 2),
  );
}

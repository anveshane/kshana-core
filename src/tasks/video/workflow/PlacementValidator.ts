/**
 * Cross-placement overlap validation and auto-adjustment utilities.
 * Defaults are intentionally conservative: whole-second timestamps with a 1-second gap.
 */

import type { ParsedImagePlacement } from './imagePlacementsParser.js';
import type { ParsedVideoPlacement } from './videoPlacementsParser.js';
import type { ParsedInfographicPlacement } from './infographicPlacementsParser.js';

export type PlacementType = 'image' | 'video' | 'infographic';

export interface PlacementValidationConfig {
  minGapSeconds?: number;
  minDurationSeconds?: number;
  priorities?: Record<PlacementType, number>;
}

export interface PlacementValidationWarning {
  message: string;
  placementType: PlacementType;
  placementNumber: number;
}

interface PlacementWindow {
  placementType: PlacementType;
  placementNumber: number;
  startSeconds: number;
  endSeconds: number;
  priority: number;
  sourceIndex: number;
}

const DEFAULT_PRIORITIES: Record<PlacementType, number> = {
  video: 3,
  image: 2,
  infographic: 1,
};

const DEFAULT_MIN_GAP_SECONDS = 0;
const DEFAULT_MIN_DURATION_SECONDS = 2;

function sanitizeTimeToken(timeStr: string): string {
  return timeStr
    .trim()
    .replace(/^[\[\(]+/, '')
    .replace(/[\]\)]+$/, '')
    .replace(/,/g, '.');
}

function timeToSeconds(timeStr: string): number {
  const cleaned = sanitizeTimeToken(timeStr);
  const parts = cleaned.split(':');
  const parseSeconds = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  if (parts.length === 3) {
    const hours = Number.parseInt(parts[0] ?? '0', 10) || 0;
    const minutes = Number.parseInt(parts[1] ?? '0', 10) || 0;
    const seconds = parseSeconds(parts[2] ?? '0');
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const minutes = Number.parseInt(parts[0] ?? '0', 10) || 0;
    const seconds = parseSeconds(parts[1] ?? '0');
    return minutes * 60 + seconds;
  }
  return parseSeconds(cleaned);
}

function formatWholeSecond(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function createConfig(config?: PlacementValidationConfig): Required<PlacementValidationConfig> {
  return {
    minGapSeconds: config?.minGapSeconds ?? DEFAULT_MIN_GAP_SECONDS,
    minDurationSeconds: config?.minDurationSeconds ?? DEFAULT_MIN_DURATION_SECONDS,
    priorities: {
      ...DEFAULT_PRIORITIES,
      ...(config?.priorities ?? {}),
    },
  };
}

function durationSeconds(window: PlacementWindow): number {
  return window.endSeconds - window.startSeconds;
}

function trimEnd(window: PlacementWindow, newEndSeconds: number): PlacementWindow {
  return {
    ...window,
    endSeconds: newEndSeconds,
  };
}

function trimStart(window: PlacementWindow, newStartSeconds: number): PlacementWindow {
  return {
    ...window,
    startSeconds: newStartSeconds,
  };
}

function mapToWindows(
  placements: Array<{ placementNumber: number; startTime: string; endTime: string }>,
  placementType: PlacementType,
  priorities: Record<PlacementType, number>,
): PlacementWindow[] {
  return placements.map((placement, sourceIndex) => ({
    placementType,
    placementNumber: placement.placementNumber,
    startSeconds: timeToSeconds(placement.startTime),
    endSeconds: timeToSeconds(placement.endTime),
    priority: priorities[placementType],
    sourceIndex,
  }));
}

function toImagePlacements(
  original: ParsedImagePlacement[],
  windows: PlacementWindow[],
): ParsedImagePlacement[] {
  return windows
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((window) => {
      const source = original[window.sourceIndex]!;
      return {
        ...source,
        startTime: formatWholeSecond(window.startSeconds),
        endTime: formatWholeSecond(window.endSeconds),
      };
    });
}

function toVideoPlacements(
  original: ParsedVideoPlacement[],
  windows: PlacementWindow[],
): ParsedVideoPlacement[] {
  return windows
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((window) => {
      const source = original[window.sourceIndex]!;
      const startTime = formatWholeSecond(window.startSeconds);
      const endTime = formatWholeSecond(window.endSeconds);
      return {
        ...source,
        startTime,
        endTime,
        duration: Math.min(10, Math.max(4, Math.round(timeToSeconds(endTime) - timeToSeconds(startTime)))),
      };
    });
}

function toInfographicPlacements(
  original: ParsedInfographicPlacement[],
  windows: PlacementWindow[],
): ParsedInfographicPlacement[] {
  return windows
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((window) => {
      const source = original[window.sourceIndex]!;
      return {
        ...source,
        startTime: formatWholeSecond(window.startSeconds),
        endTime: formatWholeSecond(window.endSeconds),
      };
    });
}

function resolveOverlaps(
  windows: PlacementWindow[],
  cfg: Required<PlacementValidationConfig>,
): { kept: PlacementWindow[]; warnings: PlacementValidationWarning[] } {
  const warnings: PlacementValidationWarning[] = [];
  const sorted = [...windows].sort((a, b) => {
    if (a.startSeconds !== b.startSeconds) return a.startSeconds - b.startSeconds;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.placementNumber - b.placementNumber;
  });

  const kept: PlacementWindow[] = [];

  for (const current of sorted) {
    if (durationSeconds(current) < cfg.minDurationSeconds) {
      warnings.push({
        message: `Dropped ${current.placementType} #${current.placementNumber}: duration below ${cfg.minDurationSeconds}s.`,
        placementType: current.placementType,
        placementNumber: current.placementNumber,
      });
      continue;
    }

    let candidate: PlacementWindow | null = { ...current };

    while (candidate && kept.length > 0) {
      const previous = kept[kept.length - 1]!;
      const requiredStart = previous.endSeconds + cfg.minGapSeconds;
      if (candidate.startSeconds >= requiredStart) {
        break;
      }

      const preferLaterInfographicOnTie =
        previous.priority === candidate.priority &&
        previous.placementType === 'infographic' &&
        candidate.placementType === 'infographic' &&
        candidate.startSeconds >= previous.startSeconds;
      const overlapLower = previous.priority < candidate.priority || preferLaterInfographicOnTie;

      if (overlapLower) {
        const trimmedPreviousEnd = candidate.startSeconds - cfg.minGapSeconds;
        const trimmedPrevious = trimEnd(previous, trimmedPreviousEnd);
        if (durationSeconds(trimmedPrevious) < cfg.minDurationSeconds) {
          kept.pop();
          warnings.push({
            message: `Dropped ${previous.placementType} #${previous.placementNumber} due to overlap with ${candidate.placementType} #${candidate.placementNumber}.`,
            placementType: previous.placementType,
            placementNumber: previous.placementNumber,
          });
        } else {
          kept[kept.length - 1] = trimmedPrevious;
          warnings.push({
            message: `Trimmed ${previous.placementType} #${previous.placementNumber} end to avoid overlap with ${candidate.placementType} #${candidate.placementNumber}.`,
            placementType: previous.placementType,
            placementNumber: previous.placementNumber,
          });
          break;
        }
      } else {
        candidate = trimStart(candidate, requiredStart);
        if (durationSeconds(candidate) < cfg.minDurationSeconds) {
          warnings.push({
            message: `Dropped ${candidate.placementType} #${candidate.placementNumber} due to overlap with higher-priority ${previous.placementType} #${previous.placementNumber}.`,
            placementType: candidate.placementType,
            placementNumber: candidate.placementNumber,
          });
          candidate = null;
        } else {
          warnings.push({
            message: `Shifted ${candidate.placementType} #${candidate.placementNumber} start to avoid overlap with ${previous.placementType} #${previous.placementNumber}.`,
            placementType: candidate.placementType,
            placementNumber: candidate.placementNumber,
          });
        }
      }
    }

    if (candidate) {
      kept.push(candidate);
    }
  }

  return { kept, warnings };
}

export interface ValidatePlacementSetsInput {
  imagePlacements: ParsedImagePlacement[];
  videoPlacements: ParsedVideoPlacement[];
  infographicPlacements: ParsedInfographicPlacement[];
}

export interface ValidatePlacementSetsResult {
  imagePlacements: ParsedImagePlacement[];
  videoPlacements: ParsedVideoPlacement[];
  infographicPlacements: ParsedInfographicPlacement[];
  warnings: string[];
}

export function validatePlacementSets(
  input: ValidatePlacementSetsInput,
  config?: PlacementValidationConfig,
): ValidatePlacementSetsResult {
  const cfg = createConfig(config);
  const imageWindows = mapToWindows(input.imagePlacements, 'image', cfg.priorities);
  const videoWindows = mapToWindows(input.videoPlacements, 'video', cfg.priorities);
  const infographicWindows = mapToWindows(input.infographicPlacements, 'infographic', cfg.priorities);
  const all = [...imageWindows, ...videoWindows, ...infographicWindows];

  const { kept, warnings } = resolveOverlaps(all, cfg);

  const keptImages = kept.filter((w) => w.placementType === 'image');
  const keptVideos = kept.filter((w) => w.placementType === 'video');
  const keptInfographics = kept.filter((w) => w.placementType === 'infographic');

  return {
    imagePlacements: toImagePlacements(input.imagePlacements, keptImages),
    videoPlacements: toVideoPlacements(input.videoPlacements, keptVideos),
    infographicPlacements: toInfographicPlacements(input.infographicPlacements, keptInfographics),
    warnings: warnings.map((w) => w.message),
  };
}

export interface ValidateSinglePlacementInput {
  placementType: PlacementType;
  placementNumber: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  existing: Array<{ placementType: PlacementType; placementNumber: number; startTimeSeconds: number; endTimeSeconds: number }>;
}

export interface ValidateSinglePlacementResult {
  startTimeSeconds: number;
  endTimeSeconds: number;
  accepted: boolean;
  warnings: string[];
}

export function validateSinglePlacementAgainstExisting(
  input: ValidateSinglePlacementInput,
  config?: PlacementValidationConfig,
): ValidateSinglePlacementResult {
  const cfg = createConfig(config);
  const warnings: string[] = [];

  let candidate = {
    start: input.startTimeSeconds,
    end: input.endTimeSeconds,
  };

  const existing = [...input.existing]
    .filter((item) => item.endTimeSeconds > item.startTimeSeconds)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

  for (const item of existing) {
    if (candidate.end <= item.startTimeSeconds - cfg.minGapSeconds) continue;
    if (candidate.start >= item.endTimeSeconds + cfg.minGapSeconds) continue;

    candidate = {
      start: item.endTimeSeconds + cfg.minGapSeconds,
      end: candidate.end,
    };

    warnings.push(
      `Shifted ${input.placementType} #${input.placementNumber} to avoid overlap with ${item.placementType} #${item.placementNumber}.`,
    );

    if (candidate.end - candidate.start < cfg.minDurationSeconds) {
      warnings.push(
        `Rejected ${input.placementType} #${input.placementNumber}: duration below ${cfg.minDurationSeconds}s after overlap adjustment.`,
      );
      return {
        startTimeSeconds: candidate.start,
        endTimeSeconds: candidate.end,
        accepted: false,
        warnings,
      };
    }
  }

  return {
    startTimeSeconds: candidate.start,
    endTimeSeconds: candidate.end,
    accepted: true,
    warnings,
  };
}

/**
 * Placement validation utilities
 * Validates that image and video placements cover the entire transcript duration without gaps
 */

import { parseImagePlacementsWithErrors } from './imagePlacementsParser.js';
import { parseVideoPlacements } from './videoPlacementsParser.js';

export interface TimeRange {
  startTime: number; // seconds
  endTime: number; // seconds
}

export interface CoverageGap {
  startTime: number; // seconds
  endTime: number; // seconds
  duration: number; // seconds
}

export interface CoverageValidationResult {
  isValid: boolean;
  totalDuration: number;
  coveredDuration: number;
  gaps: CoverageGap[];
  overlaps: Array<{
    type1: 'image' | 'video';
    type2: 'image' | 'video';
    startTime: number;
    endTime: number;
  }>;
  warnings: string[];
}

/**
 * Convert time string to seconds.
 * Handles formats: "M:SS", "MM:SS", "H:MM:SS", "HH:MM:SS"
 */
function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    // HH:MM:SS format
    const hours = parseInt(parts[0] ?? '0', 10) || 0;
    const minutes = parseInt(parts[1] ?? '0', 10) || 0;
    const seconds = parseInt(parts[2] ?? '0', 10) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // M:SS or MM:SS format
    const minutes = parseInt(parts[0] ?? '0', 10) || 0;
    const seconds = parseInt(parts[1] ?? '0', 10) || 0;
    return minutes * 60 + seconds;
  }
  // If it's just seconds (e.g., "15")
  return parseInt(timeStr, 10) || 0;
}

/**
 * Merge overlapping time ranges into non-overlapping ranges
 */
function mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  if (ranges.length === 0) return [];

  // Sort by start time
  const sorted = [...ranges].sort((a, b) => a.startTime - b.startTime);
  const merged: TimeRange[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;

    // If current overlaps or is adjacent to last, merge them
    if (current.startTime <= last.endTime) {
      last.endTime = Math.max(last.endTime, current.endTime);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Find gaps in coverage between time ranges
 */
function findGaps(ranges: TimeRange[], totalDuration: number): CoverageGap[] {
  if (ranges.length === 0) {
    if (totalDuration > 0) {
      return [{ startTime: 0, endTime: totalDuration, duration: totalDuration }];
    }
    return [];
  }

  const gaps: CoverageGap[] = [];
  const merged = mergeTimeRanges(ranges);

  // Check for gap at the start
  if (merged[0]!.startTime > 0) {
    gaps.push({
      startTime: 0,
      endTime: merged[0]!.startTime,
      duration: merged[0]!.startTime,
    });
  }

  // Check for gaps between ranges
  for (let i = 0; i < merged.length - 1; i++) {
    const current = merged[i]!;
    const next = merged[i + 1]!;

    if (next.startTime > current.endTime) {
      gaps.push({
        startTime: current.endTime,
        endTime: next.startTime,
        duration: next.startTime - current.endTime,
      });
    }
  }

  // Check for gap at the end
  const last = merged[merged.length - 1]!;
  if (last.endTime < totalDuration) {
    gaps.push({
      startTime: last.endTime,
      endTime: totalDuration,
      duration: totalDuration - last.endTime,
    });
  }

  return gaps;
}

/**
 * Find overlaps between image and video placements
 */
function findOverlaps(
  imageRanges: TimeRange[],
  videoRanges: TimeRange[],
): Array<{
  type1: 'image' | 'video';
  type2: 'image' | 'video';
  startTime: number;
  endTime: number;
}> {
  const overlaps: Array<{
    type1: 'image' | 'video';
    type2: 'image' | 'video';
    startTime: number;
    endTime: number;
  }> = [];

  // Check image-image overlaps
  for (let i = 0; i < imageRanges.length; i++) {
    for (let j = i + 1; j < imageRanges.length; j++) {
      const a = imageRanges[i]!;
      const b = imageRanges[j]!;
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        overlaps.push({
          type1: 'image',
          type2: 'image',
          startTime: Math.max(a.startTime, b.startTime),
          endTime: Math.min(a.endTime, b.endTime),
        });
      }
    }
  }

  // Check video-video overlaps
  for (let i = 0; i < videoRanges.length; i++) {
    for (let j = i + 1; j < videoRanges.length; j++) {
      const a = videoRanges[i]!;
      const b = videoRanges[j]!;
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        overlaps.push({
          type1: 'video',
          type2: 'video',
          startTime: Math.max(a.startTime, b.startTime),
          endTime: Math.min(a.endTime, b.endTime),
        });
      }
    }
  }

  // Check image-video overlaps
  for (const imageRange of imageRanges) {
    for (const videoRange of videoRanges) {
      if (imageRange.startTime < videoRange.endTime && videoRange.startTime < imageRange.endTime) {
        overlaps.push({
          type1: 'image',
          type2: 'video',
          startTime: Math.max(imageRange.startTime, videoRange.startTime),
          endTime: Math.min(imageRange.endTime, videoRange.endTime),
        });
      }
    }
  }

  return overlaps;
}

/**
 * Format seconds to MM:SS or H:MM:SS
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Validate that image and video placements cover the entire transcript duration
 * 
 * @param imagePlacementsContent - Content of image-placements.md file
 * @param videoPlacementsContent - Content of video-placements.md file
 * @param transcriptDuration - Total duration of transcript in seconds
 * @returns Validation result with gaps, overlaps, and warnings
 */
export function validatePlacementCoverage(
  imagePlacementsContent: string,
  videoPlacementsContent: string,
  transcriptDuration: number,
): CoverageValidationResult {
  const warnings: string[] = [];
  const imageRanges: TimeRange[] = [];
  const videoRanges: TimeRange[] = [];

  // Parse image placements
  const imageParseResult = parseImagePlacementsWithErrors(imagePlacementsContent, false);
  if (imageParseResult.errors.length > 0) {
    warnings.push(`Image placement parsing errors: ${imageParseResult.errors.length} errors found`);
  }
  if (imageParseResult.warnings.length > 0) {
    warnings.push(...imageParseResult.warnings.map(w => `Image placement: ${w}`));
  }

  for (const placement of imageParseResult.placements) {
    const startSeconds = timeToSeconds(placement.startTime);
    const endSeconds = timeToSeconds(placement.endTime);
    if (startSeconds < endSeconds) {
      imageRanges.push({ startTime: startSeconds, endTime: endSeconds });
    } else {
      warnings.push(`Invalid image placement ${placement.placementNumber}: startTime (${placement.startTime}) >= endTime (${placement.endTime})`);
    }
  }

  // Parse video placements
  const videoPlacements = parseVideoPlacements(videoPlacementsContent);
  for (const placement of videoPlacements) {
    const startSeconds = timeToSeconds(placement.startTime);
    const endSeconds = timeToSeconds(placement.endTime);
    if (startSeconds < endSeconds) {
      videoRanges.push({ startTime: startSeconds, endTime: endSeconds });
    } else {
      warnings.push(`Invalid video placement ${placement.placementNumber}: startTime (${placement.startTime}) >= endTime (${placement.endTime})`);
    }
  }

  // Combine all ranges
  const allRanges = [...imageRanges, ...videoRanges];

  // Find gaps
  const gaps = findGaps(allRanges, transcriptDuration);

  // Find overlaps
  const overlaps = findOverlaps(imageRanges, videoRanges);

  // Calculate covered duration
  const mergedRanges = mergeTimeRanges(allRanges);
  const coveredDuration = mergedRanges.reduce((sum, range) => sum + (range.endTime - range.startTime), 0);

  // Validation is valid if there are no gaps and no overlaps
  const isValid = gaps.length === 0 && overlaps.length === 0;

  // Add detailed warnings for gaps
  if (gaps.length > 0) {
    warnings.push(`Found ${gaps.length} gap(s) in placement coverage:`);
    for (const gap of gaps) {
      warnings.push(`  - Gap from ${formatTime(gap.startTime)} to ${formatTime(gap.endTime)} (${gap.duration.toFixed(1)}s)`);
    }
  }

  // Add detailed warnings for overlaps
  if (overlaps.length > 0) {
    warnings.push(`Found ${overlaps.length} overlap(s) between placements:`);
    for (const overlap of overlaps) {
      warnings.push(`  - ${overlap.type1} overlaps with ${overlap.type2} from ${formatTime(overlap.startTime)} to ${formatTime(overlap.endTime)}`);
    }
  }

  return {
    isValid,
    totalDuration: transcriptDuration,
    coveredDuration,
    gaps,
    overlaps,
    warnings,
  };
}

/**
 * Generate a human-readable validation report
 */
export function generateValidationReport(result: CoverageValidationResult): string {
  const lines: string[] = [];

  lines.push('=== Placement Coverage Validation ===');
  lines.push(`Total transcript duration: ${formatTime(result.totalDuration)}`);
  lines.push(`Covered duration: ${formatTime(result.coveredDuration)}`);
  lines.push(`Coverage: ${((result.coveredDuration / result.totalDuration) * 100).toFixed(1)}%`);

  if (result.isValid) {
    lines.push('');
    lines.push('✅ VALIDATION PASSED: All placements cover the entire video with no gaps or overlaps.');
  } else {
    lines.push('');
    lines.push('❌ VALIDATION FAILED: Issues found in placement coverage.');
  }

  if (result.gaps.length > 0) {
    lines.push('');
    lines.push(`Gaps (${result.gaps.length}):`);
    for (const gap of result.gaps) {
      lines.push(`  - ${formatTime(gap.startTime)} to ${formatTime(gap.endTime)} (${gap.duration.toFixed(1)}s)`);
    }
  }

  if (result.overlaps.length > 0) {
    lines.push('');
    lines.push(`Overlaps (${result.overlaps.length}):`);
    for (const overlap of result.overlaps) {
      lines.push(`  - ${overlap.type1} overlaps with ${overlap.type2} from ${formatTime(overlap.startTime)} to ${formatTime(overlap.endTime)}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  return lines.join('\n');
}

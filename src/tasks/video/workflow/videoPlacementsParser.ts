/**
 * Parser utility for video-placements.md file.
 * Extracts structured placement data from the markdown file.
 */

import { validatePlacementSets, type PlacementValidationConfig } from './PlacementValidator.js';

export interface ParsedVideoPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  videoType: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
  prompt: string;
  duration: number; // Calculated from timestamps, rounded to 4-10 seconds
  filename?: string; // Optional, for backward compatibility
}

export interface VideoParseError {
  line: number;
  content: string;
  reason: string;
  suggestion?: string;
}

export interface VideoParseResult {
  placements: ParsedVideoPlacement[];
  errors: VideoParseError[];
  warnings: string[];
}

export interface VideoPlacementParseOptions {
  validateOverlaps?: boolean;
  validationConfig?: PlacementValidationConfig;
}

/**
 * Convert time string to seconds.
 * Handles formats: "M:SS", "MM:SS", "H:MM:SS", "HH:MM:SS"
 */
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
    // HH:MM:SS[.mmm] format
    const hours = parseInt(parts[0] ?? '0', 10) || 0;
    const minutes = parseInt(parts[1] ?? '0', 10) || 0;
    const seconds = parseSeconds(parts[2] ?? '0');
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // M:SS[.mmm] or MM:SS[.mmm] format
    const minutes = parseInt(parts[0] ?? '0', 10) || 0;
    const seconds = parseSeconds(parts[1] ?? '0');
    return minutes * 60 + seconds;
  }
  // If it's just seconds (e.g., "15" or "15.500")
  return parseSeconds(cleaned);
}

/**
 * Round duration to nearest valid value (4-10 seconds).
 * Rounds to the nearest valid duration that matches generation capability.
 * Hard limit of 10 seconds due to hardware constraints.
 */
function roundDuration(seconds: number): number {
  // Round to nearest valid duration (4, 5, 6, 7, 8, 9, or 10)
  if (seconds <= 4.5) return 4;
  if (seconds <= 5.5) return 5;
  if (seconds <= 6.5) return 6;
  if (seconds <= 7.5) return 7;
  if (seconds <= 8.5) return 8;
  if (seconds <= 9.5) return 9;
  if (seconds <= 10.5) return 10;
  return 10; // Cap at 10 seconds (hardware limitation)
}

/**
 * Parse video placements from the video-placements.md file content.
 * 
 * Expected format:
 * - Placement N: startTime-endTime | type=video_type | prompt text
 * 
 * Legacy format (filename is optional, for backward compatibility):
 * - Placement N: startTime-endTime | type=video_type | prompt text | filename.mp4
 * 
 * @param content - The content of the video-placements.md file
 * @returns Array of parsed placements, sorted by placement number
 */
export function parseVideoPlacements(content: string): ParsedVideoPlacement[] {
  const result = parseVideoPlacementsWithErrors(content, false);
  if (result.warnings.length > 0) {
    console.warn('[parseVideoPlacements] Warnings:', result.warnings);
  }
  if (result.errors.length > 0) {
    console.error('[parseVideoPlacements] Errors (non-strict mode, continuing):', result.errors);
  }
  return result.placements;
}

export function parseVideoPlacementsWithErrors(
  content: string,
  strict: boolean = false,
  options: VideoPlacementParseOptions = {},
): VideoParseResult {
  const placements: ParsedVideoPlacement[] = [];
  const errors: VideoParseError[] = [];
  const warnings: string[] = [];
  
  // Split by lines and process each line
  const lines = content.split('\n');
  
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]!;
    // Look for lines that start with "- Placement" or "• Placement" or just "Placement"
    const trimmedLine = line.trim();
    if (!trimmedLine.includes('Placement')) {
      continue;
    }
    
    // Match pattern: - Placement N: startTime-endTime | type=video_type | prompt [| filename]
    // Also handle: • Placement N: ... (bullet point)
    // Filename is optional (for backward compatibility)
    const placementMatch = trimmedLine.match(/^[•\-]\s*Placement\s+(\d+):\s*([^\|]+)\s*\|\s*type=([^\|]+)\s*\|\s*([^\|]+)(?:\s*\|\s*(.+))?$/);
    
    if (!placementMatch || !placementMatch[1] || !placementMatch[2] || !placementMatch[3] || !placementMatch[4]) {
      // Try alternative format without leading dash/bullet
      const altMatch = trimmedLine.match(/Placement\s+(\d+):\s*([^\|]+)\s*\|\s*type=([^\|]+)\s*\|\s*([^\|]+)(?:\s*\|\s*(.+))?$/);
      if (!altMatch || !altMatch[1] || !altMatch[2] || !altMatch[3] || !altMatch[4]) {
        if (strict) {
          errors.push({
            line: lineNum + 1,
            content: trimmedLine,
            reason: 'Failed to match placement pattern',
            suggestion: 'Expected format: "- Placement N: start-end | type=video_type | prompt"',
          });
        }
        continue;
      }
      
      const placementNumber = parseInt(altMatch[1], 10);
      const timeRange = altMatch[2].trim();
      const videoTypeStr = altMatch[3].trim();
      const prompt = altMatch[4].trim();
      const filename = altMatch[5]?.trim() || undefined;
      
      // Parse time range (format: "0:15-0:24" or "7:41-7:56")
      const timeMatch = timeRange.match(/^(\[?[\d:.,]+\]?)\s*-\s*(\[?[\d:.,]+\]?)$/);
      if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
        if (strict) {
          errors.push({
            line: lineNum + 1,
            content: trimmedLine,
            reason: `Invalid time range: ${timeRange}`,
            suggestion: 'Expected format: start-end where start < end',
          });
        }
        continue;
      }
      
      const startTime = sanitizeTimeToken(timeMatch[1]);
      const endTime = sanitizeTimeToken(timeMatch[2]);
      const startSeconds = timeToSeconds(startTime);
      const endSeconds = timeToSeconds(endTime);
      if (startSeconds >= endSeconds) {
        if (strict) {
          errors.push({
            line: lineNum + 1,
            content: trimmedLine,
            reason: 'Start time must be less than end time',
          });
        }
        continue;
      }
      const duration = roundDuration(endSeconds - startSeconds);
      
      // Normalize video type
      const normalizedType = videoTypeStr.toLowerCase().trim();
      let videoType: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
      if (normalizedType === 'cinematic_realism' || normalizedType === 'cinematic-realism' || normalizedType === 'cinematic' || normalizedType === 'animation' || normalizedType === 'anim') {
        // Accept 'animation' for backward compatibility, but map to 'cinematic_realism'
        videoType = 'cinematic_realism';
      } else if (normalizedType === 'stock_footage' || normalizedType === 'stock') {
        videoType = 'stock_footage';
      } else if (normalizedType === 'motion_graphics' || normalizedType === 'motiongraphics' || normalizedType === 'motion') {
        videoType = 'motion_graphics';
      } else {
        // Default to cinematic_realism if unknown
        videoType = 'cinematic_realism';
      }
      
      placements.push({
        placementNumber,
        startTime,
        endTime,
        videoType,
        prompt,
        duration,
        filename,
      });
      continue;
    }
    
    const placementNumber = parseInt(placementMatch[1], 10);
    const timeRange = placementMatch[2].trim();
    const videoTypeStr = placementMatch[3].trim();
    const prompt = placementMatch[4].trim();
    const filename = placementMatch[5]?.trim() || undefined;
    
    // Parse time range (format: "0:15-0:24" or "7:41-7:56")
    const timeMatch = timeRange.match(/^(\[?[\d:.,]+\]?)\s*-\s*(\[?[\d:.,]+\]?)$/);
    if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: `Invalid time range: ${timeRange}`,
          suggestion: 'Expected format: start-end where start < end',
        });
      }
      continue;
    }
    
    const startTime = sanitizeTimeToken(timeMatch[1]);
    const endTime = sanitizeTimeToken(timeMatch[2]);
    const startSeconds = timeToSeconds(startTime);
    const endSeconds = timeToSeconds(endTime);
    if (startSeconds >= endSeconds) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: 'Start time must be less than end time',
        });
      }
      continue;
    }
    const duration = roundDuration(endSeconds - startSeconds);
    
    // Normalize video type
    const normalizedType = videoTypeStr.toLowerCase().trim();
    let videoType: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
    if (normalizedType === 'cinematic_realism' || normalizedType === 'cinematic-realism' || normalizedType === 'cinematic' || normalizedType === 'animation' || normalizedType === 'anim') {
      // Accept 'animation' for backward compatibility, but map to 'cinematic_realism'
      videoType = 'cinematic_realism';
    } else if (normalizedType === 'stock_footage' || normalizedType === 'stock') {
      videoType = 'stock_footage';
    } else if (normalizedType === 'motion_graphics' || normalizedType === 'motiongraphics' || normalizedType === 'motion') {
      videoType = 'motion_graphics';
    } else {
      // Default to cinematic_realism if unknown
      videoType = 'cinematic_realism';
    }
    
    placements.push({
      placementNumber,
      startTime,
      endTime,
      videoType,
      prompt,
      duration,
      filename,
    });
  }
  
  // Sort by placement number
  placements.sort((a, b) => a.placementNumber - b.placementNumber);

  if (options.validateOverlaps === true) {
    const validated = validatePlacementSets(
      {
        imagePlacements: [],
        videoPlacements: placements,
        infographicPlacements: [],
      },
      options.validationConfig,
    );
    placements.splice(0, placements.length, ...validated.videoPlacements);
    warnings.push(...validated.warnings);
  }
  
  return {
    placements,
    errors,
    warnings,
  };
}

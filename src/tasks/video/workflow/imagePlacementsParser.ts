/**
 * Parser utility for image-placements.md file.
 * Extracts structured placement data from the markdown file.
 * 
 * Improved parser with:
 * - Enhanced regex patterns for whitespace variations
 * - Flexible line-by-line parsing
 * - Comprehensive validation and error reporting
 */

export interface ParsedImagePlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  prompt: string;
}

export interface ParseError {
  line: number;
  content: string;
  reason: string;
  suggestion?: string;
}

export interface ParseResult {
  placements: ParsedImagePlacement[];
  errors: ParseError[];
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
 * Normalize time string to standard format (M:SS or MM:SS)
 */
function normalizeTime(timeStr: string): string {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    // HH:MM:SS -> MM:SS (if hours is 0) or keep as is
    const hours = parseInt(parts[0] ?? '0', 10) || 0;
    if (hours === 0) {
      return `${parts[1]}:${parts[2]}`;
    }
    return timeStr;
  }
  return timeStr;
}

/**
 * Parse time range string (e.g., "0:15-0:33" or "00:15-00:33")
 * Returns { startTime, endTime } or null if invalid
 */
function parseTimeRange(timeRange: string): { startTime: string; endTime: string } | null {
  // More flexible time range matching - handles various formats
  const timeMatch = timeRange.match(/^([\d:]+)\s*-\s*([\d:]+)$/);
  if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
    return null;
  }

  const startTime = normalizeTime(timeMatch[1].trim());
  const endTime = normalizeTime(timeMatch[2].trim());

  // Validate that start < end
  const startSeconds = timeToSeconds(startTime);
  const endSeconds = timeToSeconds(endTime);
  if (startSeconds >= endSeconds) {
    return null;
  }

  return { startTime, endTime };
}

/**
 * Try multiple regex patterns to match a placement line
 * Returns match groups or null if no pattern matches
 */
function tryMatchPlacementLine(line: string): RegExpMatchArray | null {
  // Pattern 1: Standard format with bullet/dash
  // Handles: - Placement N: time-time | prompt
  // More flexible whitespace handling
  let match = line.match(/^[•\-]\s*Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*(.+)$/);
  if (match) return match;

  // Pattern 2: Without leading bullet/dash
  match = line.match(/^Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*(.+)$/);
  if (match) return match;

  // Pattern 3: More flexible - allows extra spaces around colon and pipe
  match = line.match(/^[•\-]?\s*Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*(.+)$/);
  if (match) return match;

  return null;
}

/**
 * Parse image placements from the image-placements.md file content.
 * 
 * Expected format:
 * - Placement N: startTime-endTime | prompt text
 * 
 * Legacy format (filename is optional, for backward compatibility):
 * - Placement N: startTime-endTime | prompt text | filename.png
 * 
 * @param content - The content of the image-placements.md file
 * @param strict - If true, return errors for invalid lines. If false, silently skip them (backward compatibility)
 * @returns ParseResult with placements, errors, and warnings
 */
export function parseImagePlacementsWithErrors(
  content: string,
  strict: boolean = false,
): ParseResult {
  const placements: ParsedImagePlacement[] = [];
  const errors: ParseError[] = [];
  const warnings: string[] = [];

  // Split by lines and process each line
  const lines = content.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]!;
    const trimmedLine = line.trim();

    // Skip empty lines and header lines
    if (!trimmedLine || trimmedLine === 'IMAGE_PLACER:' || trimmedLine.startsWith('IMAGE_PLACER:')) {
      continue;
    }

    // Skip lines that don't contain "Placement"
    if (!trimmedLine.includes('Placement')) {
      continue;
    }

    // Try to match the placement line
    const match = tryMatchPlacementLine(trimmedLine);
    if (!match || !match[1] || !match[2] || !match[3]) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: 'Failed to match placement pattern',
          suggestion: 'Expected format: "- Placement N: startTime-endTime | prompt text"',
        });
      }
      continue;
    }

    const placementNumberStr = match[1]!;
    const timeRange = match[2]!.trim();
    const promptWithOptionalFilename = match[3]!.trim();

    // Parse placement number
    const placementNumber = parseInt(placementNumberStr, 10);
    if (isNaN(placementNumber) || placementNumber < 1) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: `Invalid placement number: ${placementNumberStr}`,
          suggestion: 'Placement number must be a positive integer',
        });
      }
      continue;
    }

    // Parse time range
    const timeRangeResult = parseTimeRange(timeRange);
    if (!timeRangeResult) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: `Invalid time range: ${timeRange}`,
          suggestion: 'Expected format: "startTime-endTime" (e.g., "0:15-0:33"). Start time must be less than end time.',
        });
      }
      continue;
    }

    // Extract prompt (remove optional filename if present)
    // Filename is optional and comes after a second pipe
    let prompt = promptWithOptionalFilename;
    const filenameMatch = promptWithOptionalFilename.match(/^(.+?)\s*\|\s*(.+)$/);
    if (filenameMatch && filenameMatch[2]) {
      // Has filename, use first part as prompt
      prompt = filenameMatch[1]!.trim();
      // Filename is ignored (for backward compatibility)
    }

    // Validate prompt is not empty
    if (!prompt || prompt.length === 0) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: 'Prompt is empty',
          suggestion: 'Provide a description for the image placement',
        });
      }
      continue;
    }

    placements.push({
      placementNumber,
      startTime: timeRangeResult.startTime,
      endTime: timeRangeResult.endTime,
      prompt,
    });
  }

  // Validate placements
  const placementNumbers = new Set<number>();
  for (const placement of placements) {
    if (placementNumbers.has(placement.placementNumber)) {
      warnings.push(`Duplicate placement number ${placement.placementNumber} found`);
    }
    placementNumbers.add(placement.placementNumber);
  }

  // Check for sequential placement numbers (warning, not error)
  const sortedNumbers = Array.from(placementNumbers).sort((a, b) => a - b);
  for (let i = 0; i < sortedNumbers.length; i++) {
    if (sortedNumbers[i] !== i + 1) {
      warnings.push(`Placement numbers are not sequential. Expected ${i + 1}, found ${sortedNumbers[i]}`);
      break;
    }
  }

  // Sort by placement number
  placements.sort((a, b) => a.placementNumber - b.placementNumber);

  return {
    placements,
    errors,
    warnings,
  };
}

/**
 * Parse image placements from the image-placements.md file content.
 * 
 * Expected format:
 * - Placement N: startTime-endTime | prompt text
 * 
 * Legacy format (filename is optional, for backward compatibility):
 * - Placement N: startTime-endTime | prompt text | filename.png
 * 
 * @param content - The content of the image-placements.md file
 * @returns Array of parsed placements, sorted by placement number
 * 
 * @deprecated Use parseImagePlacementsWithErrors for better error handling
 */
export function parseImagePlacements(content: string): ParsedImagePlacement[] {
  const result = parseImagePlacementsWithErrors(content, false);
  
  // Log warnings and errors for debugging
  if (result.warnings.length > 0) {
    console.warn('[parseImagePlacements] Warnings:', result.warnings);
  }
  if (result.errors.length > 0) {
    console.error('[parseImagePlacements] Errors (non-strict mode, continuing):', result.errors);
  }
  
  return result.placements;
}
/**
 * Parser utility for infographic-placements.md file.
 * Extracts structured placement data from the markdown file.
 *
 * Format:
 * INFOGRAPHIC_PLACER:
 * - Placement N: startTime-endTime | type=bar_chart|line_chart|diagram|statistic|list | prompt text
 */

export interface ParsedInfographicPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  infographicType: 'bar_chart' | 'line_chart' | 'diagram' | 'statistic' | 'list';
  prompt: string;
  /** Optional structured data for Remotion (labels, values, etc.) - parsed from prompt or future extensions */
  data?: Record<string, unknown>;
}

export interface InfographicParseError {
  line: number;
  content: string;
  reason: string;
  suggestion?: string;
}

export interface InfographicParseResult {
  placements: ParsedInfographicPlacement[];
  errors: InfographicParseError[];
  warnings: string[];
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
    const hours = parseInt(parts[0] ?? '0', 10) || 0;
    const minutes = parseInt(parts[1] ?? '0', 10) || 0;
    const seconds = parseSeconds(parts[2] ?? '0');
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseInt(parts[0] ?? '0', 10) || 0;
    const seconds = parseSeconds(parts[1] ?? '0');
    return minutes * 60 + seconds;
  }
  return parseSeconds(cleaned);
}

function normalizeInfographicType(raw: string): 'bar_chart' | 'line_chart' | 'diagram' | 'statistic' | 'list' {
  const n = raw.toLowerCase().trim().replace(/-/g, '_');
  if (n === 'bar_chart' || n === 'barchart' || n === 'bar') return 'bar_chart';
  if (n === 'line_chart' || n === 'linechart' || n === 'line') return 'line_chart';
  if (n === 'diagram') return 'diagram';
  if (n === 'statistic' || n === 'stat') return 'statistic';
  if (n === 'list') return 'list';
  return 'statistic';
}

/**
 * Parse infographic placements from the infographic-placements.md file content.
 *
 * Expected format:
 * INFOGRAPHIC_PLACER:
 * - Placement N: startTime-endTime | type=bar_chart|line_chart|diagram|statistic|list | prompt text
 *
 * @param content - The content of the infographic-placements.md file
 * @param strict - If true, return errors for invalid lines. If false, silently skip them.
 * @returns InfographicParseResult with placements, errors, and warnings
 */
export function parseInfographicPlacementsWithErrors(
  content: string,
  strict: boolean = false,
): InfographicParseResult {
  const placements: ParsedInfographicPlacement[] = [];
  const errors: InfographicParseError[] = [];
  const warnings: string[] = [];
  const lines = content.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]!;
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine === 'INFOGRAPHIC_PLACER:' || trimmedLine.startsWith('INFOGRAPHIC_PLACER:')) {
      continue;
    }
    if (!trimmedLine.includes('Placement')) {
      continue;
    }

    // - Placement N: start-end | type=infographic_type | prompt
    let match = trimmedLine.match(
      /^[•\-]?\s*Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*type\s*=\s*([^\|]+?)\s*\|\s*(.+)$/,
    );
    if (!match || !match[1] || !match[2] || !match[3] || !match[4]) {
      const alt = trimmedLine.match(/Placement\s+(\d+)\s*:\s*([^\|]+?)\s*\|\s*type\s*=\s*([^\|]+?)\s*\|\s*(.+)$/);
      if (!alt || !alt[1] || !alt[2] || !alt[3] || !alt[4]) {
        if (strict) {
          errors.push({
            line: lineNum + 1,
            content: trimmedLine,
            reason: 'Failed to match placement pattern',
            suggestion:
              'Expected format: "- Placement N: startTime-endTime | type=bar_chart|line_chart|diagram|statistic|list | prompt text"',
          });
        }
        continue;
      }
      match = alt;
    }

    const placementNumber = parseInt(match[1]!, 10);
    if (isNaN(placementNumber) || placementNumber < 1) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: `Invalid placement number: ${match[1]}`,
          suggestion: 'Placement number must be a positive integer',
        });
      }
      continue;
    }

    const timeRange = match[2]!.trim();
    const timeMatch = timeRange.match(/^(\[?[\d:.,]+\]?)\s*-\s*(\[?[\d:.,]+\]?)$/);
    if (!timeMatch || !timeMatch[1] || !timeMatch[2]) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: `Invalid time range: ${timeRange}`,
          suggestion: 'Expected format: "startTime-endTime" (e.g., "0:15-0:33")',
        });
      }
      continue;
    }

    const startTime = sanitizeTimeToken(timeMatch[1].trim());
    const endTime = sanitizeTimeToken(timeMatch[2].trim());
    const startSeconds = timeToSeconds(startTime);
    const endSeconds = timeToSeconds(endTime);
    if (startSeconds >= endSeconds) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: 'Start time must be less than end time',
          suggestion: 'Use a valid time range',
        });
      }
      continue;
    }

    const typeStr = match[3]!.trim();
    const prompt = match[4]!.trim();
    if (!prompt) {
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason: 'Prompt is empty',
          suggestion: 'Provide a description or spec for the infographic',
        });
      }
      continue;
    }

    const infographicType = normalizeInfographicType(typeStr);
    placements.push({
      placementNumber,
      startTime,
      endTime,
      infographicType,
      prompt,
    });
  }

  const placementNumbers = new Set<number>();
  for (const p of placements) {
    if (placementNumbers.has(p.placementNumber)) {
      warnings.push(`Duplicate placement number ${p.placementNumber} found`);
    }
    placementNumbers.add(p.placementNumber);
  }
  placements.sort((a, b) => a.placementNumber - b.placementNumber);

  return { placements, errors, warnings };
}

/**
 * Parse infographic placements from the infographic-placements.md file content.
 *
 * @param content - The content of the infographic-placements.md file
 * @returns Array of parsed placements, sorted by placement number
 */
export function parseInfographicPlacements(content: string): ParsedInfographicPlacement[] {
  const result = parseInfographicPlacementsWithErrors(content, false);
  if (result.warnings.length > 0) {
    console.warn('[parseInfographicPlacements] Warnings:', result.warnings);
  }
  if (result.errors.length > 0) {
    console.error('[parseInfographicPlacements] Errors (non-strict):', result.errors);
  }
  return result.placements;
}

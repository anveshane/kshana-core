/**
 * Parser utility for infographic-placements.md file.
 * Extracts structured placement data from the markdown file.
 *
 * Format:
 * INFOGRAPHIC_PLACER:
 * - Placement N: startTime-endTime | type=bar_chart|line_chart|diagram|statistic|list | prompt text
 */
import { z } from 'zod';
import { getPhaseLogger } from '../../../utils/phaseLogger.js';

const logger = getPhaseLogger();

export const INFOGRAPHIC_TYPES = ['bar_chart', 'line_chart', 'diagram', 'statistic', 'list'] as const;
export type InfographicType = typeof INFOGRAPHIC_TYPES[number];

/** Zod schema for parsed infographic data fields */
const infographicDataSchema = z.record(z.string(), z.unknown()).optional();

export interface ParsedInfographicPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  infographicType: InfographicType;
  prompt: string;
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

function normalizeInfographicType(raw: string): InfographicType {
  const n = raw.toLowerCase().trim().replace(/-/g, '_');
  if (n === 'bar_chart' || n === 'barchart' || n === 'bar') return 'bar_chart';
  if (n === 'line_chart' || n === 'linechart' || n === 'line') return 'line_chart';
  if (n === 'diagram') return 'diagram';
  if (n === 'statistic' || n === 'stat') return 'statistic';
  if (n === 'list') return 'list';
  return 'statistic';
}

function parsePromptAndData(rawPromptSegment: string): {
  prompt: string;
  data?: Record<string, unknown>;
  dataParseError?: string;
} {
  const markerMatch = rawPromptSegment.match(/^(.*)\|\s*data\s*=\s*([\s\S]*)$/);
  if (!markerMatch || !markerMatch[1]) {
    return { prompt: rawPromptSegment.trim() };
  }

  const prompt = markerMatch[1].trim();
  const rawData = markerMatch[2]?.trim();
  if (!rawData) {
    return { prompt, dataParseError: 'data= marker present but JSON payload is empty' };
  }

  try {
    const parsed = JSON.parse(rawData) as unknown;
    // Validate with Zod
    const result = infographicDataSchema.safeParse(parsed);
    if (!result.success) {
      return { prompt, dataParseError: `data validation failed: ${result.error.message}` };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { prompt, dataParseError: 'data JSON must be an object' };
    }
    return { prompt, data: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      prompt,
      dataParseError:
        error instanceof Error ? error.message : `Invalid data JSON: ${String(error)}`,
    };
  }
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
    const parsedPrompt = parsePromptAndData(match[4]!);
    const prompt = parsedPrompt.prompt;

    if (parsedPrompt.dataParseError) {
      const reason = `Invalid data JSON: ${parsedPrompt.dataParseError}`;
      if (strict) {
        errors.push({
          line: lineNum + 1,
          content: trimmedLine,
          reason,
          suggestion:
            'Use valid JSON object syntax for data payload, e.g. data={"labels":["Q1"],"values":[42]}',
        });
        continue;
      }
      warnings.push(`Line ${lineNum + 1}: ${reason}`);
    }

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
      data: parsedPrompt.data,
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

  // Log any adjustments
  if (warnings.length > 0) {
    logger.info('remotion', 'parse', `Placement parser produced ${warnings.length} warning(s)`, {
      warnings: warnings.slice(0, 5),
    });
  }

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
    logger.warn('remotion', 'parse', `Warnings: ${result.warnings.join('; ')}`);
  }
  return result.placements;
}

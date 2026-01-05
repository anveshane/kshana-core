/**
 * SRT parsing and writing tools for transcript-first workflow.
 */
import { createTool } from '../../../core/tools/index.js';
import type { ToolDefinition } from '../../../core/llm/index.js';
import { loadProject, saveProject, writeProjectFile } from '../workflow/ProjectManager.js';
import type { TranscriptEntry, ImagePlacement } from '../workflow/types.js';

function parseTimecodeToSeconds(timecode: string): number {
  const match = timecode.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) {
    return 0;
  }
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
}

function formatSecondsToTimecode(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function parseSrtText(srtText: string): TranscriptEntry[] {
  const blocks = srtText
    .split(/\r?\n\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);

  const entries: TranscriptEntry[] = [];

  for (const [i, block] of blocks.entries()) {
    const lines = block.split(/\r?\n/).map(line => line.trim());
    if (lines.length < 2) {
      continue;
    }
    const indexLine = lines[0] || '';
    const timeLine = lines[1] || '';
    const match = timeLine.match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!match || !match[1] || !match[2]) {
      continue;
    }
    const index = /^\d+$/.test(indexLine) ? Number(indexLine) : i + 1;
    const startTime = parseTimecodeToSeconds(match[1]);
    const endTime = parseTimecodeToSeconds(match[2]);
    const text = lines.slice(2).join(' ').trim();
    entries.push({ index, startTime, endTime, text });
  }

  return entries;
}

/**
 * Parse raw transcript text with embedded timestamps (e.g., "3:53 of brown", "4:00 all of it")
 * into SRT format entries.
 */
function parseRawTranscriptWithTimestamps(rawText: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  
  let currentEntry: { startTime?: number; text: string[] } | null = null;
  let entryIndex = 1;

  for (const line of lines) {
    // Match timestamps like "3:53", "4:00", "12:34" at the start of line
    // Also handle formats like "│ 3:53" (with box drawing characters)
    const timestampMatch = line.match(/^[│\s]*(\d{1,2}):(\d{2})(?:\s|$)/);
    
    if (timestampMatch) {
      // Save previous entry if exists
      if (currentEntry && currentEntry.startTime !== undefined && currentEntry.text.length > 0) {
        const text = currentEntry.text.join(' ').trim();
        if (text) {
          // Estimate end time as start time + 3 seconds (default duration)
          const endTime = currentEntry.startTime + 3;
          entries.push({
            index: entryIndex++,
            startTime: currentEntry.startTime,
            endTime,
            text,
          });
        }
      }
      
      // Start new entry
      const minutes = Number(timestampMatch[1]);
      const seconds = Number(timestampMatch[2]);
      const startTime = minutes * 60 + seconds;
      
      // Extract text after timestamp
      const textAfterTimestamp = line.replace(/^[│\s]*\d{1,2}:\d{2}\s*/, '').trim();
      
      currentEntry = {
        startTime,
        text: textAfterTimestamp ? [textAfterTimestamp] : [],
      };
    } else if (currentEntry) {
      // Continue current entry with more text
      const cleanLine = line.replace(/^[│\s]*/, '').trim();
      if (cleanLine) {
        currentEntry.text.push(cleanLine);
      }
    }
  }
  
  // Save last entry
  if (currentEntry && currentEntry.startTime !== undefined && currentEntry.text.length > 0) {
    const text = currentEntry.text.join(' ').trim();
    if (text) {
      const endTime = currentEntry.startTime + 3;
      entries.push({
        index: entryIndex++,
        startTime: currentEntry.startTime,
        endTime,
        text,
      });
    }
  }
  
  // Adjust end times to not overlap with next start time
  for (let i = 0; i < entries.length - 1; i++) {
    if (entries[i].endTime > entries[i + 1].startTime) {
      entries[i].endTime = entries[i + 1].startTime;
    }
  }
  
  return entries;
}

/**
 * Detect if text is raw transcript format (timestamps embedded in text) vs SRT format.
 */
function isRawTranscriptFormat(text: string): boolean {
  // Check for SRT format first (has "00:00:00,000 --> 00:00:00,000" pattern)
  const srtPattern = /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/;
  if (srtPattern.test(text)) {
    return false; // It's SRT format
  }
  
  // Check for raw transcript format (timestamps like "3:53", "4:00" at start of lines)
  const rawTranscriptPattern = /^[│\s]*\d{1,2}:\d{2}(?:\s|$)/m;
  return rawTranscriptPattern.test(text);
}

function validateSrtText(srtText: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const entries = parseSrtText(srtText);
  if (entries.length === 0) {
    errors.push('No valid SRT entries found.');
  }
  for (const entry of entries) {
    if (entry.endTime < entry.startTime) {
      errors.push(`Entry ${entry.index} has an end time before start time.`);
    }
    if (!entry.text) {
      errors.push(`Entry ${entry.index} has no subtitle text.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export const parseSrtTool: ToolDefinition = createTool(
  'parse_srt',
  'Parse SRT text or raw transcript text (with embedded timestamps) into structured transcript entries and store them in project state. Automatically detects format and converts raw transcript to SRT format if needed.',
  {
    type: 'object',
    properties: {
      srt_text: { type: 'string', description: 'Raw SRT content or raw transcript text with embedded timestamps (e.g., "3:53 of brown", "4:00 all of it")' },
    },
    required: ['srt_text'],
  },
  async (args: Record<string, unknown>) => {
    const inputText = args['srt_text'] as string;
    
    // Detect format and parse accordingly
    let entries: TranscriptEntry[];
    if (isRawTranscriptFormat(inputText)) {
      // Convert raw transcript to entries
      entries = parseRawTranscriptWithTimestamps(inputText);
    } else {
      // Parse as SRT format
      entries = parseSrtText(inputText);
    }
    
    const totalDuration = entries.length > 0 ? entries[entries.length - 1]?.endTime ?? 0 : 0;

    const project = loadProject();
    if (project) {
      project.transcriptEntries = entries;
      saveProject(project);
    }

    return {
      status: 'success',
      total_entries: entries.length,
      total_duration: totalDuration,
      entries,
      format_detected: isRawTranscriptFormat(inputText) ? 'raw_transcript' : 'srt',
    };
  }
);

export const validateSrtTool: ToolDefinition = createTool(
  'validate_srt',
  'Validate SRT text formatting and report any errors.',
  {
    type: 'object',
    properties: {
      srt_text: { type: 'string', description: 'Raw SRT content as a string' },
    },
    required: ['srt_text'],
  },
  async (args: Record<string, unknown>) => {
    const srtText = args['srt_text'] as string;
    const result = validateSrtText(srtText);
    return {
      status: result.valid ? 'success' : 'invalid',
      valid: result.valid,
      errors: result.errors,
    };
  }
);

export const writeSrtWithImagesTool: ToolDefinition = createTool(
  'write_srt_with_images',
  'Write an SRT file with image tags inserted for placement alignment.',
  {
    type: 'object',
    properties: {
      srt_text: { type: 'string', description: 'Original SRT content as a string' },
      image_placements: {
        type: 'array',
        description: 'Image placement entries aligned to transcript indices',
        items: { type: 'object' },
      },
      output_path: {
        type: 'string',
        description: 'Output path within .kshana (default: agent/script/subtitles_with_images.srt)',
      },
    },
    required: ['srt_text', 'image_placements'],
  },
  async (args: Record<string, unknown>) => {
    const srtText = args['srt_text'] as string;
    const placements = (args['image_placements'] as ImagePlacement[]) || [];
    const outputPath = (args['output_path'] as string) || 'agent/script/subtitles_with_images.srt';

    const entries = parseSrtText(srtText);
    const placementsByIndex = new Map<number, ImagePlacement[]>();
    for (const placement of placements) {
      const list = placementsByIndex.get(placement.transcriptIndex) || [];
      list.push(placement);
      placementsByIndex.set(placement.transcriptIndex, list);
    }

    const outputBlocks = entries.map(entry => {
      const timecode = `${formatSecondsToTimecode(entry.startTime)} --> ${formatSecondsToTimecode(entry.endTime)}`;
      const placementsForEntry = placementsByIndex.get(entry.index) || [];
      const imageTags = placementsForEntry.map(p => {
        const ref = p.imagePath || p.imageArtifactId || 'image_placeholder';
        return `[image:${ref}]`;
      });
      const textLines = entry.text ? [entry.text] : [];
      const combinedText = [...textLines, ...imageTags].join('\n');
      return `${entry.index}\n${timecode}\n${combinedText}`.trim();
    });

    const outputContent = outputBlocks.join('\n\n') + '\n';
    writeProjectFile(outputPath, outputContent);

    return {
      status: 'success',
      output_path: outputPath,
      total_entries: entries.length,
    };
  }
);

export function getSrtTools(): ToolDefinition[] {
  return [parseSrtTool, validateSrtTool, writeSrtWithImagesTool];
}

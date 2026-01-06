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

function formatTranscriptMarkdown(entries: TranscriptEntry[]): string {
  const lines: string[] = ['# Transcript', ''];
  for (const entry of entries) {
    const start = formatSecondsToTimecode(entry.startTime);
    const end = formatSecondsToTimecode(entry.endTime);
    const text = entry.text.trim();
    lines.push(`- ${entry.index} [${start} --> ${end}] ${text}`);
  }
  return lines.join('\n').trim() + '\n';
}

/**
 * Merge transcript entries into 10-15 second segments with full sentences.
 */
function mergeEntriesIntoSentences(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (entries.length === 0) {
    return entries;
  }

  const minDuration = 10; // Minimum 10 seconds per entry
  const maxDuration = 15; // Maximum 15 seconds per entry
  const merged: TranscriptEntry[] = [];
  let currentEntry: { startTime: number; texts: string[]; lastEndTime: number } | null = null;
  let entryIndex = 1;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const nextEntry = entries[i + 1];

    if (!currentEntry) {
      // Start a new merged entry
      currentEntry = {
        startTime: entry.startTime,
        texts: [entry.text],
        lastEndTime: entry.endTime,
      };
      continue;
    }

    // Add this entry to the current merged entry
    currentEntry.texts.push(entry.text);
    currentEntry.lastEndTime = entry.endTime;

    // Calculate duration from start to the end of the current entry
    const duration = currentEntry.lastEndTime - currentEntry.startTime;
    const combinedText = currentEntry.texts.join(' ').trim();
    const endsWithSentence = /[.!?]\s*$/.test(combinedText);

    // Determine end time: use next entry's start time if available, otherwise use current entry's end time
    const endTime = nextEntry 
      ? Math.min(currentEntry.lastEndTime, nextEntry.startTime)
      : currentEntry.lastEndTime;

    // Create merged entry if: reached min duration AND ends with sentence, OR exceeded max duration
    if ((duration >= minDuration && endsWithSentence) || duration >= maxDuration) {
      merged.push({
        index: entryIndex++,
        startTime: currentEntry.startTime,
        endTime: Math.max(endTime, currentEntry.startTime + minDuration),
        text: combinedText,
      });
      // Start a new merged entry with the next entry
      currentEntry = null;
    }
  }

  // Flush remaining entry
  if (currentEntry) {
    const finalText = currentEntry.texts.join(' ').trim();
    if (finalText) {
      merged.push({
        index: entryIndex++,
        startTime: currentEntry.startTime,
        endTime: Math.max(currentEntry.lastEndTime, currentEntry.startTime + minDuration),
        text: finalText,
      });
    }
  }

  // Final pass: ensure end times don't overlap with next start times and enforce minimum duration
  for (let i = 0; i < merged.length; i++) {
    const entry = merged[i];
    if (!entry) continue;
    const nextEntry = merged[i + 1];
    
    // Adjust end time to prevent overlap
    if (nextEntry && nextEntry.startTime > entry.startTime) {
      entry.endTime = Math.min(entry.endTime, nextEntry.startTime);
    }
    
    // Ensure minimum duration
    const actualDuration = entry.endTime - entry.startTime;
    if (actualDuration < minDuration) {
      entry.endTime = entry.startTime + minDuration;
      // If this causes overlap with next entry, adjust next entry's start time
      if (nextEntry && entry.endTime > nextEntry.startTime) {
        nextEntry.startTime = entry.endTime;
      }
    }
  }

  return merged;
}

export function parseSrtText(srtText: string): TranscriptEntry[] {
  const blocks = srtText
    .split(/\r?\n\r?\n+/)
    .map(block => block.trim())
    .filter(Boolean);

  const rawEntries: TranscriptEntry[] = [];

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
    rawEntries.push({ index, startTime, endTime, text });
  }

  // Merge entries into 10-15 second segments with full sentences
  return mergeEntriesIntoSentences(rawEntries);
}

/**
 * Parse raw transcript text with embedded timestamps (e.g., "3:53 of brown", "4:00 all of it")
 * into SRT format entries. Groups segments into full sentences with 10-15 second duration.
 */
function parseRawTranscriptWithTimestamps(rawText: string): TranscriptEntry[] {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const minDuration = 10; // Minimum 10 seconds per entry
  const maxDuration = 15; // Maximum 15 seconds per entry

  // First pass: collect all timestamp-text pairs
  const segments: Array<{ startTime: number; text: string }> = [];
  let currentSegment: { startTime?: number; text: string[] } | null = null;

  const flushCurrentSegment = () => {
    if (!currentSegment || currentSegment.startTime === undefined) {
      currentSegment = null;
      return;
    }
    const text = currentSegment.text.join(' ').trim();
    if (text && currentSegment.startTime !== undefined) {
      segments.push({
        startTime: currentSegment.startTime,
        text,
      });
    }
    currentSegment = null;
  };

  for (const line of lines) {
    const cleanedLine = line.replace(/^[│\s]*/, '');
    const matches = [...cleanedLine.matchAll(/(\d{1,2}):(\d{2})/g)];

    if (matches.length === 0) {
      if (currentSegment) {
        const cleanLine = cleanedLine.trim();
        if (cleanLine) {
          currentSegment.text.push(cleanLine);
        }
      }
      continue;
    }

    const firstMatch = matches[0];
    if (currentSegment && firstMatch && firstMatch.index !== undefined && firstMatch.index > 0) {
      const leadingText = cleanedLine.slice(0, firstMatch.index).trim();
      if (leadingText) {
        currentSegment.text.push(leadingText);
      }
    }

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      if (!match) continue;
      const nextMatch = matches[i + 1];
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const startTime = minutes * 60 + seconds;
      const textStart = (match.index ?? 0) + match[0].length;
      const textEnd = nextMatch?.index ?? cleanedLine.length;
      const segment = cleanedLine.slice(textStart, textEnd).trim();

      flushCurrentSegment();
      currentSegment = { startTime, text: segment ? [segment] : [] };

      if (nextMatch) {
        flushCurrentSegment();
      }
    }
  }

  flushCurrentSegment();

  // Second pass: merge segments into full sentences with 10-15 second duration
  const entries: TranscriptEntry[] = [];
  let currentEntry: { startTime: number; texts: string[] } | null = null;
  let entryIndex = 1;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const nextSegment = segments[i + 1];

    if (!currentEntry) {
      currentEntry = { startTime: segment.startTime, texts: [segment.text] };
      continue;
    }

    const duration = segment.startTime - currentEntry.startTime;
    const combinedText = [...currentEntry.texts, segment.text].join(' ');
    const endsWithSentence = /[.!?]\s*$/.test(combinedText.trim());

    // Determine end time: use next segment's start time if available, otherwise estimate
    const estimatedEndTime = nextSegment ? nextSegment.startTime : segment.startTime + minDuration;

    // Create entry if: reached min duration AND ends with sentence, OR exceeded max duration
    if ((duration >= minDuration && endsWithSentence) || duration >= maxDuration) {
      entries.push({
        index: entryIndex++,
        startTime: currentEntry.startTime,
        endTime: estimatedEndTime,
        text: combinedText.trim(),
      });
      currentEntry = { startTime: segment.startTime, texts: [segment.text] };
    } else {
      currentEntry.texts.push(segment.text);
    }
  }

  // Flush remaining entry
  if (currentEntry) {
    const finalText = currentEntry.texts.join(' ').trim();
    if (finalText) {
      // Use the last segment's time + minDuration as end time
      const lastSegment = segments[segments.length - 1];
      const endTime = lastSegment ? lastSegment.startTime + minDuration : currentEntry.startTime + minDuration;
      entries.push({
        index: entryIndex++,
        startTime: currentEntry.startTime,
        endTime,
        text: finalText,
      });
    }
  }

  // Final pass: ensure end times don't overlap with next start times
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const nextEntry = entries[i + 1];
    if (nextEntry && nextEntry.startTime > entry.startTime) {
      entry.endTime = Math.min(entry.endTime, nextEntry.startTime);
    }
    // Ensure minimum duration
    if (entry.endTime - entry.startTime < minDuration) {
      entry.endTime = entry.startTime + minDuration;
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
  
  // Check for raw transcript format (timestamps like "3:53", "4:00" embedded in text)
  const rawTranscriptPattern = /\b\d{1,2}:\d{2}\b/;
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

    const transcriptPath = 'agent/content/transcript.md';
    if (entries.length > 0) {
      const transcriptContent = formatTranscriptMarkdown(entries);
      writeProjectFile(transcriptPath, transcriptContent);
    }

    return {
      status: 'success',
      total_entries: entries.length,
      total_duration: totalDuration,
      entries,
      format_detected: isRawTranscriptFormat(inputText) ? 'raw_transcript' : 'srt',
      transcript_path: transcriptPath,
      transcript_preview: formatTranscriptMarkdown(entries.slice(0, 10)), // Show first 10 entries
      message: `Successfully parsed ${entries.length} transcript entries. Saved to ${transcriptPath}`,
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

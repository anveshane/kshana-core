/**
 * ScriptParser - Service for parsing video scripts in various formats.
 * Supports SRT, VTT, screenplay, timestamped text, and plain text formats.
 */

import type { ScriptFormat, ScriptSegment, TimeRange } from '../../tasks/video-edit/workflow/types.js';

/**
 * Result of script format detection.
 */
export interface FormatDetectionResult {
  /** Detected format */
  format: ScriptFormat;
  /** Confidence score (0-1) */
  confidence: number;
  /** Indicators found */
  indicators: string[];
}

/**
 * Script parsing options.
 */
export interface ParseOptions {
  /** Force a specific format instead of auto-detecting */
  forceFormat?: ScriptFormat;
  /** Extract keywords from segments */
  extractKeywords?: boolean;
  /** Minimum keyword length */
  minKeywordLength?: number;
}

/**
 * Alignment result for script-to-video alignment.
 */
export interface AlignmentResult {
  /** Aligned segments with time ranges */
  segments: ScriptSegment[];
  /** Whether all segments have timestamps */
  fullyTimestamped: boolean;
  /** Segments without timestamps */
  untimestampedCount: number;
}

/**
 * ScriptParser class for parsing video scripts.
 */
export class ScriptParser {
  private stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
    'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all',
    'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'not', 'only', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
  ]);

  /**
   * Detect the format of a script.
   */
  detectFormat(content: string): FormatDetectionResult {
    const indicators: string[] = [];
    let format: ScriptFormat = 'plain_text';
    let confidence = 0.3;

    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
      return { format: 'plain_text', confidence: 0.1, indicators: ['Empty content'] };
    }

    // Check for SRT format
    // SRT has numbered entries, timestamp lines with --> and comma for ms
    const srtPattern = /^\d+$/;
    const srtTimePattern = /^\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}$/;
    let srtScore = 0;
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      if (srtPattern.test(lines[i] ?? '')) srtScore += 0.5;
      if (srtTimePattern.test(lines[i] ?? '')) srtScore += 2;
    }
    if (srtScore >= 2) {
      indicators.push('SRT timestamp format detected');
      format = 'srt';
      confidence = Math.min(0.95, 0.5 + srtScore * 0.1);
    }

    // Check for VTT format
    // VTT has WEBVTT header and timestamps with --> and dot for ms
    if (lines[0]?.toUpperCase().startsWith('WEBVTT')) {
      indicators.push('WEBVTT header found');
      format = 'vtt';
      confidence = 0.95;
    } else {
      const vttTimePattern = /^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}$/;
      let vttScore = 0;
      for (let i = 0; i < Math.min(lines.length, 20); i++) {
        if (vttTimePattern.test(lines[i] ?? '')) vttScore += 2;
      }
      if (vttScore >= 2 && format !== 'srt') {
        indicators.push('VTT timestamp format detected');
        format = 'vtt';
        confidence = Math.min(0.9, 0.4 + vttScore * 0.1);
      }
    }

    // Check for screenplay format
    // Scene headings: INT., EXT., I/E
    // Character names in caps
    // Parentheticals, transitions
    const sceneHeadingPattern = /^(INT\.|EXT\.|I\/E\.|INT\/EXT\.)/i;
    const characterPattern = /^[A-Z][A-Z\s]+$/;
    const transitionPattern = /^(FADE IN:|FADE OUT\.|CUT TO:|DISSOLVE TO:|SMASH CUT:)/i;
    let screenplayScore = 0;
    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i] ?? '';
      if (sceneHeadingPattern.test(line)) screenplayScore += 3;
      if (characterPattern.test(line) && line.length < 30) screenplayScore += 1;
      if (transitionPattern.test(line)) screenplayScore += 2;
    }
    if (screenplayScore >= 5 && format === 'plain_text') {
      indicators.push('Screenplay formatting detected');
      format = 'screenplay';
      confidence = Math.min(0.9, 0.3 + screenplayScore * 0.05);
    }

    // Check for timestamped text
    // [00:00:15] or (00:15) or 0:15 - patterns
    const timestampPatterns = [
      /^\[?\d{1,2}:\d{2}(:\d{2})?\]?/,  // [00:15] or 0:15 or [00:01:15]
      /^\(\d{1,2}:\d{2}(:\d{2})?\)/,     // (00:15) or (00:01:15)
      /^\d{1,2}:\d{2}(:\d{2})?\s*[-–—]/,  // 00:15 - or 0:01:15 —
    ];
    let timestampedScore = 0;
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      const line = lines[i] ?? '';
      if (timestampPatterns.some(p => p.test(line))) timestampedScore += 2;
    }
    if (timestampedScore >= 4 && format === 'plain_text') {
      indicators.push('Timestamp markers detected');
      format = 'timestamped_text';
      confidence = Math.min(0.85, 0.4 + timestampedScore * 0.05);
    }

    if (indicators.length === 0) {
      indicators.push('No specific format indicators found');
    }

    return { format, confidence, indicators };
  }

  /**
   * Parse SRT subtitle format.
   */
  parseSRT(content: string): ScriptSegment[] {
    const segments: ScriptSegment[] = [];
    const blocks = content.trim().split(/\n\s*\n/);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]?.trim();
      if (!block) continue;

      const lines = block.split('\n').map(l => l.trim());
      if (lines.length < 2) continue;

      // First line should be sequence number
      const seqMatch = lines[0]?.match(/^\d+$/);
      if (!seqMatch) continue;

      // Second line should be timestamp
      const timeMatch = lines[1]?.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
      if (!timeMatch) continue;

      const startMs = this.parseTimestampToMs(timeMatch[1]!, timeMatch[2]!, timeMatch[3]!, timeMatch[4]!);
      const endMs = this.parseTimestampToMs(timeMatch[5]!, timeMatch[6]!, timeMatch[7]!, timeMatch[8]!);

      // Remaining lines are the text
      const text = lines.slice(2).join(' ').trim();
      if (!text) continue;

      segments.push({
        id: `seg_${i}`,
        index: i,
        timeRange: { startMs, endMs },
        text,
        type: 'dialogue',
      });
    }

    return segments;
  }

  /**
   * Parse VTT subtitle format.
   */
  parseVTT(content: string): ScriptSegment[] {
    const segments: ScriptSegment[] = [];
    const lines = content.split('\n');

    // Skip WEBVTT header and metadata
    let startIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]?.trim() === '') {
        startIdx = i + 1;
        break;
      }
    }

    const blocks = lines.slice(startIdx).join('\n').trim().split(/\n\s*\n/);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]?.trim();
      if (!block) continue;

      const blockLines = block.split('\n').map(l => l.trim());

      // Find timestamp line (might have optional cue identifier first)
      let timeLineIdx = 0;
      const timePattern = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

      // Also support short format: MM:SS.mmm
      const shortTimePattern = /^(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2})\.(\d{3})/;

      for (let j = 0; j < blockLines.length; j++) {
        if (timePattern.test(blockLines[j] ?? '') || shortTimePattern.test(blockLines[j] ?? '')) {
          timeLineIdx = j;
          break;
        }
      }

      const timeLine = blockLines[timeLineIdx];
      if (!timeLine) continue;

      let startMs: number, endMs: number;

      const fullMatch = timeLine.match(timePattern);
      const shortMatch = timeLine.match(shortTimePattern);

      if (fullMatch) {
        startMs = this.parseTimestampToMs(fullMatch[1]!, fullMatch[2]!, fullMatch[3]!, fullMatch[4]!);
        endMs = this.parseTimestampToMs(fullMatch[5]!, fullMatch[6]!, fullMatch[7]!, fullMatch[8]!);
      } else if (shortMatch) {
        startMs = this.parseTimestampToMs('00', shortMatch[1]!, shortMatch[2]!, shortMatch[3]!);
        endMs = this.parseTimestampToMs('00', shortMatch[4]!, shortMatch[5]!, shortMatch[6]!);
      } else {
        continue;
      }

      // Text is everything after the timestamp line
      const text = blockLines.slice(timeLineIdx + 1).join(' ').trim();
      if (!text) continue;

      segments.push({
        id: `seg_${i}`,
        index: i,
        timeRange: { startMs, endMs },
        text: this.stripVTTTags(text),
        type: 'dialogue',
      });
    }

    return segments;
  }

  /**
   * Parse screenplay format.
   */
  parseScreenplay(content: string): ScriptSegment[] {
    const segments: ScriptSegment[] = [];
    const lines = content.split('\n');

    let currentScene = 0;
    let currentSegment: Partial<ScriptSegment> | null = null;

    const sceneHeadingPattern = /^(INT\.|EXT\.|I\/E\.|INT\/EXT\.)\s*(.+)/i;
    const characterPattern = /^([A-Z][A-Z\s]+)(\s*\(.*\))?$/;
    const parentheticalPattern = /^\(.*\)$/;
    const transitionPattern = /^(FADE IN:|FADE OUT\.|CUT TO:|DISSOLVE TO:|SMASH CUT:|MATCH CUT:)/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim() ?? '';
      if (!line) {
        // End of segment
        if (currentSegment && currentSegment.text) {
          segments.push({
            id: `seg_${segments.length}`,
            index: segments.length,
            text: currentSegment.text.trim(),
            type: currentSegment.type ?? 'unknown',
            speaker: currentSegment.speaker,
            sceneNumber: currentSegment.sceneNumber,
          });
          currentSegment = null;
        }
        continue;
      }

      // Scene heading
      const sceneMatch = line.match(sceneHeadingPattern);
      if (sceneMatch) {
        if (currentSegment && currentSegment.text) {
          segments.push({
            id: `seg_${segments.length}`,
            index: segments.length,
            text: currentSegment.text.trim(),
            type: currentSegment.type ?? 'unknown',
            speaker: currentSegment.speaker,
            sceneNumber: currentSegment.sceneNumber,
          });
        }
        currentScene++;
        currentSegment = {
          type: 'scene_heading',
          text: line,
          sceneNumber: currentScene,
        };
        continue;
      }

      // Transition
      if (transitionPattern.test(line)) {
        if (currentSegment && currentSegment.text) {
          segments.push({
            id: `seg_${segments.length}`,
            index: segments.length,
            text: currentSegment.text.trim(),
            type: currentSegment.type ?? 'unknown',
            speaker: currentSegment.speaker,
            sceneNumber: currentSegment.sceneNumber,
          });
        }
        currentSegment = {
          type: 'transition',
          text: line,
          sceneNumber: currentScene,
        };
        continue;
      }

      // Character name (dialogue cue)
      const charMatch = line.match(characterPattern);
      if (charMatch && line.length < 40) {
        if (currentSegment && currentSegment.text) {
          segments.push({
            id: `seg_${segments.length}`,
            index: segments.length,
            text: currentSegment.text.trim(),
            type: currentSegment.type ?? 'unknown',
            speaker: currentSegment.speaker,
            sceneNumber: currentSegment.sceneNumber,
          });
        }
        currentSegment = {
          type: 'dialogue',
          speaker: charMatch[1]?.trim(),
          text: '',
          sceneNumber: currentScene,
        };
        continue;
      }

      // Parenthetical (skip, but could be attached to dialogue)
      if (parentheticalPattern.test(line)) {
        if (currentSegment) {
          currentSegment.text = (currentSegment.text ?? '') + ` ${line}`;
        }
        continue;
      }

      // Action or dialogue continuation
      if (currentSegment) {
        currentSegment.text = (currentSegment.text ?? '') + ' ' + line;
      } else {
        currentSegment = {
          type: 'action',
          text: line,
          sceneNumber: currentScene,
        };
      }
    }

    // Don't forget the last segment
    if (currentSegment && currentSegment.text) {
      segments.push({
        id: `seg_${segments.length}`,
        index: segments.length,
        text: currentSegment.text.trim(),
        type: currentSegment.type ?? 'unknown',
        speaker: currentSegment.speaker,
        sceneNumber: currentSegment.sceneNumber,
      });
    }

    return segments;
  }

  /**
   * Parse timestamped text format.
   */
  parseTimestampedText(content: string): ScriptSegment[] {
    const segments: ScriptSegment[] = [];
    const lines = content.split('\n');

    // Patterns for various timestamp formats
    const patterns = [
      // [HH:MM:SS] or [MM:SS] text
      /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.+)$/,
      // (HH:MM:SS) or (MM:SS) text
      /^\((\d{1,2}):(\d{2})(?::(\d{2}))?\)\s*(.+)$/,
      // HH:MM:SS - text or MM:SS - text
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–—]\s*(.+)$/,
      // HH:MM:SS text (no separator)
      /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/,
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;

      let matched = false;
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const h = match[3] ? parseInt(match[1]!, 10) : 0;
          const m = match[3] ? parseInt(match[2]!, 10) : parseInt(match[1]!, 10);
          const s = match[3] ? parseInt(match[3], 10) : parseInt(match[2]!, 10);
          const text = match[4]?.trim();

          if (text) {
            const startMs = (h * 3600 + m * 60 + s) * 1000;

            // Determine speaker if present (Name: text format)
            let speaker: string | undefined;
            let actualText = text;
            const speakerMatch = text.match(/^([A-Za-z]+):\s*(.+)$/);
            if (speakerMatch) {
              speaker = speakerMatch[1];
              actualText = speakerMatch[2] ?? text;
            }

            segments.push({
              id: `seg_${segments.length}`,
              index: segments.length,
              timeRange: { startMs, endMs: startMs }, // End time will be calculated later
              text: actualText,
              type: speaker ? 'dialogue' : 'narration',
              speaker,
            });
            matched = true;
            break;
          }
        }
      }

      // If no timestamp found, treat as continuation of previous segment
      if (!matched && segments.length > 0) {
        const lastSeg = segments[segments.length - 1]!;
        lastSeg.text += ' ' + line;
      } else if (!matched) {
        // First segment without timestamp
        segments.push({
          id: `seg_${segments.length}`,
          index: segments.length,
          text: line,
          type: 'narration',
        });
      }
    }

    // Calculate end times based on next segment's start time
    for (let i = 0; i < segments.length - 1; i++) {
      const current = segments[i]!;
      const next = segments[i + 1]!;
      if (current.timeRange && next.timeRange) {
        current.timeRange.endMs = next.timeRange.startMs;
      }
    }

    // Last segment: estimate duration based on text length (rough: 150 words per minute)
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1]!;
      if (lastSeg.timeRange && lastSeg.timeRange.endMs === lastSeg.timeRange.startMs) {
        const wordCount = lastSeg.text.split(/\s+/).length;
        const estimatedMs = Math.round((wordCount / 150) * 60 * 1000);
        lastSeg.timeRange.endMs = lastSeg.timeRange.startMs + Math.max(estimatedMs, 2000);
      }
    }

    return segments;
  }

  /**
   * Parse plain text (no timestamps).
   */
  parsePlainText(content: string): ScriptSegment[] {
    const segments: ScriptSegment[] = [];

    // Split by paragraphs (double newlines)
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);

    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i]?.trim();
      if (!text) continue;

      // Try to detect speaker
      let speaker: string | undefined;
      let actualText = text;
      const speakerMatch = text.match(/^([A-Za-z]+):\s*(.+)$/s);
      if (speakerMatch) {
        speaker = speakerMatch[1];
        actualText = speakerMatch[2] ?? text;
      }

      segments.push({
        id: `seg_${i}`,
        index: i,
        text: actualText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim(),
        type: speaker ? 'dialogue' : 'narration',
        speaker,
      });
    }

    return segments;
  }

  /**
   * Parse a script using the specified or auto-detected format.
   */
  parse(content: string, options: ParseOptions = {}): ScriptSegment[] {
    const format = options.forceFormat ?? this.detectFormat(content).format;

    let segments: ScriptSegment[];
    switch (format) {
      case 'srt':
        segments = this.parseSRT(content);
        break;
      case 'vtt':
        segments = this.parseVTT(content);
        break;
      case 'screenplay':
        segments = this.parseScreenplay(content);
        break;
      case 'timestamped_text':
        segments = this.parseTimestampedText(content);
        break;
      default:
        segments = this.parsePlainText(content);
    }

    // Extract keywords if requested
    if (options.extractKeywords) {
      const minLen = options.minKeywordLength ?? 4;
      for (const seg of segments) {
        seg.keywords = this.extractKeywords(seg.text, minLen);
      }
    }

    return segments;
  }

  /**
   * Align script segments to video duration.
   * Distributes untimestamped segments evenly across the video.
   */
  alignToVideo(segments: ScriptSegment[], videoDurationMs: number): AlignmentResult {
    // Separate timestamped and untimestamped segments
    const timestamped = segments.filter(s => s.timeRange);
    const untimestamped = segments.filter(s => !s.timeRange);

    if (untimestamped.length === 0) {
      return {
        segments,
        fullyTimestamped: true,
        untimestampedCount: 0,
      };
    }

    if (timestamped.length === 0) {
      // Distribute evenly
      const segmentDuration = videoDurationMs / untimestamped.length;
      for (let i = 0; i < untimestamped.length; i++) {
        untimestamped[i]!.timeRange = {
          startMs: Math.round(i * segmentDuration),
          endMs: Math.round((i + 1) * segmentDuration),
        };
      }
      return {
        segments: untimestamped,
        fullyTimestamped: false,
        untimestampedCount: untimestamped.length,
      };
    }

    // Interpolate untimestamped segments between timestamped ones
    const allSegments = [...segments];
    allSegments.sort((a, b) => a.index - b.index);

    let lastEndMs = 0;
    for (let i = 0; i < allSegments.length; i++) {
      const seg = allSegments[i]!;
      if (seg.timeRange) {
        lastEndMs = seg.timeRange.endMs;
      } else {
        // Find next timestamped segment
        let nextStartMs = videoDurationMs;
        for (let j = i + 1; j < allSegments.length; j++) {
          if (allSegments[j]!.timeRange) {
            nextStartMs = allSegments[j]!.timeRange!.startMs;
            break;
          }
        }

        // Count consecutive untimestamped segments
        let untimestampedCount = 1;
        for (let j = i + 1; j < allSegments.length && !allSegments[j]!.timeRange; j++) {
          untimestampedCount++;
        }

        // Distribute evenly in the gap
        const gapDuration = nextStartMs - lastEndMs;
        const segDuration = gapDuration / untimestampedCount;

        for (let j = 0; j < untimestampedCount && i + j < allSegments.length; j++) {
          const untSeg = allSegments[i + j]!;
          if (!untSeg.timeRange) {
            untSeg.timeRange = {
              startMs: Math.round(lastEndMs + j * segDuration),
              endMs: Math.round(lastEndMs + (j + 1) * segDuration),
            };
          }
        }

        lastEndMs = nextStartMs;
      }
    }

    return {
      segments: allSegments,
      fullyTimestamped: false,
      untimestampedCount: untimestamped.length,
    };
  }

  /**
   * Extract keywords from text.
   */
  extractKeywords(text: string, minLength: number = 4): string[] {
    // Remove punctuation and convert to lowercase
    const cleaned = text.toLowerCase().replace(/[^\w\s]/g, ' ');

    // Split into words
    const words = cleaned.split(/\s+/).filter(w => w.length >= minLength);

    // Filter out stop words and get unique
    const keywords = [...new Set(words.filter(w => !this.stopWords.has(w)))];

    return keywords.slice(0, 10); // Limit to 10 keywords per segment
  }

  /**
   * Helper: Parse timestamp components to milliseconds.
   */
  private parseTimestampToMs(h: string, m: string, s: string, ms: string): number {
    return (
      parseInt(h, 10) * 3600000 +
      parseInt(m, 10) * 60000 +
      parseInt(s, 10) * 1000 +
      parseInt(ms, 10)
    );
  }

  /**
   * Helper: Strip VTT formatting tags.
   */
  private stripVTTTags(text: string): string {
    return text
      .replace(/<[^>]+>/g, '') // Remove HTML-like tags
      .replace(/\{[^}]+\}/g, '') // Remove curly brace formatting
      .trim();
  }
}

/**
 * Create a default ScriptParser instance.
 */
export function createScriptParser(): ScriptParser {
  return new ScriptParser();
}

export default ScriptParser;

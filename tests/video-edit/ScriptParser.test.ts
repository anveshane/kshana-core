/**
 * Tests for the ScriptParser service.
 */
import { describe, it, expect } from 'vitest';
import { ScriptParser } from '../../src/services/script-parser/ScriptParser.js';

describe('ScriptParser', () => {
  const parser = new ScriptParser();

  describe('detectFormat', () => {
    it('should detect SRT format', () => {
      const srtContent = `1
00:00:01,000 --> 00:00:04,000
Hello, welcome to this video.

2
00:00:04,500 --> 00:00:08,000
Today we'll discuss something interesting.`;

      const result = parser.detectFormat(srtContent);

      expect(result.format).toBe('srt');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect VTT format', () => {
      const vttContent = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello, welcome to this video.

00:00:04.500 --> 00:00:08.000
Today we'll discuss something interesting.`;

      const result = parser.detectFormat(vttContent);

      expect(result.format).toBe('vtt');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should detect screenplay format', () => {
      const screenplayContent = `INT. OFFICE - DAY

JOHN sits at his desk, typing on his computer.

JOHN
I can't believe this is happening.

EXT. STREET - NIGHT

Cars pass by as MARY walks down the sidewalk.`;

      const result = parser.detectFormat(screenplayContent);

      expect(result.format).toBe('screenplay');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect timestamped text format', () => {
      const timestampedContent = `[00:00] Introduction
[00:30] First topic
[01:15] Second topic
[02:00] Conclusion`;

      const result = parser.detectFormat(timestampedContent);

      expect(result.format).toBe('timestamped_text');
      expect(result.confidence).toBeGreaterThan(0.7);
    });

    it('should detect plain text format', () => {
      const plainContent = `This is just regular text.
It doesn't have any special formatting.
No timestamps or scene headings.`;

      const result = parser.detectFormat(plainContent);

      expect(result.format).toBe('plain_text');
    });
  });

  describe('parseSRT', () => {
    it('should parse SRT content into segments', () => {
      const srtContent = `1
00:00:01,000 --> 00:00:04,000
First subtitle line.

2
00:00:04,500 --> 00:00:08,000
Second subtitle line.

3
00:00:08,500 --> 00:00:12,000
Third subtitle line.`;

      const segments = parser.parseSRT(srtContent);

      expect(segments).toHaveLength(3);
      expect(segments[0].text).toBe('First subtitle line.');
      expect(segments[0].timeRange?.startMs).toBe(1000);
      expect(segments[0].timeRange?.endMs).toBe(4000);
      expect(segments[1].text).toBe('Second subtitle line.');
      expect(segments[2].text).toBe('Third subtitle line.');
    });

    it('should handle multi-line subtitles', () => {
      const srtContent = `1
00:00:01,000 --> 00:00:04,000
First line
Second line of same subtitle`;

      const segments = parser.parseSRT(srtContent);

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toContain('First line');
      expect(segments[0].text).toContain('Second line');
    });
  });

  describe('parseVTT', () => {
    it('should parse VTT content into segments', () => {
      const vttContent = `WEBVTT

00:00:01.000 --> 00:00:04.000
First cue.

00:00:04.500 --> 00:00:08.000
Second cue.`;

      const segments = parser.parseVTT(vttContent);

      expect(segments).toHaveLength(2);
      expect(segments[0].text).toBe('First cue.');
      expect(segments[0].timeRange?.startMs).toBe(1000);
      expect(segments[1].text).toBe('Second cue.');
    });

    it('should handle VTT with cue identifiers', () => {
      const vttContent = `WEBVTT

cue-1
00:00:01.000 --> 00:00:04.000
First cue with identifier.`;

      const segments = parser.parseVTT(vttContent);

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('First cue with identifier.');
    });
  });

  describe('parseScreenplay', () => {
    it('should parse scene headings', () => {
      const screenplayContent = `INT. OFFICE - DAY

The room is quiet.

EXT. PARK - NIGHT

Birds are singing.`;

      const segments = parser.parseScreenplay(screenplayContent);

      // Should have scene headings and action lines
      const sceneHeadings = segments.filter(s => s.type === 'scene_heading');
      expect(sceneHeadings.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse dialogue with speaker names', () => {
      const screenplayContent = `INT. ROOM - DAY

JOHN
Hello, how are you?

MARY
I'm doing well, thanks.`;

      const segments = parser.parseScreenplay(screenplayContent);

      const dialogueSegments = segments.filter(s => s.type === 'dialogue');
      expect(dialogueSegments.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('parseTimestampedText', () => {
    it('should parse bracket timestamps', () => {
      const content = `[00:00] Introduction
[00:30] Main content
[01:00] Conclusion`;

      const segments = parser.parseTimestampedText(content);

      expect(segments).toHaveLength(3);
      expect(segments[0].text).toContain('Introduction');
      expect(segments[0].timeRange?.startMs).toBe(0);
      expect(segments[1].timeRange?.startMs).toBe(30000);
    });

    it('should parse parentheses timestamps', () => {
      const content = `(0:00) Start here
(1:30) Next section
(3:00) Final part`;

      const segments = parser.parseTimestampedText(content);

      expect(segments).toHaveLength(3);
      expect(segments[0].timeRange?.startMs).toBe(0);
      expect(segments[1].timeRange?.startMs).toBe(90000);
    });
  });

  describe('parsePlainText', () => {
    it('should split by sentences', () => {
      const content = `This is the first sentence. This is the second sentence. And here is a third one.`;

      const segments = parser.parsePlainText(content);

      expect(segments.length).toBeGreaterThanOrEqual(1);
      segments.forEach(seg => {
        expect(seg.type).toBe('unknown');
      });
    });

    it('should split by paragraphs', () => {
      const content = `First paragraph with some text.

Second paragraph here.

Third paragraph to end.`;

      const segments = parser.parsePlainText(content);

      expect(segments.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('parse (auto-detect)', () => {
    it('should auto-detect and parse SRT', () => {
      const srtContent = `1
00:00:01,000 --> 00:00:04,000
Auto-detected SRT.`;

      const segments = parser.parse(srtContent);

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('Auto-detected SRT.');
      expect(segments[0].timeRange).toBeDefined();
    });

    it('should use specified format', () => {
      const content = `Some plain text content.`;

      const segments = parser.parse(content, { format: 'plain_text' });

      expect(segments.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('alignToVideo', () => {
    it('should fill gaps in timed segments', () => {
      const segments = [
        { id: '1', index: 0, text: 'First', timeRange: { startMs: 0, endMs: 5000 }, type: 'dialogue' as const },
        { id: '2', index: 1, text: 'Second', type: 'dialogue' as const },
        { id: '3', index: 2, text: 'Third', timeRange: { startMs: 15000, endMs: 20000 }, type: 'dialogue' as const },
      ];

      const result = parser.alignToVideo(segments, 20000);

      expect(result.alignedSegments).toHaveLength(3);
      // The middle segment should have time range filled in
      expect(result.alignedSegments[1].timeRange).toBeDefined();
      expect(result.alignedSegments[1].timeRange?.startMs).toBeGreaterThanOrEqual(5000);
      expect(result.alignedSegments[1].timeRange?.endMs).toBeLessThanOrEqual(15000);
    });

    it('should distribute untimed segments', () => {
      const segments = [
        { id: '1', index: 0, text: 'First segment', type: 'dialogue' as const },
        { id: '2', index: 1, text: 'Second segment', type: 'dialogue' as const },
        { id: '3', index: 2, text: 'Third segment', type: 'dialogue' as const },
      ];

      const result = parser.alignToVideo(segments, 30000);

      expect(result.alignedSegments).toHaveLength(3);
      result.alignedSegments.forEach(seg => {
        expect(seg.timeRange).toBeDefined();
      });
    });
  });

  describe('extractKeywords', () => {
    it('should extract meaningful keywords', () => {
      const text = 'The beautiful mountain landscape with a serene lake and tall trees.';

      const keywords = parser.extractKeywords(text);

      expect(keywords.length).toBeGreaterThan(0);
      // Should include meaningful words, not stop words
      expect(keywords).toContain('mountain');
      expect(keywords).toContain('landscape');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('with');
    });

    it('should handle empty text', () => {
      const keywords = parser.extractKeywords('');

      expect(keywords).toHaveLength(0);
    });
  });
});

/**
 * Tests for the TranscriptionService.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptionService } from '../../src/services/transcription/TranscriptionService.js';

describe('TranscriptionService', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env['GOOGLE_API_KEY'];
  });

  afterEach(() => {
    // Restore original API key
    if (originalApiKey !== undefined) {
      process.env['GOOGLE_API_KEY'] = originalApiKey;
    } else {
      delete process.env['GOOGLE_API_KEY'];
    }
  });

  describe('isConfigured', () => {
    it('should return false when no API key is set', () => {
      delete process.env['GOOGLE_API_KEY'];
      const service = new TranscriptionService();
      expect(service.isConfigured()).toBe(false);
    });

    it('should return true when API key is set', () => {
      process.env['GOOGLE_API_KEY'] = 'test-api-key';
      const service = new TranscriptionService();
      expect(service.isConfigured()).toBe(true);
    });

    it('should return true when API key is passed via options', () => {
      delete process.env['GOOGLE_API_KEY'];
      const service = new TranscriptionService({ apiKey: 'custom-key' });
      expect(service.isConfigured()).toBe(true);
    });
  });

  describe('transcribe', () => {
    it('should return error when not configured', async () => {
      delete process.env['GOOGLE_API_KEY'];
      const service = new TranscriptionService();

      const result = await service.transcribe('/path/to/audio.mp3');

      expect(result.success).toBe(false);
      expect(result.error).toContain('GOOGLE_API_KEY');
    });

    it('should return error for unsupported audio format', async () => {
      process.env['GOOGLE_API_KEY'] = 'test-api-key';
      const service = new TranscriptionService();

      // Mock file read to avoid actual file system access
      const result = await service.transcribe('/path/to/audio.xyz');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported audio format');
    });
  });

  describe('parseTranscriptionResponse', () => {
    it('should handle JSON response with segments', () => {
      process.env['GOOGLE_API_KEY'] = 'test-api-key';
      const service = new TranscriptionService();

      // Access private method through the instance
      const parseMethod = (service as unknown as {
        parseTranscriptionResponse: (
          text: string,
          includeTimestamps: boolean
        ) => { success: boolean; segments?: unknown[]; text?: string };
      }).parseTranscriptionResponse.bind(service);

      const jsonResponse = JSON.stringify({
        segments: [
          { start_ms: 0, end_ms: 5000, text: 'Hello world' },
          { start_ms: 5000, end_ms: 10000, text: 'How are you' },
        ],
        full_text: 'Hello world How are you',
        language: 'en',
      });

      const result = parseMethod(jsonResponse, true);

      expect(result.success).toBe(true);
      expect(result.segments).toHaveLength(2);
      expect(result.text).toBe('Hello world How are you');
    });

    it('should handle plain text response', () => {
      process.env['GOOGLE_API_KEY'] = 'test-api-key';
      const service = new TranscriptionService();

      const parseMethod = (service as unknown as {
        parseTranscriptionResponse: (
          text: string,
          includeTimestamps: boolean
        ) => { success: boolean; segments?: unknown[]; text?: string };
      }).parseTranscriptionResponse.bind(service);

      const plainResponse = 'This is just plain text without JSON.';

      const result = parseMethod(plainResponse, false);

      expect(result.success).toBe(true);
      expect(result.text).toBe('This is just plain text without JSON.');
      expect(result.segments).toHaveLength(1);
    });
  });
});

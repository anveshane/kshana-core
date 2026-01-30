import { describe, it, expect } from 'vitest';
import { InputDetector } from '../../../src/core/inputs/InputDetector.js';

describe('InputDetector', () => {
  const detector = new InputDetector();

  describe('detect', () => {
    describe('local paths', () => {
      it('should detect absolute Unix paths', () => {
        const result = detector.detect('/path/to/video.mp4');
        expect(result.sourceType).toBe('local_path');
        expect(result.mediaType).toBe('video');
        expect(result.metadata.extension).toBe('mp4');
      });

      it('should detect home directory paths', () => {
        const result = detector.detect('~/Documents/story.txt');
        expect(result.sourceType).toBe('local_path');
        expect(result.mediaType).toBe('text');
      });

      it('should detect relative paths with ./', () => {
        const result = detector.detect('./assets/image.png');
        expect(result.sourceType).toBe('local_path');
        expect(result.mediaType).toBe('image');
      });

      it('should detect relative paths with ../', () => {
        const result = detector.detect('../audio/narration.mp3');
        expect(result.sourceType).toBe('local_path');
        expect(result.mediaType).toBe('audio');
      });
    });

    describe('remote URLs', () => {
      it('should detect HTTPS URLs', () => {
        const result = detector.detect('https://example.com/video.mp4');
        expect(result.sourceType).toBe('remote_url');
        expect(result.mediaType).toBe('video');
        expect(result.metadata.domain).toBe('example.com');
      });

      it('should detect HTTP URLs', () => {
        const result = detector.detect('http://example.com/audio.mp3');
        expect(result.sourceType).toBe('remote_url');
        expect(result.mediaType).toBe('audio');
      });

      it('should detect URLs with www prefix', () => {
        const result = detector.detect('www.example.com/image.jpg');
        expect(result.sourceType).toBe('remote_url');
        expect(result.mediaType).toBe('image');
      });

      it('should handle URLs without file extensions', () => {
        const result = detector.detect('https://api.example.com/content');
        expect(result.sourceType).toBe('remote_url');
        expect(result.mediaType).toBeNull();
        expect(result.confidence).toBeLessThan(0.9);
      });
    });

    describe('YouTube URLs', () => {
      it('should detect standard YouTube watch URLs', () => {
        const result = detector.detect('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(result.sourceType).toBe('youtube');
        expect(result.mediaType).toBe('video');
        expect(result.metadata.youtubeId).toBe('dQw4w9WgXcQ');
        expect(result.confidence).toBe(1.0);
      });

      it('should detect YouTube short URLs', () => {
        const result = detector.detect('https://youtu.be/dQw4w9WgXcQ');
        expect(result.sourceType).toBe('youtube');
        expect(result.metadata.youtubeId).toBe('dQw4w9WgXcQ');
      });

      it('should detect YouTube embed URLs', () => {
        const result = detector.detect('https://www.youtube.com/embed/dQw4w9WgXcQ');
        expect(result.sourceType).toBe('youtube');
        expect(result.metadata.youtubeId).toBe('dQw4w9WgXcQ');
      });

      it('should detect YouTube shorts URLs', () => {
        const result = detector.detect('https://www.youtube.com/shorts/dQw4w9WgXcQ');
        expect(result.sourceType).toBe('youtube');
        expect(result.metadata.youtubeId).toBe('dQw4w9WgXcQ');
      });

      it('should detect YouTube live URLs', () => {
        const result = detector.detect('https://www.youtube.com/live/dQw4w9WgXcQ');
        expect(result.sourceType).toBe('youtube');
        expect(result.metadata.youtubeId).toBe('dQw4w9WgXcQ');
      });

      it('should handle YouTube URLs without protocol', () => {
        const result = detector.detect('youtube.com/watch?v=dQw4w9WgXcQ');
        expect(result.sourceType).toBe('youtube');
        expect(result.metadata.youtubeId).toBe('dQw4w9WgXcQ');
      });

      it('should handle YouTube URLs with additional parameters', () => {
        const result = detector.detect('https://www.youtube.com/watch?t=120&v=dQw4w9WgXcQ&list=PLtest');
        expect(result.sourceType).toBe('youtube');
        expect(result.metadata.youtubeId).toBe('dQw4w9WgXcQ');
      });
    });

    describe('inline text', () => {
      it('should detect plain text as inline', () => {
        const result = detector.detect('Once upon a time in a land far away...');
        expect(result.sourceType).toBe('inline');
        expect(result.mediaType).toBe('text');
      });

      it('should detect multi-line text as inline', () => {
        const result = detector.detect('Title: My Story\n\nChapter 1\n\nOnce upon a time...');
        expect(result.sourceType).toBe('inline');
        expect(result.mediaType).toBe('text');
      });
    });
  });

  describe('isLocalPath', () => {
    it('should identify absolute paths', () => {
      expect(detector.isLocalPath('/usr/local/file.txt')).toBe(true);
      expect(detector.isLocalPath('~/file.txt')).toBe(true);
    });

    it('should identify relative paths', () => {
      expect(detector.isLocalPath('./file.txt')).toBe(true);
      expect(detector.isLocalPath('../file.txt')).toBe(true);
    });

    it('should not identify URLs as local paths', () => {
      expect(detector.isLocalPath('https://example.com/file.txt')).toBe(false);
      expect(detector.isLocalPath('http://example.com/file.txt')).toBe(false);
    });
  });

  describe('isUrl', () => {
    it('should identify HTTPS URLs', () => {
      expect(detector.isUrl('https://example.com')).toBe(true);
    });

    it('should identify HTTP URLs', () => {
      expect(detector.isUrl('http://example.com')).toBe(true);
    });

    it('should identify www URLs', () => {
      expect(detector.isUrl('www.example.com')).toBe(true);
    });

    it('should not identify local paths as URLs', () => {
      expect(detector.isUrl('/path/to/file')).toBe(false);
      expect(detector.isUrl('./file.txt')).toBe(false);
    });

    it('should not identify plain text as URLs', () => {
      expect(detector.isUrl('hello world')).toBe(false);
    });
  });

  describe('isYouTubeUrl', () => {
    it('should return true for YouTube URLs', () => {
      const result = detector.isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      expect(result.isYouTube).toBe(true);
      expect(result.videoId).toBe('dQw4w9WgXcQ');
    });

    it('should return false for non-YouTube URLs', () => {
      const result = detector.isYouTubeUrl('https://vimeo.com/123456');
      expect(result.isYouTube).toBe(false);
      expect(result.videoId).toBeUndefined();
    });
  });

  describe('detectMediaTypeFromExtension', () => {
    it('should detect text extensions', () => {
      expect(detector.detectMediaTypeFromExtension('txt')).toBe('text');
      expect(detector.detectMediaTypeFromExtension('md')).toBe('text');
      expect(detector.detectMediaTypeFromExtension('markdown')).toBe('text');
    });

    it('should detect audio extensions', () => {
      expect(detector.detectMediaTypeFromExtension('mp3')).toBe('audio');
      expect(detector.detectMediaTypeFromExtension('wav')).toBe('audio');
      expect(detector.detectMediaTypeFromExtension('m4a')).toBe('audio');
      expect(detector.detectMediaTypeFromExtension('flac')).toBe('audio');
    });

    it('should detect image extensions', () => {
      expect(detector.detectMediaTypeFromExtension('jpg')).toBe('image');
      expect(detector.detectMediaTypeFromExtension('jpeg')).toBe('image');
      expect(detector.detectMediaTypeFromExtension('png')).toBe('image');
      expect(detector.detectMediaTypeFromExtension('gif')).toBe('image');
      expect(detector.detectMediaTypeFromExtension('webp')).toBe('image');
    });

    it('should detect video extensions', () => {
      expect(detector.detectMediaTypeFromExtension('mp4')).toBe('video');
      expect(detector.detectMediaTypeFromExtension('mov')).toBe('video');
      expect(detector.detectMediaTypeFromExtension('webm')).toBe('video');
      expect(detector.detectMediaTypeFromExtension('mkv')).toBe('video');
    });

    it('should return null for unknown extensions', () => {
      expect(detector.detectMediaTypeFromExtension('xyz')).toBeNull();
      expect(detector.detectMediaTypeFromExtension('')).toBeNull();
    });

    it('should handle extensions with leading dots', () => {
      expect(detector.detectMediaTypeFromExtension('.mp4')).toBe('video');
    });

    it('should be case-insensitive', () => {
      expect(detector.detectMediaTypeFromExtension('MP4')).toBe('video');
      expect(detector.detectMediaTypeFromExtension('JPG')).toBe('image');
    });
  });

  describe('detectMediaTypeFromMime', () => {
    it('should detect text MIME types', () => {
      expect(detector.detectMediaTypeFromMime('text/plain')).toBe('text');
      expect(detector.detectMediaTypeFromMime('text/markdown')).toBe('text');
    });

    it('should detect audio MIME types', () => {
      expect(detector.detectMediaTypeFromMime('audio/mpeg')).toBe('audio');
      expect(detector.detectMediaTypeFromMime('audio/wav')).toBe('audio');
    });

    it('should detect image MIME types', () => {
      expect(detector.detectMediaTypeFromMime('image/jpeg')).toBe('image');
      expect(detector.detectMediaTypeFromMime('image/png')).toBe('image');
    });

    it('should detect video MIME types', () => {
      expect(detector.detectMediaTypeFromMime('video/mp4')).toBe('video');
      expect(detector.detectMediaTypeFromMime('video/webm')).toBe('video');
    });

    it('should return null for unknown MIME types', () => {
      expect(detector.detectMediaTypeFromMime('application/octet-stream')).toBeNull();
    });
  });

  describe('getSupportedExtensions', () => {
    it('should return text extensions', () => {
      const extensions = detector.getSupportedExtensions('text');
      expect(extensions).toContain('txt');
      expect(extensions).toContain('md');
    });

    it('should return audio extensions', () => {
      const extensions = detector.getSupportedExtensions('audio');
      expect(extensions).toContain('mp3');
      expect(extensions).toContain('wav');
    });

    it('should return image extensions', () => {
      const extensions = detector.getSupportedExtensions('image');
      expect(extensions).toContain('jpg');
      expect(extensions).toContain('png');
    });

    it('should return video extensions', () => {
      const extensions = detector.getSupportedExtensions('video');
      expect(extensions).toContain('mp4');
      expect(extensions).toContain('mov');
    });
  });
});

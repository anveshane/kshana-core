import { describe, it, expect } from 'vitest';
import { InputClassifier } from '../../../src/core/inputs/InputClassifier.js';

describe('InputClassifier', () => {
  const classifier = new InputClassifier();

  describe('getValidPurposes', () => {
    it('should return valid purposes for text', () => {
      const purposes = classifier.getValidPurposes('text');
      expect(purposes).toContain('narration');
      expect(purposes).toContain('reference_general');
      expect(purposes).not.toContain('style_ref');
    });

    it('should return valid purposes for audio', () => {
      const purposes = classifier.getValidPurposes('audio');
      expect(purposes).toContain('narration');
      expect(purposes).toContain('background_music');
      expect(purposes).not.toContain('style_ref');
    });

    it('should return valid purposes for image', () => {
      const purposes = classifier.getValidPurposes('image');
      expect(purposes).toContain('style_ref');
      expect(purposes).toContain('character_ref');
      expect(purposes).toContain('setting_ref');
      expect(purposes).not.toContain('narration');
    });

    it('should return valid purposes for video', () => {
      const purposes = classifier.getValidPurposes('video');
      expect(purposes).toContain('anchor_video');
      expect(purposes).toContain('style_ref');
      expect(purposes).toContain('motion_ref');
    });
  });

  describe('getPurposeDescription', () => {
    it('should return description for narration', () => {
      const desc = classifier.getPurposeDescription('narration');
      expect(desc.label).toBe('Narration/Story');
      expect(desc.description).toContain('story');
    });

    it('should return description for style_ref', () => {
      const desc = classifier.getPurposeDescription('style_ref');
      expect(desc.label).toBe('Style Reference');
    });

    it('should return description for anchor_video', () => {
      const desc = classifier.getPurposeDescription('anchor_video');
      expect(desc.label).toBe('Anchor Video');
    });
  });

  describe('labelToPurpose', () => {
    it('should map label to purpose', () => {
      expect(classifier.labelToPurpose('Narration/Story')).toBe('narration');
      expect(classifier.labelToPurpose('Style Reference')).toBe('style_ref');
      expect(classifier.labelToPurpose('Character Reference')).toBe('character_ref');
    });

    it('should handle recommended suffix', () => {
      expect(classifier.labelToPurpose('Narration/Story (Recommended)')).toBe('narration');
      expect(classifier.labelToPurpose('Style Reference (Recommended)')).toBe('style_ref');
    });

    it('should return null for unknown labels', () => {
      expect(classifier.labelToPurpose('Unknown Label')).toBeNull();
    });
  });

  describe('buildPurposeQuestion', () => {
    it('should build question for text input', () => {
      const result = classifier.buildPurposeQuestion('text', [
        { purpose: 'narration', reason: 'Detected as script' },
      ]);

      expect(result.questions).toHaveLength(1);
      expect(result.questions[0]?.question).toContain('text');
      expect(result.questions[0]?.header).toBe('Input Purpose');
      expect(result.questions[0]?.options.length).toBeGreaterThan(0);
      expect(result.questions[0]?.options.length).toBeLessThanOrEqual(4);
    });

    it('should build question for audio input', () => {
      const result = classifier.buildPurposeQuestion('audio', [
        { purpose: 'narration', reason: '' },
      ]);

      expect(result.questions[0]?.question).toContain('audio');
    });

    it('should put suggestions first in options', () => {
      const result = classifier.buildPurposeQuestion('video', [
        { purpose: 'motion_ref', reason: 'Motion detected' },
      ]);

      // First option should be the suggested one with (Recommended)
      expect(result.questions[0]?.options[0]?.label).toContain('Motion Reference');
    });

    it('should include Recommended in first option label', () => {
      const result = classifier.buildPurposeQuestion('image', [
        { purpose: 'style_ref', reason: 'Art style' },
      ]);

      expect(result.questions[0]?.options[0]?.label).toContain('(Recommended)');
    });
  });

  describe('heuristic classification', () => {
    it('should detect narration from filename', async () => {
      const result = await classifier.classifyPurpose({
        mediaType: 'audio',
        filename: 'narration_take1.mp3',
      });

      expect(result.suggestedPurpose).toBe('narration');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect style reference from filename', async () => {
      const result = await classifier.classifyPurpose({
        mediaType: 'image',
        filename: 'style_reference.jpg',
      });

      expect(result.suggestedPurpose).toBe('style_ref');
    });

    it('should detect character reference from filename', async () => {
      const result = await classifier.classifyPurpose({
        mediaType: 'image',
        filename: 'main_character.png',
      });

      expect(result.suggestedPurpose).toBe('character_ref');
    });

    it('should detect background music from filename', async () => {
      const result = await classifier.classifyPurpose({
        mediaType: 'audio',
        filename: 'background_music.mp3',
      });

      expect(result.suggestedPurpose).toBe('background_music');
    });

    it('should detect anchor video from filename', async () => {
      const result = await classifier.classifyPurpose({
        mediaType: 'video',
        filename: 'anchor_speaker.mp4',
      });

      expect(result.suggestedPurpose).toBe('anchor_video');
    });

    it('should use default purpose when no keywords match', async () => {
      const result = await classifier.classifyPurpose({
        mediaType: 'image',
        filename: 'random_file_123.jpg',
      });

      // Default for image is style_ref
      expect(result.suggestedPurpose).toBe('style_ref');
      expect(result.confidence).toBe(0.5);
    });

    it('should provide alternatives', async () => {
      const result = await classifier.classifyPurpose({
        mediaType: 'video',
        filename: 'video.mp4',
      });

      expect(result.alternatives).toBeDefined();
      expect(result.alternatives.length).toBeGreaterThan(0);
    });
  });
});

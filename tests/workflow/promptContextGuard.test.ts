import { describe, expect, it } from 'vitest';
import {
  appendMetadataConstraintsToNegativePrompt,
  applyPromptContextGuard,
} from '../../src/tasks/video/workflow/promptContextGuard.js';
import type { VideoMetadata } from '../../src/tasks/video/workflow/videoMetadataParser.js';

const historicalMetadata: VideoMetadata = {
  subjectMatter: 'Industrial Revolution',
  timePeriod: '1850-1860',
  geographicContext: 'Victorian England',
  visualStyle: 'Historical documentary',
  anachronismsToAvoid: ['plastic', 'smartphones'],
  visualConsistencyRequirements: ['period clothing', 'horse-drawn transport'],
};

describe('promptContextGuard', () => {
  it('passes prompt when no violation exists', () => {
    const result = applyPromptContextGuard({
      prompt: 'Period-accurate market street with horse carts and brick roads.',
      mediaType: 'image',
      metadata: historicalMetadata,
      placementPrompt: 'market street',
      transcriptSegment: 'The city market was busy in 1850.',
    });

    expect(result.usedFallback).toBe(false);
    expect(result.rewritten).toBe(false);
  });

  it('falls back when prompt contains anachronistic terms', () => {
    const result = applyPromptContextGuard({
      prompt: 'Victorian street with plastic bags and modern cars.',
      mediaType: 'video',
      metadata: historicalMetadata,
      placementPrompt: 'street activity',
      transcriptSegment: 'Workers move goods through the city.',
    });

    expect(result.rewritten).toBe(true);
    expect(result.usedFallback).toBe(true);
    expect(result.prompt.toLowerCase()).not.toContain('plastic');
    expect(result.prompt.toLowerCase()).toContain('live-action');
  });

  it('appends metadata constraints to image negative prompts', () => {
    const merged = appendMetadataConstraintsToNegativePrompt(
      'blurry, text, watermark',
      historicalMetadata,
    );
    expect(merged).toContain('anachronistic artifacts');
    expect(merged).toContain('plastic');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateLLMConfig: vi.fn(),
  getLLMConfig: vi.fn(),
  generate: vi.fn(),
  loadAndRenderMarkdown: vi.fn(),
}));

vi.mock('../../src/core/llm/index.js', () => {
  class MockLLMClient {
    async generate(payload: unknown): Promise<unknown> {
      return mocks.generate(payload);
    }
  }

  return {
    LLMClient: MockLLMClient,
    getLLMConfig: mocks.getLLMConfig,
    validateLLMConfig: mocks.validateLLMConfig,
  };
});

vi.mock('../../src/core/prompts/loader.js', () => ({
  loadAndRenderMarkdown: mocks.loadAndRenderMarkdown,
}));

import {
  expandImagePlacementPrompt,
  expandVideoPlacementPrompt,
} from '../../src/tasks/video/workflow/placementPromptExpander.js';

describe('placementPromptExpander metadata injection', () => {
  beforeEach(() => {
    mocks.validateLLMConfig.mockReset();
    mocks.getLLMConfig.mockReset();
    mocks.generate.mockReset();
    mocks.loadAndRenderMarkdown.mockReset();

    mocks.validateLLMConfig.mockReturnValue({ valid: true, errors: [] });
    mocks.getLLMConfig.mockReturnValue({ provider: 'openai' });
    mocks.loadAndRenderMarkdown.mockReturnValue('rendered prompt');
  });

  it('passes video metadata into image prompt template variables', async () => {
    mocks.generate.mockResolvedValue({
      content: 'Expanded image prompt.\n---NEGATIVE---\nblurry, text',
    });

    const result = await expandImagePlacementPrompt(
      {
        placementNumber: 1,
        startTime: '0:10',
        endTime: '0:14',
        prompt: 'old city street',
      },
      {
        transcriptSegment: 'In 1850 the market was crowded.',
        contentPlan: 'Use documentary-style visuals.',
        videoMetadata: {
          subjectMatter: 'Industrial city life',
          timePeriod: '1850-1860',
          geographicContext: 'Victorian England',
          visualStyle: 'Historical documentary',
          anachronismsToAvoid: ['plastic', 'modern cars'],
          visualConsistencyRequirements: ['period clothing'],
        },
      },
    );

    expect(result).toEqual({
      prompt: 'Expanded image prompt.',
      negativePrompt: 'blurry, text',
    });

    expect(mocks.loadAndRenderMarkdown).toHaveBeenCalledWith(
      'placement/expand-image-prompt.md',
      expect.objectContaining({
        video_metadata_available: true,
        video_time_period: '1850-1860',
        video_anachronisms_to_avoid: 'plastic, modern cars',
      }),
    );
  });

  it('passes video metadata into video prompt template variables', async () => {
    mocks.generate.mockResolvedValue({
      content: 'Expanded live-action documentary prompt.',
    });

    const result = await expandVideoPlacementPrompt(
      {
        placementNumber: 2,
        startTime: '0:20',
        endTime: '0:28',
        prompt: 'workers in street',
        duration: 8,
        videoType: 'cinematic_realism',
      },
      {
        transcriptSegment: 'Workers unload goods in the city.',
        contentPlan: 'Focus on historical reconstruction.',
        videoMetadata: {
          subjectMatter: 'Industrial economy',
          timePeriod: '1850-1860',
          geographicContext: 'Victorian England',
          visualStyle: 'Historical documentary',
          anachronismsToAvoid: ['smartphones'],
          visualConsistencyRequirements: ['brick streets'],
        },
      },
    );

    expect(result).toBe('Expanded live-action documentary prompt.');
    expect(mocks.loadAndRenderMarkdown).toHaveBeenCalledWith(
      'placement/expand-video-prompt.md',
      expect.objectContaining({
        video_metadata_available: true,
        video_subject_matter: 'Industrial economy',
        video_anachronisms_to_avoid: 'smartphones',
      }),
    );
  });
});

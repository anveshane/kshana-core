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

import { expandInfographicPlacementPrompt } from '../../src/tasks/video/workflow/infographicPromptExpander.js';
import type { ParsedInfographicPlacement } from '../../src/tasks/video/workflow/infographicPlacementsParser.js';

describe('infographicPromptExpander', () => {
  const placement: ParsedInfographicPlacement = {
    placementNumber: 1,
    startTime: '0:10',
    endTime: '0:18',
    infographicType: 'statistic',
    prompt: 'Show the 48% conversion lift',
  };

  beforeEach(() => {
    mocks.validateLLMConfig.mockReset();
    mocks.getLLMConfig.mockReset();
    mocks.generate.mockReset();
    mocks.loadAndRenderMarkdown.mockReset();

    mocks.loadAndRenderMarkdown.mockReturnValue('expanded prompt request');
    mocks.validateLLMConfig.mockReturnValue({ valid: true, errors: [] });
    mocks.getLLMConfig.mockReturnValue({ provider: 'openai' });
  });

  it('returns expanded prompt and optional data block when LLM succeeds', async () => {
    mocks.generate.mockResolvedValue({
      content:
        'Create a statistic card with count-up animation.\n---DATA---\n{"headline":"48%","subtext":"conversion lift"}',
    });

    const result = await expandInfographicPlacementPrompt(placement, {
      transcriptSegment: 'Users converted faster after CTA update.',
      contentPlan: 'Focus on outcome, then confidence interval.',
    });

    expect(result).toEqual({
      prompt: 'Create a statistic card with count-up animation.',
      data: { headline: '48%', subtext: 'conversion lift' },
    });
  });

  it('falls back with error object when expansion fails', async () => {
    mocks.generate.mockRejectedValue(new Error('Connection error'));

    const result = await expandInfographicPlacementPrompt(placement, {
      transcriptSegment: 'Fallback transcript.',
      contentPlan: '',
    });

    expect(result).toEqual({ error: 'Connection error' });
  });
});

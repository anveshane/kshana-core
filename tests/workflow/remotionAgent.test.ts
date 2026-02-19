/**
 * Tests for runRemotionAgent with mock LLM.
 * Validates Remotion-agent flow: placements + skills in, LLM returns JSON, parse and validate.
 */
import { describe, it, expect } from 'vitest';
import { runRemotionAgent } from '../../src/tasks/video/remotionAgent.js';
import type { ParsedInfographicPlacement } from '../../src/tasks/video/workflow/infographicPlacementsParser.js';
import { MockLLMClient } from '../integration/MockLLMClient.js';

const SAMPLE_PLACEMENTS: ParsedInfographicPlacement[] = [
  {
    placementNumber: 1,
    startTime: '0:25',
    endTime: '0:35',
    infographicType: 'statistic',
    prompt: 'Test statistic.',
  },
];

const VALID_COMPONENT_CODE_JSON = JSON.stringify({
  placements: [
    {
      placementNumber: 1,
      componentCode:
        "import React from 'react';\nimport { AbsoluteFill } from 'remotion';\n\nexport const Infographic1 = () => <AbsoluteFill />;",
    },
  ],
});

describe('runRemotionAgent', () => {
  it('returns parsed ComponentCode when mock LLM returns valid JSON', async () => {
    const mockLLM = new MockLLMClient();
    mockLLM.setDefaultResponse({ content: VALID_COMPONENT_CODE_JSON });

    const result = await runRemotionAgent(mockLLM as any, SAMPLE_PLACEMENTS, {
      skillsContent: 'fake skills',
    });

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]).toMatchObject({
      placementNumber: 1,
      componentCode: expect.stringContaining('Infographic1'),
    });
  });

  it('parses result when mock LLM returns JSON wrapped in ```json fence', async () => {
    const fenced = '```json\n' + VALID_COMPONENT_CODE_JSON + '\n```';
    const mockLLM = new MockLLMClient();
    mockLLM.setDefaultResponse({ content: fenced });

    const result = await runRemotionAgent(mockLLM as any, SAMPLE_PLACEMENTS, {
      skillsContent: 'fake skills',
    });

    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]!.placementNumber).toBe(1);
    expect(result.placements[0]!.componentCode).toContain('Infographic1');
  });

  it('throws when mock LLM returns invalid JSON', async () => {
    const mockLLM = new MockLLMClient();
    mockLLM.setDefaultResponse({ content: 'not json' });

    await expect(
      runRemotionAgent(mockLLM as any, SAMPLE_PLACEMENTS, { skillsContent: 'fake' })
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws when mock LLM returns object without placements array', async () => {
    const mockLLM = new MockLLMClient();
    mockLLM.setDefaultResponse({ content: '{"foo": 1}' });

    await expect(
      runRemotionAgent(mockLLM as any, SAMPLE_PLACEMENTS, { skillsContent: 'fake' })
    ).rejects.toThrow(/must have a "placements" array/);
  });

  it('throws when mock LLM returns empty content', async () => {
    const mockLLM = new MockLLMClient();
    mockLLM.setDefaultResponse({ content: '' });

    await expect(
      runRemotionAgent(mockLLM as any, SAMPLE_PLACEMENTS, { skillsContent: 'fake' })
    ).rejects.toThrow(/empty response/);
  });
});

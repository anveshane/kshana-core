import { describe, expect, it, vi } from 'vitest';

import { GenericAgent } from '../../src/core/agent/GenericAgent.js';

describe('dispatch_content_agent content type validation', () => {
  it('accepts image prompt content types', async () => {
    const agent = new GenericAgent([], {} as never, {
      maxIterations: 1,
      name: 'Test Agent',
    });
    const runSubAgent = vi.fn().mockResolvedValue({
      status: 'completed',
      output: 'ok',
    });
    (
      agent as unknown as { runSubAgent: typeof runSubAgent }
    ).runSubAgent = runSubAgent;

    const result = await (
      agent as unknown as {
        handleDispatchContentAgent: (toolCall: {
          arguments: Record<string, unknown>;
        }) => Promise<unknown>;
      }
    ).handleDispatchContentAgent({
      arguments: {
        task: 'Create Arthur reference prompt',
        content_type: 'character_image_prompt',
        output_file: 'prompts/images/characters/arthur.prompt.md',
      },
    });

    expect(result).toMatchObject({
      status: 'completed',
      file_saved: true,
      content_type: 'character_image_prompt',
      output_file: 'prompts/images/characters/arthur.prompt.md',
    });
    expect(runSubAgent).toHaveBeenCalledOnce();
  });

  it('rejects unsupported content types with the updated validator', async () => {
    const agent = new GenericAgent([], {} as never, {
      maxIterations: 1,
      name: 'Test Agent',
    });

    const result = await (
      agent as unknown as {
        handleDispatchContentAgent: (toolCall: {
          arguments: Record<string, unknown>;
        }) => Promise<{ error: string }>;
      }
    ).handleDispatchContentAgent({
      arguments: {
        task: 'Create unsupported content',
        content_type: 'unsupported_type',
      },
    });

    expect(result).toMatchObject({
      error: expect.stringContaining('Invalid content_type "unsupported_type"'),
    });
  });
});

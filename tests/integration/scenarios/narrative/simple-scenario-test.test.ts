/**
 * Simple scenario test following existing test patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GenericAgent } from '../../../../src/core/agent/GenericAgent.js';
import { createDefaultToolRegistry } from '../../../../src/core/tools/index.js';
import { MockLLMClient } from '../../../integration/MockLLMClient.js';

const CONTEXT_DIR = join(process.cwd(), '.kshana');

function cleanContextState() {
  if (existsSync(CONTEXT_DIR)) {
    rmSync(CONTEXT_DIR, { recursive: true, force: true });
  }
}

describe('Simple Narrative Scenario', { sequential: true }, () => {
  let mockLLM: MockLLMClient;

  beforeEach(() => {
    cleanContextState();
    mockLLM = new MockLLMClient();
  });

  afterEach(() => {
    cleanContextState();
  });

  it('should handle plot input scenario', async () => {
    // Set up mock responses
    mockLLM.expect({
      match: () => true,
      response: {
        content: 'I will create a plot outline.',
        toolCalls: [{
          id: 'call_0',
          name: 'dispatch_agent',
          arguments: {
            task: 'create plot outline',
            context_refs: ['$original_input'],
          },
        }],
      },
    });

    // Create agent
    const toolRegistry = createDefaultToolRegistry();
    const tools = toolRegistry.getAll();
    const agent = new GenericAgent(tools, mockLLM, {
      name: 'test-agent',
      isSubAgent: false,
    });

    await agent.initialize();

    // Run agent with input
    const result = await agent.run('Jan is a blacksmith who fights a shadow demon.');

    // Verify result
    expect(result).toBeDefined();

    // Verify mock LLM was called
    const calls = mockLLM.getCallHistory();
    expect(calls.length).toBeGreaterThan(0);
  }, 10000);
});

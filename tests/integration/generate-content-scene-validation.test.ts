import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

import { GenericAgent } from '../../src/core/agent/GenericAgent.js';
import { createDefaultToolRegistry } from '../../src/core/tools/index.js';
import {
  createProject,
  getProjectDir,
} from '../../src/tasks/video/workflow/index.js';
import type { GenerateOptions, LLMResponse, Message, StreamChunk } from '../../src/core/llm/types.js';

const TEST_BASE_PATH = join(process.cwd(), 'test-temp-generate-content-scene-validation');
const ORIGINAL_CWD = process.cwd();

function createQueuedMockLLM(responses: LLMResponse[]) {
  const queue = [...responses];
  return {
    async getContextLength(): Promise<number> {
      return 16000;
    },
    async generate(_options: GenerateOptions): Promise<LLMResponse> {
      return (
        queue.shift() || {
          content: null,
          toolCalls: [],
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }
      );
    },
    async *generateStream(
      options: Omit<GenerateOptions, 'stream'>
    ): AsyncGenerator<StreamChunk, void, unknown> {
      const response = await this.generate(options as GenerateOptions);
      if (response.content) {
        yield { content: response.content, done: false };
      }
      yield { done: true };
    },
  };
}

function createAgentWithResponses(responses: LLMResponse[]) {
  const tools = createDefaultToolRegistry().getAll();
  return new GenericAgent(tools, createQueuedMockLLM(responses) as any, {
    name: 'test-agent',
    isSubAgent: false,
  });
}

describe('generate_content scene validation', () => {
  beforeEach(() => {
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
    mkdirSync(TEST_BASE_PATH, { recursive: true });
    process.chdir(TEST_BASE_PATH);
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    if (existsSync(TEST_BASE_PATH)) {
      rmSync(TEST_BASE_PATH, { recursive: true, force: true });
    }
  });

  it('rejects invalid scene chatter without saving the scene file', async () => {
    createProject('A descent into the underworld', TEST_BASE_PATH);
    const agent = createAgentWithResponses([
      {
        content:
          'I need to check for reference image paths before generating the scene content.\n\nread_project()',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      },
    ]);
    await agent.initialize();

    const result = await (agent as any).executeTool({
      id: 'tool_1',
      name: 'generate_content',
      arguments: {
        content_type: 'scene',
        instruction: 'Create Scene 2: The Encounter',
        scene_number: 2,
      },
    });

    const projectDir = getProjectDir(TEST_BASE_PATH);
    expect(result).toMatchObject({
      status: 'validation_failed',
      content_type: 'scene',
    });
    expect(existsSync(join(projectDir, 'plans', 'scenes', 'scene-2.md'))).toBe(false);
  });

});

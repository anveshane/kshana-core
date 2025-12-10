/**
 * Integration tests for Content Agent behavior.
 * Tests the full content creation flow with mocked LLM to verify context injection,
 * system prompts, and response handling.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GenericAgent } from '../../src/core/agent/GenericAgent.js';
import { contextStore } from '../../src/core/context/index.js';
import { createDefaultToolRegistry } from '../../src/core/tools/index.js';
import type { Message, LLMResponse, StreamChunk, GenerateOptions } from '../../src/core/llm/types.js';

const CONTEXT_DIR = join(process.cwd(), '.kshana', 'context');

function cleanContextState() {
  if (existsSync(CONTEXT_DIR)) {
    rmSync(CONTEXT_DIR, { recursive: true, force: true });
  }
}

/**
 * Create a mock LLM that captures the messages sent to it.
 */
function createCapturingMockLLM() {
  const capturedCalls: { messages: Message[]; options: Partial<GenerateOptions> }[] = [];
  let responseQueue: LLMResponse[] = [];
  let defaultResponse: LLMResponse = {
    content: 'Default response',
    toolCalls: [],
    finishReason: 'stop',
  };

  const mockLLM = {
    capturedCalls,

    setResponses(responses: LLMResponse[]) {
      responseQueue = [...responses];
    },

    setDefaultResponse(response: LLMResponse) {
      defaultResponse = response;
    },

    async generate(options: GenerateOptions): Promise<LLMResponse> {
      capturedCalls.push({ messages: [...options.messages], options });

      const response = responseQueue.shift();
      if (response) {
        return response;
      }

      return defaultResponse;
    },

    async *generateStream(options: Omit<GenerateOptions, 'stream'>): AsyncGenerator<StreamChunk, void, unknown> {
      const response = await this.generate(options as GenerateOptions);

      if (response.content) {
        yield { content: response.content, done: false };
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        for (let i = 0; i < response.toolCalls.length; i++) {
          const tc = response.toolCalls[i]!;
          yield {
            toolCallDelta: {
              index: i,
              id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
            done: false,
          };
        }
      }

      yield { done: true };
    },

    reset() {
      capturedCalls.length = 0;
      responseQueue = [];
    },
  };

  return mockLLM;
}

describe('Content Agent Behavior', { sequential: true }, () => {
  let mockLLM: ReturnType<typeof createCapturingMockLLM>;
  let agent: GenericAgent;

  beforeAll(() => {
    cleanContextState();
  });

  beforeEach(() => {
    cleanContextState();
    // Clear and reinitialize the global context store
    contextStore.clear();
    mockLLM = createCapturingMockLLM();

    const registry = createDefaultToolRegistry();
    agent = new GenericAgent(registry.getAll(), mockLLM as any, {
      maxIterations: 5,
      name: 'test-content-agent',
    });
  });

  afterEach(() => {
    contextStore.clear();
    mockLLM.reset();
  });

  describe('Context injection into content prompt', () => {
    it('should inject context into character creation prompt', async () => {
      // Store plot context with character details using global contextStore
      const { variableName } = contextStore.store(
        `# Plot Outline

Protagonist: Jan
- Age: 25
- Occupation: Blacksmith
- Appearance: Dark eyes, calloused hands, faded blue shirt
- Motivation: Save his village from the shadow demon

Setting: Mountain village threatened by Kombumanye`,
        'Plot',
        { variableBaseName: 'plot' }
      );

      mockLLM.setResponses([
        // Main agent calls dispatch_content_agent
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create a detailed character profile for Jan the protagonist',
              content_type: 'character',
              context_refs: [variableName],
            },
          }],
          finishReason: 'tool_calls',
        },
        // Content agent generates character
        {
          content: `# Jan - The Village Blacksmith

## Basic Information
- **Name:** Jan
- **Age:** 25
- **Occupation:** Blacksmith

## Physical Description
Jan is a young man with dark eyes that reflect the glow of his forge.`,
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Create the main character');

      // Check that the agent is waiting for content verification
      expect(result.status).toBe('waiting_for_user');

      // Find the content agent call (second call, after main agent)
      expect(mockLLM.capturedCalls.length).toBeGreaterThanOrEqual(2);

      const contentCall = mockLLM.capturedCalls[1];
      const systemMsg = contentCall.messages.find(m => m.role === 'system');

      // Verify context is injected with all character details
      expect(systemMsg!.content).toContain('Jan');
      expect(systemMsg!.content).toContain('Age: 25');
      expect(systemMsg!.content).toContain('Blacksmith');
      expect(systemMsg!.content).toContain('Dark eyes');
      expect(systemMsg!.content).toContain('calloused hands');
      expect(systemMsg!.content).toContain('faded blue shirt');
      expect(systemMsg!.content).toContain('Kombumanye');

      // Verify content type is specified
      expect(systemMsg!.content).toContain('character');
    });

    it('should inject multiple contexts for story creation', async () => {
      // Store plot using global contextStore
      const { variableName: plotVar } = contextStore.store(
        'Jan (25, blacksmith) must save village from Kombumanye the shadow demon.',
        'Plot',
        { variableBaseName: 'plot' }
      );

      // Store character
      const { variableName: charVar } = contextStore.store(
        'Jan has dark eyes, calloused hands, wears a faded blue shirt. His brother Kosi (8) watches from the doorway.',
        'Character',
        { variableBaseName: 'character' }
      );

      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Write the opening scene of the story',
              content_type: 'story',
              context_refs: [plotVar, charVar],
            },
          }],
          finishReason: 'tool_calls',
        },
        {
          content: `# Chapter 1: The Forge

Jan wiped sweat from his brow with calloused hands...`,
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Write the opening');
      expect(result.status).toBe('waiting_for_user');

      const contentCall = mockLLM.capturedCalls[1];
      const systemMsg = contentCall.messages.find(m => m.role === 'system');

      // Verify ALL context details are present
      expect(systemMsg!.content).toContain('blacksmith');
      expect(systemMsg!.content).toContain('Kombumanye');
      expect(systemMsg!.content).toContain('dark eyes');
      expect(systemMsg!.content).toContain('calloused hands');
      expect(systemMsg!.content).toContain('faded blue shirt');
      expect(systemMsg!.content).toContain('Kosi');
      expect(systemMsg!.content).toContain('---'); // Separator between contexts
    });

    it('should preserve character consistency through workflow', async () => {
      // Simulate full workflow: user input -> plot -> story -> character
      const { variableName: inputVar } = contextStore.store(
        'Create a story about Jan, a 25-year-old blacksmith with dark eyes and calloused hands, saving his village.',
        'User Input',
        { variableBaseName: 'input' }
      );

      const { variableName: plotVar } = contextStore.store(
        `Based on user input:
- Protagonist: Jan, 25, blacksmith, dark eyes, calloused hands
- Setting: Mountain village
- Conflict: Shadow demon Kombumanye
- Supporting: Kosi (Jan's 8-year-old brother)`,
        'Plot',
        { variableBaseName: 'plot' }
      );

      const { variableName: storyVar } = contextStore.store(
        `Jan wiped sweat from his brow with calloused hands.
At 25, he was the only blacksmith since his father died.
His dark eyes reflected the forge's glow.
Kosi, just 8, watched from the doorway.`,
        'Story',
        { variableBaseName: 'story' }
      );

      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create detailed character profile for Jan',
              content_type: 'character',
              context_refs: [inputVar, plotVar, storyVar],
            },
          }],
          finishReason: 'tool_calls',
        },
        {
          content: '# Jan - Character Profile\n\nConsistent character...',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Create character profile');
      expect(result.status).toBe('waiting_for_user');

      const contentCall = mockLLM.capturedCalls[1];
      const systemMsg = contentCall.messages.find(m => m.role === 'system');

      // Count mentions to verify consistency
      const content = systemMsg!.content!;
      const janMentions = (content.match(/Jan/g) || []).length;
      expect(janMentions).toBeGreaterThanOrEqual(3); // Should appear in all contexts

      const ageMentions = (content.match(/25/g) || []).length;
      expect(ageMentions).toBeGreaterThanOrEqual(2); // Age should be consistent

      const blacksmithMentions = (content.match(/blacksmith/gi) || []).length;
      expect(blacksmithMentions).toBeGreaterThanOrEqual(2);

      // Visual details should be preserved
      expect(content).toContain('dark eyes');
      expect(content).toContain('calloused hands');
    });
  });

  describe('Content response handling', () => {
    it('should return waiting_for_user status after content generation', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Write a scene',
              content_type: 'scene',
            },
          }],
          finishReason: 'tool_calls',
        },
        {
          content: '# Opening Scene\n\nThe sun rose over the mountains...',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Write a scene');

      expect(result.status).toBe('waiting_for_user');
      expect(result.pendingQuestion).toBeDefined();
      expect(result.options).toBeDefined();
      expect(result.options?.length).toBe(2);
    });

    it('should handle content approval correctly', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create a character',
              content_type: 'character',
              output_file: 'characters/jan.md',
            },
          }],
          finishReason: 'tool_calls',
        },
        {
          content: '# Jan - Character Profile\n\nJan is a 25-year-old blacksmith...',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Classification: APPROVE - the classifier should return "APPROVE" not "yes"
        {
          content: 'APPROVE',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Main agent continues after approval
        {
          content: 'Character profile created and saved.',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      // Run until waiting_for_user
      const result1 = await agent.run('Create character');
      expect(result1.status).toBe('waiting_for_user');

      // Approve the content
      const result2 = await agent.run('Create character', 'looks great, approved');
      expect(['completed', 'waiting_for_user']).toContain(result2.status);
    });

    it('should handle content feedback and revision', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Write a story scene',
              content_type: 'story',
            },
          }],
          finishReason: 'tool_calls',
        },
        // First version
        {
          content: '# First Draft\n\nBasic content here.',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Classification: FEEDBACK - the classifier should return "FEEDBACK" not "no"
        {
          content: 'FEEDBACK',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Revised version
        {
          content: '# Revised Draft\n\nMore detailed and improved content.',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      // Run until first waiting_for_user
      const result1 = await agent.run('Write story');
      expect(result1.status).toBe('waiting_for_user');

      // Provide feedback
      const result2 = await agent.run('Write story', 'Make it more detailed and add more description');
      expect(result2.status).toBe('waiting_for_user');
    });

    it('should include feedback in revision request messages', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create a setting',
              content_type: 'setting',
            },
          }],
          finishReason: 'tool_calls',
        },
        { content: '# Setting V1', toolCalls: [], finishReason: 'stop' },
        { content: 'FEEDBACK', toolCalls: [], finishReason: 'stop' }, // Not approval
        { content: '# Setting V2 with more mountains', toolCalls: [], finishReason: 'stop' },
      ]);

      // Get first version
      await agent.run('Create setting');

      // Provide specific feedback
      await agent.run('Create setting', 'Add more detail about the mountains');

      // Check that the feedback was included in the revision request
      // The last call to the content agent should include the feedback
      const revisionCall = mockLLM.capturedCalls[mockLLM.capturedCalls.length - 1];
      const userMsgs = revisionCall.messages.filter(m => m.role === 'user');
      const lastUserMsg = userMsgs[userMsgs.length - 1];

      expect(lastUserMsg!.content).toContain('mountains');
      expect(lastUserMsg!.content).toContain('user_feedback');
    });
  });

  describe('Content session state', () => {
    it('should track content iterations correctly', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create content',
              content_type: 'narration',
            },
          }],
          finishReason: 'tool_calls',
        },
        { content: 'Content v1', toolCalls: [], finishReason: 'stop' },
      ]);

      const result = await agent.run('Create narration');

      expect(result.status).toBe('waiting_for_user');
      expect(result.autoApproveTimeoutMs).toBeDefined();
    });

    it('should indicate waiting state via isWaiting method', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create character',
              content_type: 'character',
            },
          }],
          finishReason: 'tool_calls',
        },
        { content: 'Character profile...', toolCalls: [], finishReason: 'stop' },
      ]);

      // Start content session
      await agent.run('Create character');

      // Agent should be in waiting state
      expect(agent.isWaiting()).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle missing context_refs gracefully', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create generic content',
              content_type: 'plot',
              context_refs: ['$nonexistent', '$also_missing'],
            },
          }],
          finishReason: 'tool_calls',
        },
        {
          content: '# Generic Plot\n\nA story unfolds...',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Create plot');

      // Should still generate content, just without the missing context
      expect(result.status).toBe('waiting_for_user');
    });

    it('should validate required task parameter', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              // Missing task
              content_type: 'story',
            },
          }],
          finishReason: 'tool_calls',
        },
        // Agent continues after error
        {
          content: 'Task parameter was missing.',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Create something');

      // The agent should complete (handling the error internally)
      // The tool result should contain an error
      expect(result.status).toBe('completed');
    });

    it('should validate required content_type parameter', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create something',
              // Missing content_type
            },
          }],
          finishReason: 'tool_calls',
        },
        // Agent continues after error
        {
          content: 'Content type parameter was missing.',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Create something');

      // The agent should complete (handling the error internally)
      expect(result.status).toBe('completed');
    });
  });
});

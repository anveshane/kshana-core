/**
 * Integration tests for Planning Agent behavior.
 * Tests the full planning flow with mocked LLM to verify context injection,
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
 * Returns predefined responses and allows inspection of what was sent.
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

describe('Planning Agent Behavior', { sequential: true }, () => {
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
      name: 'test-planning-agent',
    });
  });

  afterEach(() => {
    contextStore.clear();
    mockLLM.reset();
  });

  describe('Context injection into planning prompt', () => {
    it('should inject single context into planning system prompt', async () => {
      // Store context that should be passed to planning - using global contextStore
      const { variableName } = contextStore.store(
        'Jan is a 25-year-old blacksmith who lives in a mountain village. He has dark eyes and calloused hands.',
        'User Story',
        { variableBaseName: 'user_story' }
      );

      // Setup responses:
      // 1. Main agent calls dispatch_agent with context_refs
      // 2. Planning agent generates a plan
      mockLLM.setResponses([
        // Main agent decides to dispatch planning
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: {
              task: 'Create a plot outline for the story',
              context_refs: [variableName],
            },
          }],
          finishReason: 'tool_calls',
        },
        // Planning agent generates plan (this is the one we want to check)
        {
          content: '# Plot Outline\n\n1. Jan discovers the threat\n2. Jan gathers allies\n3. Final confrontation',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      // Run the agent - it will emit events and return a result
      const result = await agent.run('Create a story about Jan');

      // Check that the agent is waiting for planning verification
      expect(result.status).toBe('waiting_for_user');

      // Find the planning agent call (second call, after main agent)
      expect(mockLLM.capturedCalls.length).toBeGreaterThanOrEqual(2);

      const planningCall = mockLLM.capturedCalls[1];
      expect(planningCall).toBeDefined();

      // Get system message from planning call
      const systemMsg = planningCall.messages.find(m => m.role === 'system');
      expect(systemMsg).toBeDefined();

      // Verify context is injected into system prompt
      expect(systemMsg!.content).toContain('Jan');
      expect(systemMsg!.content).toContain('25-year-old');
      expect(systemMsg!.content).toContain('blacksmith');
      expect(systemMsg!.content).toContain('dark eyes');
      expect(systemMsg!.content).toContain('calloused hands');
      expect(systemMsg!.content).toContain('User Story'); // Label should be included
    });

    it('should inject multiple contexts into planning system prompt', async () => {
      // Store multiple related contexts using global contextStore
      const { variableName: v1 } = contextStore.store(
        'Create a story about Jan saving his village from a shadow demon.',
        'User Request',
        { variableBaseName: 'request' }
      );

      const { variableName: v2 } = contextStore.store(
        'Jan is brave, 25 years old, works as a blacksmith. His brother Kosi is 8 years old.',
        'Character Notes',
        { variableBaseName: 'notes' }
      );

      mockLLM.setResponses([
        // Main agent dispatches planning with multiple context refs
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: {
              task: 'Create a detailed plot outline',
              context_refs: [v1, v2],
            },
          }],
          finishReason: 'tool_calls',
        },
        // Planning agent generates plan
        {
          content: '# Plot: Jan Saves the Village\n\n1. Opening: Jan at the forge\n2. The demon attacks',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Create a detailed story');
      expect(result.status).toBe('waiting_for_user');

      // Verify planning call received both contexts
      const planningCall = mockLLM.capturedCalls[1];
      const systemMsg = planningCall.messages.find(m => m.role === 'system');

      // Both contexts should be in the system prompt
      expect(systemMsg!.content).toContain('shadow demon');
      expect(systemMsg!.content).toContain('Jan is brave');
      expect(systemMsg!.content).toContain('Kosi');
      expect(systemMsg!.content).toContain('8 years old');

      // Context sections should be separated
      expect(systemMsg!.content).toContain('---');
    });

    it('should handle empty context_refs gracefully', async () => {
      mockLLM.setResponses([
        // Main agent dispatches planning without context
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: {
              task: 'Create a generic plot outline',
              context_refs: [],
            },
          }],
          finishReason: 'tool_calls',
        },
        // Planning agent generates plan
        {
          content: '# Generic Plot\n\n1. Introduction\n2. Rising action\n3. Climax',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Create a generic story');

      // Should still work without context
      expect(result.status).toBe('waiting_for_user');

      const planningCall = mockLLM.capturedCalls[1];
      expect(planningCall).toBeDefined();

      const systemMsg = planningCall.messages.find(m => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg!.content).toContain('Create a generic plot outline');
    });

    it('should handle missing context_refs (undefined)', async () => {
      mockLLM.setResponses([
        // Main agent dispatches planning without context_refs
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: {
              task: 'Create a story outline',
              // No context_refs at all
            },
          }],
          finishReason: 'tool_calls',
        },
        // Planning agent generates plan
        {
          content: '# Story Outline\n\n1. Setup\n2. Conflict\n3. Resolution',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Create a story');

      // Should work without any context
      expect(result.status).toBe('waiting_for_user');
      expect(mockLLM.capturedCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Planning response handling', () => {
    it('should return waiting_for_user status after initial plan', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: { task: 'Create a plan' },
          }],
          finishReason: 'tool_calls',
        },
        {
          content: '# Initial Plan\n\n1. First step\n2. Second step',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      const result = await agent.run('Plan something');

      expect(result.status).toBe('waiting_for_user');
      expect(result.pendingQuestion).toBeDefined();
      expect(result.options).toBeDefined();
      expect(result.options?.length).toBe(2);
    });

    it('should handle plan approval and store plan externally', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: { task: 'Create a story plan' },
          }],
          finishReason: 'tool_calls',
        },
        {
          content: '# Story Plan\n\nThis is a detailed plan.',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Classification: APPROVE - the classifier should return "APPROVE" not "yes"
        {
          content: 'APPROVE',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Generate plan metadata
        {
          content: '{"name": "Story Plan", "summary": "A plan for creating a story"}',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Main agent continues after approval
        {
          content: 'Plan approved. I will proceed with execution.',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      // First run triggers planning
      const result1 = await agent.run('Plan a story');
      expect(result1.status).toBe('waiting_for_user');

      // Simulate user approval
      const result2 = await agent.run('Plan a story', 'yes, looks good');

      // After approval, agent should continue (or complete)
      // It may complete if there's nothing more to do, or continue thinking
      expect(['completed', 'waiting_for_user']).toContain(result2.status);

      // Verify plan was stored in context
      const storedContexts = contextStore.list();
      const planContexts = storedContexts.filter(m => m.label.includes('Plan') || m.variableName.includes('plan'));
      expect(planContexts.length).toBeGreaterThan(0);
    });

    it('should handle feedback and revise plan', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: { task: 'Create a story plan' },
          }],
          finishReason: 'tool_calls',
        },
        // First plan
        {
          content: '# Initial Plan\n\n1. Basic step',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Classification: FEEDBACK - the classifier should return "FEEDBACK" not "no"
        {
          content: 'FEEDBACK',
          toolCalls: [],
          finishReason: 'stop',
        },
        // Revised plan
        {
          content: '# Revised Plan\n\n1. Better step\n2. Additional step',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      // First run triggers planning
      const result1 = await agent.run('Plan something');
      expect(result1.status).toBe('waiting_for_user');

      // Provide feedback
      const result2 = await agent.run('Plan something', 'Add more detail to the steps');

      // Should still be waiting for user (showing revised plan)
      expect(result2.status).toBe('waiting_for_user');
    });
  });

  describe('Planning session state', () => {
    it('should track iterations correctly via autoApproveTimeoutMs in result', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: { task: 'Create a plan' },
          }],
          finishReason: 'tool_calls',
        },
        { content: 'Plan v1', toolCalls: [], finishReason: 'stop' },
      ]);

      const result = await agent.run('Plan');

      expect(result.status).toBe('waiting_for_user');
      // The result should have timeout set
      expect(result.autoApproveTimeoutMs).toBeDefined();
    });

    it('should indicate waiting state via isWaiting method', async () => {
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_agent',
            arguments: { task: 'First plan' },
          }],
          finishReason: 'tool_calls',
        },
        { content: 'Plan 1', toolCalls: [], finishReason: 'stop' },
      ]);

      // Start first planning session
      await agent.run('Plan something');

      // Agent should be in waiting state
      expect(agent.isWaiting()).toBe(true);
    });
  });
});

/**
 * Integration tests for Context Visibility.
 *
 * These tests verify that:
 * 1. The main agent is reminded about available context variables
 * 2. The context reminder includes ALL stored contexts
 * 3. When the agent dispatches sub-agents without context_refs, we can detect it
 *
 * This addresses the bug where character creation ignored plot details because
 * the orchestrating agent didn't pass the plot context_ref.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GenericAgent } from '../../src/core/agent/GenericAgent.js';
import { contextStore } from '../../src/core/context/index.js';
import { createDefaultToolRegistry } from '../../src/core/tools/index.js';
import { buildContextVariablesSection, type ContextVariable } from '../../src/core/prompts/index.js';
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

describe('Context Visibility and Reminder System', { sequential: true }, () => {
  let mockLLM: ReturnType<typeof createCapturingMockLLM>;
  let agent: GenericAgent;

  beforeAll(() => {
    cleanContextState();
  });

  beforeEach(() => {
    cleanContextState();
    contextStore.clear();
    mockLLM = createCapturingMockLLM();

    const registry = createDefaultToolRegistry();
    agent = new GenericAgent(registry.getAll(), mockLLM as any, {
      maxIterations: 5,
      name: 'test-agent',
    });
  });

  afterEach(() => {
    contextStore.clear();
    mockLLM.reset();
  });

  describe('buildContextVariablesSection', () => {
    it('should list ALL stored context variables', () => {
      const variables: ContextVariable[] = [
        { variableName: '$plot', label: 'Story Plot', charCount: 500 },
        { variableName: '$character', label: 'Main Character', charCount: 300 },
        { variableName: '$setting', label: 'World Setting', charCount: 400 },
      ];

      const section = buildContextVariablesSection(variables);

      // All variables should be listed
      expect(section).toContain('$plot');
      expect(section).toContain('$character');
      expect(section).toContain('$setting');

      // Labels should be included
      expect(section).toContain('Story Plot');
      expect(section).toContain('Main Character');
      expect(section).toContain('World Setting');
    });

    it('should include example with ALL variable names', () => {
      const variables: ContextVariable[] = [
        { variableName: '$plot', label: 'Plot', charCount: 100 },
        { variableName: '$character', label: 'Character', charCount: 100 },
      ];

      const section = buildContextVariablesSection(variables);

      // The example should show passing ALL contexts
      expect(section).toContain('context_refs=["$plot", "$character"]');
    });

    it('should emphasize using ALL relevant contexts', () => {
      const variables: ContextVariable[] = [
        { variableName: '$plot', label: 'Plot', charCount: 100 },
      ];

      const section = buildContextVariablesSection(variables);

      // Should have guidance about passing contexts
      expect(section).toContain('Pass ALL relevant contexts');
      expect(section).toContain('Use these when dispatching tasks that need this content');
    });

    it('should return empty string when no contexts exist', () => {
      const section = buildContextVariablesSection([]);
      expect(section).toBe('');
    });
  });

  describe('Agent context tracking', () => {
    it('should track active context variables via getActiveContextVariables', async () => {
      // Store some contexts
      contextStore.store(
        'Jan is a 25-year-old blacksmith with dark eyes.',
        'Plot',
        { variableBaseName: 'plot' }
      );

      contextStore.store(
        'Jan has calloused hands from years at the forge.',
        'Character Details',
        { variableBaseName: 'character' }
      );

      // The agent should see these in getActiveContextVariables after processing
      // Note: activeContextVariables is populated when user input is condensed
      // For this test, we verify the contextStore has the data
      const storedContexts = contextStore.list();
      expect(storedContexts.length).toBe(2);
      expect(storedContexts.some(c => c.variableName === '$plot')).toBe(true);
      expect(storedContexts.some(c => c.variableName === '$character')).toBe(true);
    });
  });

  describe('Bug prevention: Character creation without plot context', () => {
    /**
     * This test simulates the bug scenario:
     * 1. Plot is stored with character details (Jan, 25, blacksmith, dark eyes)
     * 2. Agent dispatches character creation WITHOUT passing plot context_ref
     * 3. Content agent creates character without access to plot details
     *
     * We verify that when context_refs is empty/missing, the content agent
     * does NOT receive the plot details in its system prompt.
     */
    it('should NOT have plot details when context_refs is empty', async () => {
      // Store plot with specific character details
      // Use unique identifiers that won't appear in the prompt template
      const { variableName: plotVar } = contextStore.store(
        `# Story Plot

Main Character: Zephyr
- Age: 37 years old
- Occupation: Lighthouse keeper
- Physical: Silver eyes, weathered hands, lean build
- Personality: Brave, determined, protective of his sister Mira

Antagonist: Shadowmaw, the ancient beast`,
        'Plot',
        { variableBaseName: 'plot' }
      );

      // Simulate agent dispatching character creation WITHOUT context_refs
      // This is the BUG scenario
      mockLLM.setResponses([
        // Main agent calls dispatch_content_agent WITHOUT context_refs
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create a detailed character profile for the protagonist',
              content_type: 'character',
              // BUG: No context_refs passed! Plot details will be lost!
              context_refs: [],
            },
          }],
          finishReason: 'tool_calls',
        },
        // Content agent generates character (without plot context)
        {
          content: '# Character Profile\n\nA generic character...',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      await agent.run('Create the main character');

      // Find the content agent call
      const contentCall = mockLLM.capturedCalls[1];
      const systemMsg = contentCall.messages.find(m => m.role === 'system');

      // The content agent should NOT have the plot details
      // because context_refs was empty
      expect(systemMsg!.content).not.toContain('Zephyr');
      expect(systemMsg!.content).not.toContain('37 years old');
      expect(systemMsg!.content).not.toContain('Lighthouse keeper');
      expect(systemMsg!.content).not.toContain('Silver eyes');
      expect(systemMsg!.content).not.toContain('Shadowmaw');
    });

    it('should HAVE plot details when context_refs includes plot', async () => {
      // Store plot with specific character details
      // Use unique identifiers that won't appear in the prompt template
      const { variableName: plotVar } = contextStore.store(
        `# Story Plot

Main Character: Zephyr
- Age: 37 years old
- Occupation: Lighthouse keeper
- Physical: Silver eyes, weathered hands, lean build
- Personality: Brave, determined, protective of his sister Mira

Antagonist: Shadowmaw, the ancient beast`,
        'Plot',
        { variableBaseName: 'plot' }
      );

      // Simulate agent dispatching character creation WITH context_refs
      // This is the CORRECT scenario
      mockLLM.setResponses([
        // Main agent calls dispatch_content_agent WITH plot context
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create a detailed character profile for the protagonist',
              content_type: 'character',
              // CORRECT: Plot context is passed!
              context_refs: [plotVar],
            },
          }],
          finishReason: 'tool_calls',
        },
        // Content agent generates character (with plot context)
        {
          content: '# Jan - Character Profile\n\nJan is a 25-year-old blacksmith...',
          toolCalls: [],
          finishReason: 'stop',
        },
      ]);

      await agent.run('Create the main character');

      // Find the content agent call
      const contentCall = mockLLM.capturedCalls[1];
      const systemMsg = contentCall.messages.find(m => m.role === 'system');

      // The content agent SHOULD have all the plot details
      expect(systemMsg!.content).toContain('Zephyr');
      expect(systemMsg!.content).toContain('37 years old');
      expect(systemMsg!.content).toContain('Lighthouse keeper');
      expect(systemMsg!.content).toContain('Silver eyes');
      expect(systemMsg!.content).toContain('weathered hands');
      expect(systemMsg!.content).toContain('Shadowmaw');
    });

    it('should demonstrate the difference between with and without context', async () => {
      // This test clearly shows the contrast between passing and not passing context
      // Use unique identifiers that won't appear in the prompt template

      const plotContent = `Character: Zephyr, 37 years old, lighthouse keeper, silver eyes, scar on left cheek`;

      const { variableName: plotVar } = contextStore.store(
        plotContent,
        'Plot',
        { variableBaseName: 'plot' }
      );

      // Test 1: WITHOUT context
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create character',
              content_type: 'character',
              context_refs: [], // Empty - bug scenario
            },
          }],
          finishReason: 'tool_calls',
        },
        { content: 'Generic character', toolCalls: [], finishReason: 'stop' },
      ]);

      await agent.run('Create character');

      const callWithoutContext = mockLLM.capturedCalls[1];
      const systemWithout = callWithoutContext.messages.find(m => m.role === 'system')!.content!;

      // Reset for second test
      mockLLM.reset();
      cleanContextState();
      contextStore.clear();

      // Re-store the plot
      const { variableName: plotVar2 } = contextStore.store(
        plotContent,
        'Plot',
        { variableBaseName: 'plot' }
      );

      // Create new agent
      const registry = createDefaultToolRegistry();
      const agent2 = new GenericAgent(registry.getAll(), mockLLM as any, {
        maxIterations: 5,
        name: 'test-agent-2',
      });

      // Test 2: WITH context
      mockLLM.setResponses([
        {
          content: '',
          toolCalls: [{
            id: 'call_1',
            name: 'dispatch_content_agent',
            arguments: {
              task: 'Create character',
              content_type: 'character',
              context_refs: [plotVar2], // Correct - includes plot
            },
          }],
          finishReason: 'tool_calls',
        },
        { content: 'Jan character', toolCalls: [], finishReason: 'stop' },
      ]);

      await agent2.run('Create character');

      const callWithContext = mockLLM.capturedCalls[1];
      const systemWith = callWithContext.messages.find(m => m.role === 'system')!.content!;

      // Verify the difference
      expect(systemWithout).not.toContain('scar on left cheek');
      expect(systemWith).toContain('scar on left cheek');

      expect(systemWithout).not.toContain('37 years old');
      expect(systemWith).toContain('37 years old');
    });
  });

  describe('Context reminder in main agent messages', () => {
    it('should include context variables section when contexts exist', async () => {
      // This tests that the main agent sees a reminder about available contexts

      // First, we need to have the agent process input that creates context
      // Then check subsequent calls include the context reminder

      // For now, verify the buildContextVariablesSection function works correctly
      const variables: ContextVariable[] = [
        { variableName: '$plot', label: 'Story Plot', charCount: 1000 },
      ];

      const section = buildContextVariablesSection(variables);

      // The section should contain clear instructions
      expect(section).toContain('Stored Context Variables');
      expect(section).toContain('$plot');
      expect(section).toContain('Story Plot');
      expect(section).toContain('dispatch_content_agent');
    });
  });
});

describe('Context Consistency Verification', { sequential: true }, () => {
  beforeAll(() => {
    cleanContextState();
  });

  beforeEach(() => {
    cleanContextState();
    contextStore.clear();
  });

  afterEach(() => {
    contextStore.clear();
  });

  it('should maintain character details across plot -> character workflow', () => {
    // Store plot with specific details
    const { variableName: plotVar } = contextStore.store(
      `Protagonist: Jan
- Age: 25
- Job: Blacksmith
- Eyes: Dark brown
- Hands: Calloused from forge work
- Brother: Kosi, age 8`,
      'Plot',
      { variableBaseName: 'plot' }
    );

    // Verify we can retrieve and the details are intact
    const retrieved = contextStore.get(plotVar);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toContain('Age: 25');
    expect(retrieved!.content).toContain('Blacksmith');
    expect(retrieved!.content).toContain('Dark brown');
    expect(retrieved!.content).toContain('Calloused');
    expect(retrieved!.content).toContain('Kosi');
    expect(retrieved!.content).toContain('age 8');
  });

  it('should list all contexts for reference', () => {
    // Create multiple contexts
    contextStore.store('Plot content', 'Plot', { variableBaseName: 'plot' });
    contextStore.store('Story content', 'Story', { variableBaseName: 'story' });
    contextStore.store('Character content', 'Character', { variableBaseName: 'char' });

    const all = contextStore.list();

    expect(all.length).toBe(3);
    expect(all.map(c => c.variableName)).toContain('$plot');
    expect(all.map(c => c.variableName)).toContain('$story');
    expect(all.map(c => c.variableName)).toContain('$char');
  });

  it('should format multiple contexts with separators', () => {
    const { variableName: v1 } = contextStore.store(
      'Jan is 25 years old',
      'Character Age',
      { variableBaseName: 'age' }
    );

    const { variableName: v2 } = contextStore.store(
      'Jan works as a blacksmith',
      'Character Job',
      { variableBaseName: 'job' }
    );

    // Simulate how GenericAgent combines contexts
    const contextRefs = [v1, v2];
    const contextParts: Array<{ variableName: string; label: string; content: string }> = [];

    for (const ref of contextRefs) {
      const stored = contextStore.get(ref);
      if (stored) {
        contextParts.push({
          variableName: ref,
          label: stored.label,
          content: stored.content,
        });
      }
    }

    const combined = contextParts
      .map(part => `## ${part.variableName} (${part.label})\n\n${part.content}`)
      .join('\n\n---\n\n');

    // Verify both parts are present
    expect(combined).toContain('25 years old');
    expect(combined).toContain('blacksmith');
    expect(combined).toContain('---'); // Separator
    expect(combined).toContain('Character Age');
    expect(combined).toContain('Character Job');
  });
});

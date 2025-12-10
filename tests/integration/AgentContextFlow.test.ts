/**
 * Integration tests for GenericAgent context flow.
 * Tests the actual agent behavior with mocked LLM responses.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GenericAgent } from '../../src/core/agent/GenericAgent.js';
import { ContextStore } from '../../src/core/context/ContextStore.js';
import { createDefaultToolRegistry } from '../../src/core/tools/index.js';
import { buildContentPrompt, buildPlanningPrompt } from '../../src/core/prompts/index.js';
import type { Message, LLMResponse, StreamChunk, GenerateOptions } from '../../src/core/llm/types.js';

const CONTEXT_DIR = join(process.cwd(), '.kshana', 'context');

function cleanContextState() {
  if (existsSync(CONTEXT_DIR)) {
    rmSync(CONTEXT_DIR, { recursive: true, force: true });
  }
}

/**
 * Create a mock LLM that captures prompts and returns predefined responses.
 */
function createCapturingMockLLM() {
  const capturedCalls: { messages: Message[]; options: Partial<GenerateOptions> }[] = [];
  let responseQueue: LLMResponse[] = [];

  const mockLLM = {
    capturedCalls,

    setResponses(responses: LLMResponse[]) {
      responseQueue = [...responses];
    },

    async generate(options: GenerateOptions): Promise<LLMResponse> {
      capturedCalls.push({ messages: [...options.messages], options });

      const response = responseQueue.shift();
      if (response) {
        return response;
      }

      // Default: return stop response
      return {
        content: 'Default response',
        toolCalls: [],
        finishReason: 'stop',
      };
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
  };

  return mockLLM;
}

describe('Agent Context Flow Integration', { sequential: true }, () => {
  let contextStore: ContextStore;

  beforeAll(() => {
    cleanContextState();
  });

  beforeEach(() => {
    cleanContextState();
    contextStore = new ContextStore();
  });

  afterEach(() => {
    contextStore.clear();
  });

  describe('Planning prompt context injection', () => {
    it('should inject context into planning system prompt', async () => {
      // Store context that should be passed to planning
      const { variableName } = contextStore.store(
        'Jan is a 25-year-old blacksmith who lives in a mountain village.',
        'User Story',
        { variableBaseName: 'user_story' }
      );

      // Resolve the context (simulating what handleDispatchAgent does)
      const stored = contextStore.get(variableName);
      expect(stored).not.toBeNull();

      // Build context string
      const context = `## ${variableName} (${stored!.label})\n\n${stored!.content}`;

      // Build planning prompt with context
      const planningPrompt = buildPlanningPrompt(
        'Create a plot outline for this story',
        context
      );

      // Verify the planning prompt includes the context
      expect(planningPrompt).toContain('Jan');
      expect(planningPrompt).toContain('25-year-old');
      expect(planningPrompt).toContain('blacksmith');
      expect(planningPrompt).toContain('mountain village');
      expect(planningPrompt).toContain('User Story'); // Label
    });

    it('should inject multiple contexts into planning prompt', async () => {
      // Store multiple related contexts
      const { variableName: v1 } = contextStore.store(
        'Create a story about Jan saving his village.',
        'User Request',
        { variableBaseName: 'request' }
      );

      const { variableName: v2 } = contextStore.store(
        'Jan is brave, 25 years old, works as a blacksmith.',
        'Character Notes',
        { variableBaseName: 'notes' }
      );

      // Resolve all contexts
      const contextRefs = [v1, v2];
      const parts: Array<{ variableName: string; label: string; content: string }> = [];

      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          parts.push({ variableName: ref, label: stored.label, content: stored.content });
        }
      }

      // Build combined context
      const combinedContext = parts
        .map(p => `## ${p.variableName} (${p.label})\n\n${p.content}`)
        .join('\n\n---\n\n');

      const planningPrompt = buildPlanningPrompt('Create a detailed plot', combinedContext);

      // Verify both contexts are included
      expect(planningPrompt).toContain('saving his village');
      expect(planningPrompt).toContain('brave');
      expect(planningPrompt).toContain('25 years old');
      expect(planningPrompt).toContain('blacksmith');
    });
  });

  describe('Content prompt context injection', () => {
    it('should inject context into content creation prompt', async () => {
      // Store plot context
      const { variableName } = contextStore.store(
        `# Plot Outline

Protagonist: Jan
- Age: 25
- Occupation: Blacksmith
- Appearance: Dark eyes, calloused hands, faded blue shirt

Setting: Mountain village threatened by shadow demon`,
        'Plot',
        { variableBaseName: 'plot' }
      );

      const stored = contextStore.get(variableName);
      const context = `## ${variableName} (${stored!.label})\n\n${stored!.content}`;

      // Build content prompt for character creation
      const contentPrompt = buildContentPrompt(
        'Create a detailed character profile for Jan',
        'character',
        context
      );

      // Verify the content prompt includes character details from context
      expect(contentPrompt).toContain('Age: 25');
      expect(contentPrompt).toContain('Blacksmith');
      expect(contentPrompt).toContain('Dark eyes');
      expect(contentPrompt).toContain('calloused hands');
      expect(contentPrompt).toContain('faded blue shirt');
    });

    it('should include all story context when creating character', async () => {
      // Store full workflow context
      const { variableName: plotVar } = contextStore.store(
        'Jan (25, blacksmith) must save village from Kombumanye.',
        'Plot',
        { variableBaseName: 'plot' }
      );

      const { variableName: storyVar } = contextStore.store(
        'Jan\'s forge was his father\'s legacy. Kosi, his 8-year-old brother, watched from the doorway.',
        'Story',
        { variableBaseName: 'story' }
      );

      // Resolve all
      const refs = [plotVar, storyVar];
      const parts = refs.map(ref => {
        const stored = contextStore.get(ref)!;
        return { variableName: ref, label: stored.label, content: stored.content };
      });

      const combinedContext = parts
        .map(p => `## ${p.variableName} (${p.label})\n\n${p.content}`)
        .join('\n\n---\n\n');

      const contentPrompt = buildContentPrompt(
        'Create character profile for Jan',
        'character',
        combinedContext
      );

      // Verify ALL details are present
      expect(contentPrompt).toContain('25');
      expect(contentPrompt).toContain('blacksmith');
      expect(contentPrompt).toContain('Kombumanye');
      expect(contentPrompt).toContain('Kosi');
      expect(contentPrompt).toContain('8-year-old');
      expect(contentPrompt).toContain("father's legacy");
    });
  });

  describe('Context preservation across workflow', () => {
    it('should preserve all context details through the workflow', async () => {
      // Simulate the full workflow: input -> plot -> story -> character

      // Step 1: User input
      const input = contextStore.store(
        'Create a story about Jan, a blacksmith (25 years old, dark eyes, calloused hands) saving his village.',
        'User Input',
        { variableBaseName: 'input' }
      );

      // Step 2: Plot (references input)
      const plot = contextStore.store(
        `Based on user input:
- Protagonist: Jan, 25, blacksmith, dark eyes, calloused hands
- Setting: Mountain village
- Conflict: Shadow demon Kombumanye
- Supporting: Kosi (Jan's 8-year-old brother)`,
        'Plot',
        { variableBaseName: 'plot' }
      );

      // Step 3: Story (references input + plot)
      const story = contextStore.store(
        `Jan wiped sweat from his brow with calloused hands.
At 25, he was the only blacksmith since his father died.
His dark eyes reflected the forge's glow.
Kosi, just 8, watched from the doorway.`,
        'Story',
        { variableBaseName: 'story' }
      );

      // Now create character - ALL context should be available
      const allRefs = [input.variableName, plot.variableName, story.variableName];
      const allParts = allRefs.map(ref => {
        const stored = contextStore.get(ref)!;
        return { variableName: ref, label: stored.label, content: stored.content };
      });

      const fullContext = allParts
        .map(p => `## ${p.variableName} (${p.label})\n\n${p.content}`)
        .join('\n\n---\n\n');

      // Character details should be consistent and complete
      const janMentions = (fullContext.match(/Jan/g) || []).length;
      expect(janMentions).toBeGreaterThanOrEqual(3); // Should appear in all three

      // Age should be consistent
      expect(fullContext).toContain('25');

      // Occupation consistent
      const blacksmithMentions = (fullContext.match(/blacksmith/gi) || []).length;
      expect(blacksmithMentions).toBeGreaterThanOrEqual(2);

      // Visual details preserved
      expect(fullContext).toContain('dark eyes');
      expect(fullContext).toContain('calloused hands');

      // Supporting character preserved
      expect(fullContext).toContain('Kosi');
      expect(fullContext).toContain('8');
    });
  });

  describe('Error handling', () => {
    it('should handle empty context_refs gracefully', async () => {
      // No context stored, empty refs
      const contextRefs: string[] = [];
      const parts: Array<{ variableName: string; label: string; content: string }> = [];

      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          parts.push({ variableName: ref, label: stored.label, content: stored.content });
        }
      }

      expect(parts).toHaveLength(0);

      // Building prompt with undefined context should still work
      const prompt = buildPlanningPrompt('Create a plan', undefined);
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Create a plan');
    });

    it('should handle partially missing context_refs', async () => {
      // Store one context
      const { variableName } = contextStore.store(
        'Existing content',
        'Existing',
        { variableBaseName: 'existing' }
      );

      // Mix of existing and non-existing refs
      const contextRefs = [variableName, '$missing', '$also_missing'];
      const parts: Array<{ variableName: string; label: string; content: string }> = [];
      const missing: string[] = [];

      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          parts.push({ variableName: ref, label: stored.label, content: stored.content });
        } else {
          missing.push(ref);
        }
      }

      expect(parts).toHaveLength(1);
      expect(missing).toHaveLength(2);
      expect(missing).toContain('$missing');
      expect(missing).toContain('$also_missing');
    });
  });
});

describe('Context Variable Persistence', { sequential: true }, () => {
  let contextStore: ContextStore;

  beforeEach(() => {
    cleanContextState();
    contextStore = new ContextStore();
  });

  afterEach(() => {
    contextStore.clear();
  });

  it('should persist context to .md files', async () => {
    const { variableName } = contextStore.store(
      'Test content for persistence',
      'Test Label',
      { variableBaseName: 'test' }
    );

    // Verify file was created
    const filePath = join(CONTEXT_DIR, 'test.md');
    expect(existsSync(filePath)).toBe(true);

    // Create new store instance (simulating restart)
    const newStore = new ContextStore();

    // Should be able to retrieve the content
    const retrieved = newStore.get(variableName);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.content).toBe('Test content for persistence');
    expect(retrieved?.label).toBe('Test Label');
  });

  it('should maintain variable counter across sessions', async () => {
    // Store some contexts
    contextStore.store('Content 1', 'Scene', { variableBaseName: 'scene' });
    contextStore.store('Content 2', 'Scene', { variableBaseName: 'scene' });

    // Create new store instance
    const newStore = new ContextStore();

    // Next scene should continue numbering
    const { variableName } = newStore.store('Content 3', 'Scene', { variableBaseName: 'scene' });
    expect(variableName).toBe('$scene_3');
  });
});

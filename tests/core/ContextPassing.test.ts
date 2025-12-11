import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ContextStore } from '../../src/core/context/ContextStore.js';
import { buildContentPrompt, buildPlanningPrompt } from '../../src/core/prompts/index.js';

const CONTEXT_DIR = join(process.cwd(), '.kshana', 'context');
const CONTEXT_INDEX_FILE = join(CONTEXT_DIR, 'index.json');

// Create fresh store for each test
let contextStore: ContextStore;

// Helper to fully clean context state
function cleanContextState() {
  if (existsSync(CONTEXT_DIR)) {
    rmSync(CONTEXT_DIR, { recursive: true, force: true });
  }
}

// Run tests sequentially to avoid race conditions with shared directory
describe('Context Passing', { sequential: true }, () => {
  beforeAll(() => {
    // Clean up context directory before all tests
    cleanContextState();
  });

  beforeEach(() => {
    // Fully clean state before each test to avoid interference from other test files
    cleanContextState();
    contextStore = new ContextStore();
  });

  afterEach(() => {
    contextStore.clear();
  });

  describe('Context Resolution', () => {
    it('should resolve single context reference', () => {
      // Store a context with explicit variable base name
      const { variableName } = contextStore.store(
        'This is the user story about a robot',
        'User Story',
        { variableBaseName: 'user_story' }
      );

      // Variable name should be predictable
      expect(variableName).toBe('$user_story');

      // Resolve it
      const stored = contextStore.get(variableName);

      expect(stored).not.toBeNull();
      expect(stored?.content).toBe('This is the user story about a robot');
      expect(stored?.label).toBe('User Story');
    });

    it('should resolve multiple context references', () => {
      // Store multiple contexts with distinct labels to get different variable names
      const { variableName: v1 } = contextStore.store('Plot outline with robot', 'Plot', { variableBaseName: 'plot' });
      const { variableName: v2 } = contextStore.store('Jan is the main character', 'Characters', { variableBaseName: 'characters' });
      const { variableName: v3 } = contextStore.store('Setting is a village', 'Setting', { variableBaseName: 'setting' });

      const contextRefs = [v1, v2, v3];

      // Resolve all
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

      expect(contextParts).toHaveLength(3);
      expect(contextParts[0]?.content).toBe('Plot outline with robot');
      expect(contextParts[1]?.content).toBe('Jan is the main character');
      expect(contextParts[2]?.content).toBe('Setting is a village');
    });

    it('should handle missing context references gracefully', () => {
      const { variableName } = contextStore.store('Existing content', 'Existing');

      const contextRefs = [variableName, '$nonexistent'];
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

      // Should only have 1 (the existing one)
      expect(contextParts).toHaveLength(1);
      expect(contextParts[0]?.variableName).toBe(variableName);
    });
  });

  describe('Context Building for Prompts', () => {
    it('should build combined context string from multiple refs', () => {
      const { variableName: v1 } = contextStore.store('The plot is about Jan saving the village', 'Plot', { variableBaseName: 'plot' });
      const { variableName: v2 } = contextStore.store('Jan is 25, brave, and caring', 'Main Character', { variableBaseName: 'main_character' });

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

      // Build combined context like GenericAgent does
      const combinedContext = contextParts
        .map(part => `## ${part.variableName} (${part.label})\n\n${part.content}`)
        .join('\n\n---\n\n');

      expect(combinedContext).toContain('## $plot (Plot)');
      expect(combinedContext).toContain('The plot is about Jan saving the village');
      expect(combinedContext).toContain('## $main_character (Main Character)');
      expect(combinedContext).toContain('Jan is 25, brave, and caring');
      expect(combinedContext).toContain('---'); // Separator
    });

    it('should pass context to content prompt correctly', () => {
      // Store some context
      contextStore.store('Jan is a young man from the village', 'Main Character');

      const stored = contextStore.get('$main_character');
      const context = stored
        ? `## $main_character (${stored.label})\n\n${stored.content}`
        : undefined;

      // Build content prompt
      const prompt = buildContentPrompt(
        'Create a character profile for Jan',
        'character',
        context
      );

      // Verify context is included in prompt
      expect(prompt).toContain('Jan is a young man from the village');
      expect(prompt).toContain('Main Character');
    });

    it('should pass context to planning prompt correctly', () => {
      // Store context
      contextStore.store('User wants a story about a robot learning to dance', 'User Input');

      const stored = contextStore.get('$user_input');
      const context = stored
        ? `## $user_input (${stored.label})\n\n${stored.content}`
        : undefined;

      // Build planning prompt
      const prompt = buildPlanningPrompt(
        'Create a plan for story development',
        context
      );

      // Verify context is included
      expect(prompt).toContain('robot learning to dance');
      expect(prompt).toContain('User Input');
    });
  });

  describe('Context Variable Naming', () => {
    it('should create predictable variable names', () => {
      const r1 = contextStore.store('Content', 'User Input');
      const r2 = contextStore.store('Content', 'Plot Outline');
      const r3 = contextStore.store('Content', 'Story');

      expect(r1.variableName).toBe('$user_input');
      expect(r2.variableName).toBe('$plot_outline');
      expect(r3.variableName).toBe('$story');
    });

    it('should handle duplicate labels with incrementing numbers', () => {
      const r1 = contextStore.store('Scene 1 content', 'Scene');
      const r2 = contextStore.store('Scene 2 content', 'Scene');
      const r3 = contextStore.store('Scene 3 content', 'Scene');

      expect(r1.variableName).toBe('$scene');
      expect(r2.variableName).toBe('$scene_2');
      expect(r3.variableName).toBe('$scene_3');
    });
  });
});

describe('Context Integration Scenarios', { sequential: true }, () => {
  beforeEach(() => {
    // Fully clean state before each test
    cleanContextState();
    contextStore = new ContextStore();
  });

  afterEach(() => {
    contextStore.clear();
  });

  it('should preserve character details when passed to content agent', () => {
    // Simulate the workflow: user input -> plot -> story with characters
    const { variableName: userInputVar } = contextStore.store(
      'Create a story about Jan, a 25-year-old blacksmith who must save his village from a shadow demon',
      'User Input'
    );

    const { variableName: plotVar } = contextStore.store(
      `# Plot: Shadow of the Village

## Main Character
- **Jan**: 25-year-old blacksmith, brave and caring
- Has a younger brother Kosi (age 8)

## Story Beats
1. Jan witnesses the shadow demon attack
2. Jan discovers the village's ancient secret
3. Jan builds a weapon to fight the demon
4. Final confrontation`,
      'Plot Outline'
    );

    // Now simulate dispatching content agent with both contexts
    const contextRefs = [userInputVar, plotVar];
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

    // Build combined context
    const combinedContext = contextParts
      .map(part => `## ${part.variableName} (${part.label})\n\n${part.content}`)
      .join('\n\n---\n\n');

    // Verify Jan's details are preserved
    expect(combinedContext).toContain('Jan');
    expect(combinedContext).toContain('25-year-old blacksmith');
    expect(combinedContext).toContain('Kosi');
    expect(combinedContext).toContain('shadow demon');
  });

  it('should correctly format context for character creation', () => {
    // Setup: Store existing context with character information
    const { variableName: plotVar } = contextStore.store(
      `# Plot

Main character: Jan (25, blacksmith, brave)
Antagonist: Kombumanye (shadow demon)
Setting: Remote village`,
      'Plot'
    );

    // Verify the context is retrievable
    const plot = contextStore.get(plotVar);
    expect(plot).not.toBeNull();
    expect(plot?.content).toContain('Jan');
    expect(plot?.content).toContain('25, blacksmith, brave');

    // Build context for character agent
    const context = `## ${plotVar} (${plot?.label})\n\n${plot?.content}`;

    // Build the content prompt
    const prompt = buildContentPrompt(
      'Create a detailed character profile for Jan, the protagonist',
      'character',
      context
    );

    // The prompt should contain the original character details
    expect(prompt).toContain('Jan');
    expect(prompt).toContain('25, blacksmith, brave');
  });

  it('should maintain all loaded contexts across workflow phases', () => {
    // Simulate loading project files as contexts (like loadProjectFilesAsContexts)
    const loadedContexts: string[] = [];

    // Load plot
    const { variableName: plotVar } = contextStore.store(
      'Plot content with Jan and Kosi',
      'Plot Outline',
      { variableBaseName: 'plot' }
    );
    loadedContexts.push(plotVar);

    // Load story
    const { variableName: storyVar } = contextStore.store(
      'Story content expanding on Jan and Kosi',
      'Story',
      { variableBaseName: 'story' }
    );
    loadedContexts.push(storyVar);

    // Load characters
    const { variableName: charsVar } = contextStore.store(
      'Jan: 25, blacksmith\nKosi: 8, Jan\'s brother',
      'Characters',
      { variableBaseName: 'characters' }
    );
    loadedContexts.push(charsVar);

    // All contexts should be available
    expect(loadedContexts).toHaveLength(3);
    expect(loadedContexts).toContain('$plot');
    expect(loadedContexts).toContain('$story');
    expect(loadedContexts).toContain('$characters');

    // Each should be retrievable
    for (const ref of loadedContexts) {
      const stored = contextStore.get(ref);
      expect(stored).not.toBeNull();
    }
  });
});

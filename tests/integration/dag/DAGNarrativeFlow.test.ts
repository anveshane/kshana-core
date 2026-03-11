/**
 * Integration test: mini end-to-end narrative flow.
 *
 * Uses buildNarrativeDAG({ skipPlanning: true }) for a compact DAG,
 * then mocks all LLM and user interactions to run the full pipeline.
 */

import { describe, it, expect } from 'vitest';
import { buildNarrativeDAG } from '../../../src/core/dag/DAGBuilder.js';
import { DAGExecutor, type UserInteractionHandler } from '../../../src/core/dag/DAGExecutor.js';
import type { DAGEvent } from '../../../src/core/dag/types.js';
import { MockLLMClient, lastUserContains } from '../../integration/MockLLMClient.js';
import { withTempDir } from '../../helpers/dag/DAGTestHelpers.js';

const entityJSON = JSON.stringify({
  characters: [
    { name: 'Jan', role: 'protagonist', description: 'A young farmer' },
  ],
  settings: [
    { name: 'Village', description: 'A peaceful village' },
  ],
  scenes: [
    { number: 1, title: 'Morning Chores', characters: ['Jan'], setting: 'Village', summary: 'Jan starts the day' },
  ],
});

const shotBreakdownJSON = JSON.stringify({
  shots: [
    { shotNumber: 1, type: 'wide', description: 'Village overview' },
    { shotNumber: 2, type: 'medium', description: 'Jan walking' },
  ],
});

describe('DAGNarrativeFlow', () => {
  it('runs a mini narrative pipeline end-to-end', async () => {
    await withTempDir(async (dir) => {
      const dag = buildNarrativeDAG({ templateId: 'narrative', projectDir: dir, skipPlanning: true });

      // Override expand_shots_handler to return shot breakdown data that the expander can parse.
      // The default handler returns plain text, but the shot expander needs JSON or data.
      dag.registerHandler('expand_shots_handler', async (ctx) => {
        const sceneNum = ctx.metadata['sceneNumber'] as number;
        const shotResult = ctx.getResult(`scene_${sceneNum}_shot_breakdown`);
        // Pass through the shot breakdown data for the expander
        return {
          content: shotResult.content,
          data: shotResult.data,
        };
      });

      // Set up mock LLM with sequential responses
      const llm = new MockLLMClient();

      // Match specific prompts to responses (using lastUserContains to match
      // only the user prompt, avoiding cross-matching with other message content)
      // generate_plot — use specific text to avoid matching the story prompt which also mentions "plot"
      llm.expect({ match: lastUserContains('Generate a compelling plot'), response: { content: 'A farmer discovers magic.' } });
      // generate_story
      llm.expect({ match: lastUserContains('Expand the following plot'), response: { content: 'Jan the farmer found a glowing stone in the village field.' } });
      // extract_entities — must return valid entity JSON
      llm.expect({ match: lastUserContains('extract all entities'), response: { content: entityJSON } });
      // Character generate
      llm.expect({ match: lastUserContains('character description for'), response: { content: 'Jan is a tall farmer with brown hair.' } });
      // Setting generate
      llm.expect({ match: lastUserContains('setting description for'), response: { content: 'A quiet village with thatched roofs.' } });
      // Character img prompt
      llm.expect({ match: lastUserContains('image generation prompt for the character'), response: { content: 'Portrait of a tall farmer' } });
      // Setting img prompt
      llm.expect({ match: lastUserContains('image generation prompt for the setting'), response: { content: 'Aerial view of village' } });
      // Character img generate — prompt is just the image prompt text
      llm.expect({ match: lastUserContains('Portrait of a tall farmer'), response: { content: 'image_generated' } });
      // Setting img generate
      llm.expect({ match: lastUserContains('Aerial view of village'), response: { content: 'image_generated' } });
      // Scenes generate
      llm.expect({ match: lastUserContains('detailed scene descriptions'), response: { content: 'Scene 1: Morning in the village.' } });
      // Shot breakdown for scene 1
      llm.expect({ match: lastUserContains('Break scene'), response: { content: shotBreakdownJSON } });

      // For all remaining shot-level generation (img prompts, images, videos)
      llm.setDefaultResponse({ content: 'generated_content' });

      // User interaction: approve everything
      const userHandler: UserInteractionHandler = async () => 'approved';

      // Collect events
      const events: DAGEvent[] = [];

      const executor = new DAGExecutor(dag, {
        llm: llm as any,
        projectDir: dir,
        templateId: 'narrative',
        dagId: 'test-narrative',
        maxConcurrency: 4,
        userInteraction: userHandler,
      });
      executor.on(e => events.push(e));

      const result = await executor.run();

      // === Assertions ===

      // Should complete without failures
      expect(result.completed).toBe(true);
      expect(result.stats.failed).toBe(0);

      // Should have expansion events (entities, scenes, shots)
      const expansionEvents = events.filter(e => e.type === 'expansion');
      expect(expansionEvents.length).toBeGreaterThanOrEqual(3);

      // Verify ordering: plot < story < entities
      const completedOrder = events
        .filter(e => e.type === 'node_completed')
        .map(e => (e as any).nodeId);

      const plotIdx = completedOrder.indexOf('generate_plot');
      const storyIdx = completedOrder.indexOf('generate_story');
      const entitiesIdx = completedOrder.indexOf('extract_entities');
      expect(plotIdx).toBeLessThan(storyIdx);
      expect(storyIdx).toBeLessThan(entitiesIdx);

      // Assembly nodes should exist and complete
      expect(dag.hasNode('validate_timeline')).toBe(true);
      expect(dag.hasNode('assemble')).toBe(true);
      expect(dag.getNode('validate_timeline').status).toBe('completed');
      expect(dag.getNode('assemble').status).toBe('completed');

      // Scene completion should come before assembly
      const sceneCompleteIdx = completedOrder.indexOf('scene_1_complete');
      const validateIdx = completedOrder.indexOf('validate_timeline');
      const assembleIdx = completedOrder.indexOf('assemble');
      expect(sceneCompleteIdx).toBeLessThan(validateIdx);
      expect(validateIdx).toBeLessThan(assembleIdx);

      // === Intermediate result verification ===

      // Story content reached the story node
      expect(dag.getNode('generate_story').result?.content).toBe(
        'Jan the farmer found a glowing stone in the village field.'
      );

      // Entity extraction produced parsed data
      const entityNode = dag.getNode('extract_entities');
      expect(entityNode.result?.content).toBe(entityJSON);

      // Character generation result stored correctly
      expect(dag.getNode('char_jan_generate').result?.content).toBe(
        'Jan is a tall farmer with brown hair.'
      );

      // Dynamic character nodes were created with correct metadata
      expect(dag.getNode('char_jan_generate').metadata?.['characterName']).toBe('Jan');
      expect(dag.getNode('char_jan_generate').metadata?.['role']).toBe('protagonist');

      // Shot nodes were created for both shots
      expect(dag.hasNode('scene_1_shot_1_img_prompt')).toBe(true);
      expect(dag.hasNode('scene_1_shot_2_img_prompt')).toBe(true);
      expect(dag.hasNode('scene_1_complete')).toBe(true);

      // Verify total node count is reasonable (static prefix + entities + scenes + shots + assembly)
      expect(result.stats.total).toBeGreaterThanOrEqual(25);

      // Characters before scenes ordering
      const charIdx = completedOrder.indexOf('char_jan_generate');
      const scenesIdx = completedOrder.indexOf('generate_scenes');
      expect(charIdx).toBeLessThan(scenesIdx);
    });
  }, 30000); // 30s timeout for this integration test
});

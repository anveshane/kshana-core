/**
 * Unit tests for the shot expander.
 */

import { describe, it, expect } from 'vitest';
import { buildShotNodes, validateShotBreakdown } from '../../../src/core/dag/expanders/shotExpander.js';
import { makeContext } from '../../helpers/dag/DAGTestHelpers.js';

describe('shotExpander', () => {
  // ===========================================================================
  // validateShotBreakdown
  // ===========================================================================

  describe('validateShotBreakdown', () => {
    it('valid shot breakdown passes', () => {
      const result = validateShotBreakdown({
        content: JSON.stringify({ shots: [{ shotNumber: 1, type: 'wide' }] }),
      });
      expect(result.valid).toBe(true);
      expect(result.data?.shots).toHaveLength(1);
    });

    it('missing content fails', () => {
      const result = validateShotBreakdown({});
      expect(result.valid).toBe(false);
    });

    it('empty shots array fails', () => {
      const result = validateShotBreakdown({ content: JSON.stringify({ shots: [] }) });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('shot missing shotNumber fails', () => {
      const result = validateShotBreakdown({
        content: JSON.stringify({ shots: [{ type: 'wide' }] }),
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('shotNumber');
    });

    it('non-JSON fails', () => {
      const result = validateShotBreakdown({ content: 'not json' });
      expect(result.valid).toBe(false);
    });
  });

  // ===========================================================================
  // buildShotNodes
  // ===========================================================================

  describe('buildShotNodes', () => {
    it('2 shots produce 9 nodes with correct IDs and types', () => {
      const shotData = { shots: [{ shotNumber: 1, type: 'wide' }, { shotNumber: 2, type: 'close' }] };
      const result = { content: JSON.stringify(shotData), data: shotData };
      const ctx = makeContext({}, { sceneNumber: 1 });

      const nodes = buildShotNodes(result, ctx);

      // 4 per shot (img_prompt, img, video, timeline) + 1 scene_complete = 9
      expect(nodes).toHaveLength(9);

      // Verify all expected node IDs exist
      const ids = nodes.map(n => n.id).sort();
      expect(ids).toContain('scene_1_shot_1_img_prompt');
      expect(ids).toContain('scene_1_shot_1_img');
      expect(ids).toContain('scene_1_shot_1_video');
      expect(ids).toContain('scene_1_shot_1_timeline');
      expect(ids).toContain('scene_1_shot_2_img_prompt');
      expect(ids).toContain('scene_1_complete');

      // Verify types
      expect(nodes.find(n => n.id === 'scene_1_shot_1_img_prompt')!.type).toBe('S');
      expect(nodes.find(n => n.id === 'scene_1_shot_1_timeline')!.type).toBe('D');
      expect(nodes.find(n => n.id === 'scene_1_complete')!.type).toBe('D');
    });

    it('single shot produces 5 nodes', () => {
      const shotData = { shots: [{ shotNumber: 1 }] };
      const result = { content: JSON.stringify(shotData), data: shotData };
      const ctx = makeContext({}, { sceneNumber: 2 });

      const nodes = buildShotNodes(result, ctx);
      expect(nodes).toHaveLength(5); // 4 per shot + 1 scene_complete
      expect(nodes.find(n => n.id === 'scene_2_complete')).toBeDefined();
    });

    it('dependency chain: img_prompt → img → video → timeline', () => {
      const shotData = { shots: [{ shotNumber: 1 }] };
      const result = { content: JSON.stringify(shotData), data: shotData };
      const ctx = makeContext({}, { sceneNumber: 1 });

      const nodes = buildShotNodes(result, ctx);

      const imgPrompt = nodes.find(n => n.id === 'scene_1_shot_1_img_prompt')!;
      const img = nodes.find(n => n.id === 'scene_1_shot_1_img')!;
      const video = nodes.find(n => n.id === 'scene_1_shot_1_video')!;
      const timeline = nodes.find(n => n.id === 'scene_1_shot_1_timeline')!;

      expect(imgPrompt.dependsOn).toContain('scene_1_approve_shots');
      expect(img.dependsOn).toContain('scene_1_shot_1_img_prompt');
      expect(video.dependsOn).toContain('scene_1_shot_1_img');
      expect(timeline.dependsOn).toContain('scene_1_shot_1_video');
    });

    it('scene_N_complete depends on all timeline nodes', () => {
      const shotData = { shots: [{ shotNumber: 1 }, { shotNumber: 2 }] };
      const result = { content: JSON.stringify(shotData), data: shotData };
      const ctx = makeContext({}, { sceneNumber: 3 });

      const nodes = buildShotNodes(result, ctx);
      const complete = nodes.find(n => n.id === 'scene_3_complete')!;

      expect(complete.dependsOn).toContain('scene_3_shot_1_timeline');
      expect(complete.dependsOn).toContain('scene_3_shot_2_timeline');
    });

    it('video nodes use micro_llm exhaustion policy', () => {
      const shotData = { shots: [{ shotNumber: 1 }] };
      const result = { content: JSON.stringify(shotData), data: shotData };
      const ctx = makeContext({}, { sceneNumber: 1 });

      const nodes = buildShotNodes(result, ctx);
      const video = nodes.find(n => n.id === 'scene_1_shot_1_video')!;

      expect(video.errorPolicy?.onExhausted).toBe('micro_llm');
    });
  });
});

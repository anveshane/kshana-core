/**
 * Unit tests for the scene expander.
 */

import { describe, it, expect } from 'vitest';
import { buildSceneNodes } from '../../../src/core/dag/expanders/sceneExpander.js';
import { makeContext } from '../../helpers/dag/DAGTestHelpers.js';

const entityData = {
  characters: [
    { name: 'Jan', role: 'protagonist', description: 'A farmer' },
  ],
  settings: [
    { name: 'Village', description: 'A quiet village' },
  ],
  scenes: [
    { number: 1, title: 'Morning', characters: ['Jan'], setting: 'Village', summary: 'Wakes up' },
    { number: 2, title: 'Evening', characters: ['Jan'], setting: 'Village', summary: 'Goes home' },
  ],
};

describe('sceneExpander', () => {
  it('2 scenes produce correct 8 nodes with expected IDs', () => {
    const ctx = makeContext({
      extract_entities: { content: JSON.stringify(entityData), data: entityData },
      generate_scenes: { content: 'scenes content' },
    });

    const nodes = buildSceneNodes({ content: 'approved' }, ctx);

    expect(nodes).toHaveLength(8);

    // Verify exact node IDs exist for both scenes
    const ids = nodes.map(n => n.id).sort();
    expect(ids).toEqual([
      'scene_1_approve_shots',
      'scene_1_expand_shots',
      'scene_1_shot_breakdown',
      'scene_1_split_timeline',
      'scene_2_approve_shots',
      'scene_2_expand_shots',
      'scene_2_shot_breakdown',
      'scene_2_split_timeline',
    ]);

    // Verify types
    expect(nodes.find(n => n.id === 'scene_1_shot_breakdown')!.type).toBe('S');
    expect(nodes.find(n => n.id === 'scene_1_approve_shots')!.type).toBe('U');
    expect(nodes.find(n => n.id === 'scene_1_split_timeline')!.type).toBe('D');
    expect(nodes.find(n => n.id === 'scene_1_expand_shots')!.type).toBe('D');
  });

  it('scene_N_shot_breakdown depends on approve_scenes + all ref image nodes', () => {
    const ctx = makeContext({
      extract_entities: { content: JSON.stringify(entityData), data: entityData },
      generate_scenes: { content: 'scenes content' },
    });

    const nodes = buildSceneNodes({ content: 'approved' }, ctx);
    const shotBreakdown = nodes.find(n => n.id === 'scene_1_shot_breakdown')!;

    expect(shotBreakdown.dependsOn).toContain('approve_scenes');
    expect(shotBreakdown.dependsOn).toContain('char_jan_img');
    expect(shotBreakdown.dependsOn).toContain('setting_village_img');
  });

  it('scene_N_expand_shots has expanderKey shot_expander', () => {
    const ctx = makeContext({
      extract_entities: { content: JSON.stringify(entityData), data: entityData },
    });

    const nodes = buildSceneNodes({ content: 'approved' }, ctx);
    const expandShots = nodes.find(n => n.id === 'scene_1_expand_shots')!;

    expect(expandShots.expanderKey).toBe('shot_expander');
  });

  it('each scene has correct metadata', () => {
    const ctx = makeContext({
      extract_entities: { content: JSON.stringify(entityData), data: entityData },
    });

    const nodes = buildSceneNodes({ content: 'approved' }, ctx);
    const scene2 = nodes.find(n => n.id === 'scene_2_shot_breakdown')!;

    expect(scene2.metadata?.['sceneNumber']).toBe(2);
  });
});

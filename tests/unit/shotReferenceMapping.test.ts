/**
 * TDD Tests for shot reference mapping.
 *
 * buildAvailableReferences gathers ALL completed character_image,
 * setting_image, and object_image nodes from the executor graph
 * and presents them as available references for the LLM.
 *
 * The LLM decides which to use — no per-shot filtering needed.
 */

import { describe, it, expect } from 'vitest';

// Helper to build a minimal mock executor
function mockExecutor(nodes: Array<{ id: string; typeId: string; itemId?: string; status: string; outputPath?: string }>) {
  return {
    getAllNodes: () => nodes.map(n => ({
      id: n.id,
      typeId: n.typeId,
      itemId: n.itemId ?? n.id.split(':')[1],
      status: n.status,
      outputPath: n.outputPath,
    })),
    getNode: (id: string) => {
      const found = nodes.find(n => n.id === id);
      if (!found) return undefined;
      return { ...found, itemId: found.itemId ?? found.id.split(':')[1] };
    },
  };
}

describe('Shot reference mapping: gather refs from executor graph', () => {
  it('includes all completed character_image nodes', async () => {
    const { buildAvailableReferences } = await import('../../src/core/planner/shotReferenceMapping.js');
    const executor = mockExecutor([
      { id: 'character_image:elena', typeId: 'character_image', status: 'completed', outputPath: 'assets/images/characters/elena.png' },
      { id: 'character_image:marcus', typeId: 'character_image', status: 'completed', outputPath: 'assets/images/characters/marcus.png' },
    ]);

    const result = buildAvailableReferences(executor as any);
    expect(result.refs).toHaveLength(2);
    expect(result.refs[0]).toMatchObject({ type: 'character', refId: 'character_image:elena', imageNumber: 1 });
    expect(result.refs[1]).toMatchObject({ type: 'character', refId: 'character_image:marcus', imageNumber: 2 });
  });

  it('excludes pending and failed nodes', async () => {
    const { buildAvailableReferences } = await import('../../src/core/planner/shotReferenceMapping.js');
    const executor = mockExecutor([
      { id: 'character_image:elena', typeId: 'character_image', status: 'completed', outputPath: 'assets/images/characters/elena.png' },
      { id: 'character_image:marcus', typeId: 'character_image', status: 'pending', outputPath: undefined },
      { id: 'setting_image:alley', typeId: 'setting_image', status: 'failed', outputPath: undefined },
    ]);

    const result = buildAvailableReferences(executor as any);
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].refId).toBe('character_image:elena');
  });

  it('includes setting_image and object_image nodes', async () => {
    const { buildAvailableReferences } = await import('../../src/core/planner/shotReferenceMapping.js');
    const executor = mockExecutor([
      { id: 'character_image:elena', typeId: 'character_image', status: 'completed', outputPath: 'assets/images/characters/elena.png' },
      { id: 'setting_image:alley', typeId: 'setting_image', status: 'completed', outputPath: 'assets/images/settings/alley.png' },
      { id: 'object_image:revolver', typeId: 'object_image', status: 'completed', outputPath: 'assets/images/objects/revolver.png' },
    ]);

    const result = buildAvailableReferences(executor as any);
    expect(result.refs).toHaveLength(3);
    expect(result.refs[0].type).toBe('character');
    expect(result.refs[1].type).toBe('setting');
    expect(result.refs[2].type).toBe('object');
  });

  it('assigns sequential image numbers starting at 1', async () => {
    const { buildAvailableReferences } = await import('../../src/core/planner/shotReferenceMapping.js');
    const executor = mockExecutor([
      { id: 'character_image:elena', typeId: 'character_image', status: 'completed', outputPath: 'a.png' },
      { id: 'character_image:marcus', typeId: 'character_image', status: 'completed', outputPath: 'b.png' },
      { id: 'setting_image:alley', typeId: 'setting_image', status: 'completed', outputPath: 'c.png' },
      { id: 'object_image:revolver', typeId: 'object_image', status: 'completed', outputPath: 'd.png' },
    ]);

    const result = buildAvailableReferences(executor as any);
    expect(result.refs.map(r => r.imageNumber)).toEqual([1, 2, 3, 4]);
  });

  it('returns empty refs when no completed ref nodes exist', async () => {
    const { buildAvailableReferences } = await import('../../src/core/planner/shotReferenceMapping.js');
    const executor = mockExecutor([
      { id: 'character_image:elena', typeId: 'character_image', status: 'pending' },
      { id: 'story:main', typeId: 'story', status: 'completed', outputPath: 'plans/story.md' },
    ]);

    const result = buildAvailableReferences(executor as any);
    expect(result.refs).toHaveLength(0);
  });

  it('excludes nodes without .png output path', async () => {
    const { buildAvailableReferences } = await import('../../src/core/planner/shotReferenceMapping.js');
    const executor = mockExecutor([
      { id: 'character_image:elena', typeId: 'character_image', status: 'completed', outputPath: 'assets/images/characters/elena.png' },
      { id: 'character_image:marcus', typeId: 'character_image', status: 'completed', outputPath: 'prompts/characters/marcus.json' },
    ]);

    const result = buildAvailableReferences(executor as any);
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].refId).toBe('character_image:elena');
  });
});

describe('Shot reference mapping: format for LLM', () => {
  it('formats as XML block with image numbers', async () => {
    const { formatReferencesForPrompt } = await import('../../src/core/planner/shotReferenceMapping.js');
    const refs = [
      { imageNumber: 1, type: 'character', refId: 'character_image:elena', label: 'elena' },
      { imageNumber: 2, type: 'setting', refId: 'setting_image:alley', label: 'alley' },
    ];
    const formatted = formatReferencesForPrompt(refs);

    expect(formatted).toContain('<available_references>');
    expect(formatted).toContain('image 1');
    expect(formatted).toContain('character');
    expect(formatted).toContain('"elena"');
    expect(formatted).toContain('image 2');
    expect(formatted).toContain('setting');
    expect(formatted).toContain('"alley"');
    expect(formatted).toContain('from image N');
  });

  it('returns no-refs message when refs array is empty', async () => {
    const { formatReferencesForPrompt } = await import('../../src/core/planner/shotReferenceMapping.js');
    const formatted = formatReferencesForPrompt([]);
    expect(formatted).toContain('No reference images available');
    expect(formatted).toContain('text_to_image');
  });
});

describe('Shot reference mapping: shot context hints', () => {
  it('first shot gets first-shot context', async () => {
    const { buildShotContextHint } = await import('../../src/core/planner/shotReferenceMapping.js');
    const hint = buildShotContextHint('scene_1_shot_1', false);
    expect(hint).toContain('Shot 1');
    expect(hint).toContain('first shot');
    expect(hint).not.toContain('edit_previous_shot');
  });

  it('shot 2+ with previous available gets edit_previous_shot hint', async () => {
    const { buildShotContextHint } = await import('../../src/core/planner/shotReferenceMapping.js');
    const hint = buildShotContextHint('scene_1_shot_3', true);
    expect(hint).toContain('Shot 3');
    expect(hint).toContain('edit_previous_shot');
  });

  it('shot 2+ without previous available does not suggest edit_previous_shot', async () => {
    const { buildShotContextHint } = await import('../../src/core/planner/shotReferenceMapping.js');
    const hint = buildShotContextHint('scene_1_shot_2', false);
    expect(hint).toContain('Shot 2');
    expect(hint).not.toContain('edit_previous_shot');
  });
});

describe('Shot reference mapping: filter refs by purpose', () => {
  const allRefs = [
    { imageNumber: 1, type: 'character' as const, refId: 'character_image:elena', label: 'elena' },
    { imageNumber: 2, type: 'character' as const, refId: 'character_image:marcus', label: 'marcus' },
    { imageNumber: 3, type: 'setting' as const, refId: 'setting_image:alley', label: 'alley' },
    { imageNumber: 4, type: 'object' as const, refId: 'object_image:revolver', label: 'revolver' },
  ];

  it('set_the_world returns only setting refs', async () => {
    const { filterRefsByPurpose } = await import('../../src/core/planner/shotReferenceMapping.js');
    const result = filterRefsByPurpose(allRefs, 'set_the_world');
    expect(result.refs).toHaveLength(1);
    expect(result.refs[0].type).toBe('setting');
    expect(result.generationMode).toBe('image_text_to_image');
  });

  it('set_the_mood returns empty refs with text_to_image', async () => {
    const { filterRefsByPurpose } = await import('../../src/core/planner/shotReferenceMapping.js');
    const result = filterRefsByPurpose(allRefs, 'set_the_mood');
    expect(result.refs).toHaveLength(0);
    expect(result.generationMode).toBe('text_to_image');
  });

  it('meet_character returns char + setting refs', async () => {
    const { filterRefsByPurpose } = await import('../../src/core/planner/shotReferenceMapping.js');
    const result = filterRefsByPurpose(allRefs, 'meet_character');
    expect(result.refs.map(r => r.type)).toEqual(['character', 'character', 'setting']);
    expect(result.generationMode).toBe('image_text_to_image');
  });

  it('show_dialogue returns char + setting refs', async () => {
    const { filterRefsByPurpose } = await import('../../src/core/planner/shotReferenceMapping.js');
    const result = filterRefsByPurpose(allRefs, 'show_dialogue');
    const types = result.refs.map(r => r.type);
    expect(types).toContain('character');
    expect(types).toContain('setting');
    expect(types).not.toContain('object');
  });

  it('show_clue returns empty refs with text_to_image', async () => {
    const { filterRefsByPurpose } = await import('../../src/core/planner/shotReferenceMapping.js');
    const result = filterRefsByPurpose(allRefs, 'show_clue');
    expect(result.refs).toHaveLength(0);
    expect(result.generationMode).toBe('text_to_image');
  });

  it('show_action returns all refs', async () => {
    const { filterRefsByPurpose } = await import('../../src/core/planner/shotReferenceMapping.js');
    const result = filterRefsByPurpose(allRefs, 'show_action');
    expect(result.refs).toHaveLength(4);
    expect(result.generationMode).toBe('image_text_to_image');
  });

  it('show_change returns all refs', async () => {
    const { filterRefsByPurpose } = await import('../../src/core/planner/shotReferenceMapping.js');
    const result = filterRefsByPurpose(allRefs, 'show_change');
    expect(result.refs).toHaveLength(4);
  });
});

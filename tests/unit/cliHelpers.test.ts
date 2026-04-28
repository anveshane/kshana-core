import { describe, it, expect } from 'vitest';
import { resolveNodeId, type ExecutorState, type ExecutionNode } from '../../scripts/cli-helpers.js';

function mkState(ids: string[]): ExecutorState {
  const nodes: Record<string, ExecutionNode> = {};
  for (const id of ids) {
    const [typeId, itemId] = id.split(':');
    nodes[id] = {
      id,
      typeId: typeId!,
      itemId,
      status: 'completed',
      dependencies: [],
    };
  }
  return { nodes };
}

describe('resolveNodeId — friendly alias resolution for CLI', () => {
  const state = mkState([
    'character:elara',
    'setting:hut',
    'scene:scene_2',
    'scene_video_prompt:scene_2',
    'shot_image_prompt:scene_2_shot_3',
    'shot_image:scene_2_shot_3',
    'shot_motion_directive:scene_2_shot_3',
    'shot_video:scene_2_shot_3',
  ]);

  it('returns verbatim node ids unchanged when they exist', () => {
    expect(resolveNodeId(state, 'shot_image_prompt:scene_2_shot_3'))
      .toBe('shot_image_prompt:scene_2_shot_3');
  });

  it('resolves .prompt suffix to shot_image_prompt', () => {
    expect(resolveNodeId(state, 'scene_2_shot_3.prompt'))
      .toBe('shot_image_prompt:scene_2_shot_3');
  });

  it('resolves .image suffix to shot_image', () => {
    expect(resolveNodeId(state, 'scene_2_shot_3.image'))
      .toBe('shot_image:scene_2_shot_3');
  });

  it('resolves .video suffix to shot_video', () => {
    expect(resolveNodeId(state, 'scene_2_shot_3.video'))
      .toBe('shot_video:scene_2_shot_3');
  });

  it('resolves .motion suffix to shot_motion_directive', () => {
    expect(resolveNodeId(state, 'scene_2_shot_3.motion'))
      .toBe('shot_motion_directive:scene_2_shot_3');
  });

  it('resolves .svp suffix to scene_video_prompt', () => {
    expect(resolveNodeId(state, 'scene_2.svp'))
      .toBe('scene_video_prompt:scene_2');
  });

  it('resolves .scene suffix to scene', () => {
    expect(resolveNodeId(state, 'scene_2.scene'))
      .toBe('scene:scene_2');
  });

  it('resolves a bare itemId to character first when ambiguous', () => {
    expect(resolveNodeId(state, 'elara')).toBe('character:elara');
  });

  it('resolves a bare itemId to setting when no character matches', () => {
    expect(resolveNodeId(state, 'hut')).toBe('setting:hut');
  });

  it('returns null when nothing matches', () => {
    expect(resolveNodeId(state, 'nonexistent')).toBeNull();
    expect(resolveNodeId(state, 'scene_99.svp')).toBeNull();
  });

  it('returns null for explicit typeId:itemId form when node missing', () => {
    expect(resolveNodeId(state, 'shot_image:scene_99_shot_1')).toBeNull();
  });

  it('handles aliases with a typeId-name suffix as well as the short form', () => {
    expect(resolveNodeId(state, 'scene_2_shot_3.shot_image_prompt'))
      .toBe('shot_image_prompt:scene_2_shot_3');
    expect(resolveNodeId(state, 'scene_2.scene_video_prompt'))
      .toBe('scene_video_prompt:scene_2');
  });
});

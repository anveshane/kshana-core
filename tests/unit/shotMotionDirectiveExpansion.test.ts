/**
 * Regression: scene-level shot_motion_directive nodes stored with a stale
 * `isCollection: false` flag must still be recognized as expandable to
 * per-shot children.
 *
 * Bug: noir_detective_story_setup-3 was persisted with
 *   shot_motion_directive:scene_1  { itemId: "scene_1", isCollection: false,
 *                                    status: "completed",
 *                                    outputPath: "prompts/motion/scene_1.json" }
 * even though the template defines `isCollection: true` with per-shot
 * `{{subindex}}` filePattern. Expansion at
 * ExecutorAgent.ts:expandPendingCollections gated on `node.isCollection`
 * and so skipped these nodes — every shot in a scene ended up reading the
 * same single scene-wide motion file. The guard must treat the template's
 * `isCollection` as authoritative so stale saved state cannot silently
 * block per-shot expansion.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldExpandSceneCollectionToShots,
} from '../../src/core/planner/collectionExpansion.js';
import type { ExecutionNode } from '../../src/core/planner/types.js';

const template = {
  id: 'test',
  name: 'Test',
  version: '1.0',
  description: '',
  artifactTypes: {
    shot_motion_directive: {
      id: 'shot_motion_directive',
      displayName: 'Shot Motion Directives',
      category: 'structure',
      isCollection: true,
      isExpensive: false,
      dependencies: [
        { artifactTypeId: 'scene_video_prompt', required: true, usage: 'context', scope: 'matching' },
      ],
    },
    shot_image_prompt: {
      id: 'shot_image_prompt',
      displayName: 'Shot Composition',
      category: 'structure',
      isCollection: true,
      isExpensive: false,
      dependencies: [],
    },
    scene_video_prompt: {
      id: 'scene_video_prompt',
      displayName: 'Scene Video Prompt',
      category: 'structure',
      isCollection: true,
      isExpensive: false,
      dependencies: [],
    },
    some_scalar: {
      id: 'some_scalar',
      displayName: 'Scalar',
      category: 'structure',
      isCollection: false,
      isExpensive: false,
      dependencies: [],
    },
  },
  phases: [],
  constraints: {},
  contextVariables: {},
} as any;

function node(partial: Partial<ExecutionNode>): ExecutionNode {
  return {
    id: partial.id ?? 'x',
    typeId: partial.typeId ?? 'shot_motion_directive',
    status: partial.status ?? 'pending',
    displayName: partial.displayName ?? 'x',
    isExpensive: false,
    isCollection: partial.isCollection ?? false,
    dependencies: [],
    dependents: [],
    itemId: partial.itemId,
    ...partial,
  } as ExecutionNode;
}

describe('shouldExpandSceneCollectionToShots', () => {
  it('returns true for stored isCollection=false when template says isCollection=true (the noir bug)', () => {
    const n = node({
      id: 'shot_motion_directive:scene_1',
      typeId: 'shot_motion_directive',
      itemId: 'scene_1',
      isCollection: false, // stale stored flag
      status: 'completed',
    });
    expect(shouldExpandSceneCollectionToShots(n, template)).toBe(true);
  });

  it('returns true for well-formed collection parent', () => {
    const n = node({
      id: 'shot_motion_directive:scene_1',
      typeId: 'shot_motion_directive',
      itemId: 'scene_1',
      isCollection: true,
      status: 'pending',
    });
    expect(shouldExpandSceneCollectionToShots(n, template)).toBe(true);
  });

  it('returns false for per-shot nodes (already expanded)', () => {
    const n = node({
      id: 'shot_motion_directive:scene_1_shot_3',
      typeId: 'shot_motion_directive',
      itemId: 'scene_1_shot_3',
      isCollection: false,
      status: 'completed',
    });
    expect(shouldExpandSceneCollectionToShots(n, template)).toBe(false);
  });

  it('returns false for type-level nodes (handled by a different expansion pass)', () => {
    const n = node({
      id: 'shot_motion_directive',
      typeId: 'shot_motion_directive',
      itemId: undefined,
      isCollection: true,
      status: 'pending',
    });
    expect(shouldExpandSceneCollectionToShots(n, template)).toBe(false);
  });

  it('returns false when template says the type is not a collection', () => {
    const n = node({
      id: 'some_scalar:scene_1',
      typeId: 'some_scalar',
      itemId: 'scene_1',
      isCollection: true, // caller mislabeled — template wins
      status: 'pending',
    });
    expect(shouldExpandSceneCollectionToShots(n, template)).toBe(false);
  });

  it('returns false for non-expandable typeIds', () => {
    const n = node({
      id: 'scene_video_prompt:scene_1',
      typeId: 'scene_video_prompt',
      itemId: 'scene_1',
      isCollection: true,
      status: 'completed',
    });
    expect(shouldExpandSceneCollectionToShots(n, template)).toBe(false);
  });

  it('accepts all four shot-level expandable types', () => {
    const types = ['shot_image_prompt', 'shot_motion_directive', 'shot_image', 'shot_video'];
    for (const t of types) {
      const n = node({
        id: `${t}:scene_1`,
        typeId: t,
        itemId: 'scene_1',
        isCollection: false, // stale
        status: 'completed',
      });
      // Only expand the types whose template says isCollection=true.
      const shouldExpand = template.artifactTypes[t]?.isCollection === true;
      expect(shouldExpandSceneCollectionToShots(n, template)).toBe(shouldExpand);
    }
  });
});

/**
 * TDD Tests for serial mode deadlock prevention.
 *
 * Deadlock: serial mode blocks media (character_image) until all content finishes.
 * But scene_video_prompt (content) depends on character_image (media).
 * Content waits for media. Media waits for content. Deadlock.
 *
 * Fix: serial mode should allow media nodes that are DEPENDENCIES of
 * pending content nodes to proceed. Or: content nodes should not depend
 * on media nodes in the template (scene_video_prompt shouldn't need
 * character_image — it only needs the scene text, not the actual image).
 */

import { describe, it, expect } from 'vitest';

describe('Serial mode deadlock: content depending on media', () => {
  it('scene_video_prompt should NOT depend on character_image or setting_image', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const svp = types['scene_video_prompt'];
    expect(svp).toBeDefined();

    const deps = svp.dependencies.map((d: any) => d.artifactTypeId);
    // scene_video_prompt should depend on scene + world_style only
    // NOT on character_image or setting_image (those are media nodes)
    expect(deps).not.toContain('character_image');
    expect(deps).not.toContain('setting_image');
  });

  it('scene_video_prompt depends on scene (matching scope)', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const svp = types['scene_video_prompt'];

    const sceneDep = svp.dependencies.find((d: any) => d.artifactTypeId === 'scene');
    expect(sceneDep).toBeDefined();
    expect(sceneDep.scope).toBe('matching');
  });
});

describe('Serial mode deadlock: dangling type-level deps after expansion', () => {
  it('validateNoDanglingDeps catches type-level dep pointing to non-existent node', async () => {
    const { validateNoDanglingDeps } = await import('../../src/core/planner/shotReferenceMapping.js');

    // After expansion: scene_video_prompt:scene_1 depends on 'scene' (type-level)
    // but 'scene' was expanded into scene:scene_1 — the type-level node is gone
    const nodes = {
      'scene:scene_1': { id: 'scene:scene_1', dependencies: [] },
      'scene_video_prompt:scene_1': { id: 'scene_video_prompt:scene_1', dependencies: ['scene', 'world_style'] },
      'world_style': { id: 'world_style', dependencies: [] },
    };

    const orphans = validateNoDanglingDeps(nodes);
    expect(orphans.length).toBeGreaterThan(0);
    expect(orphans[0].missingDep).toBe('scene');
  });
});

/**
 * Narrative template registration for the story_essence artifact.
 *
 * The artifact must be present in artifactTypes so the executor can
 * instantiate a `story_essence` node when the graph is built. And it
 * must be wired as a context dep on character / setting / scene so it
 * runs BEFORE the hierarchical extractor fires during expansion.
 */
import { describe, it, expect } from 'vitest';
import { narrativeTemplate } from '../../src/templates/narrative.js';

describe('narrative template — story_essence registration', () => {
  it('registers story_essence in artifactTypes', () => {
    const t = narrativeTemplate.artifactTypes;
    expect(t['story_essence']).toBeDefined();
    expect(t['story_essence']!.id).toBe('story_essence');
    expect(t['story_essence']!.outputFormat).toBe('json');
    expect(t['story_essence']!.filePattern).toBe('prompts/story_essence.json');
  });

  it('story_essence depends on story (and story alone)', () => {
    const a = narrativeTemplate.artifactTypes['story_essence']!;
    expect(a.dependencies.map(d => d.artifactTypeId)).toEqual(['story']);
  });

  it('character declares a story_essence context dep so essence runs first', () => {
    const c = narrativeTemplate.artifactTypes['character']!;
    const depTypes = c.dependencies.map(d => d.artifactTypeId);
    expect(depTypes).toContain('story_essence');
  });

  it('setting declares a story_essence context dep', () => {
    const s = narrativeTemplate.artifactTypes['setting']!;
    const depTypes = s.dependencies.map(d => d.artifactTypeId);
    expect(depTypes).toContain('story_essence');
  });

  it('scene declares a story_essence context dep', () => {
    const s = narrativeTemplate.artifactTypes['scene']!;
    const depTypes = s.dependencies.map(d => d.artifactTypeId);
    expect(depTypes).toContain('story_essence');
  });
});

import { describe, expect, it } from 'vitest';

import { resolveGenerateContentOutputFile } from '../../src/core/agent/generateContentPath.js';

describe('resolveGenerateContentOutputFile', () => {
  it('uses explicit output_file when provided', () => {
    expect(
      resolveGenerateContentOutputFile({
        contentType: 'scene',
        instruction: 'Create a scene outline.',
        outputFile: 'plans/scenes-outline.md',
      })
    ).toBe('plans/scenes-outline.md');
  });

  it('extracts a save path from the instruction when present', () => {
    expect(
      resolveGenerateContentOutputFile({
        contentType: 'scene',
        instruction:
          'Create a scene outline (5-8 key scenes with short titles and beats). Save the outline to plans/scenes-outline.md. Do NOT write full scene descriptions yet.',
      })
    ).toBe('plans/scenes-outline.md');
  });

  it('falls back to numbered scene files for scene content', () => {
    expect(
      resolveGenerateContentOutputFile({
        contentType: 'scene',
        instruction: 'Create scene 3.',
        sceneNumber: 3,
      })
    ).toBe('plans/scenes/scene-3.md');
  });

  it('infers numbered scene motion output files from the instruction text', () => {
    expect(
      resolveGenerateContentOutputFile({
        contentType: 'scene_video_prompt',
        instruction: 'Create a multi-shot motion prompt breakdown for Scene 2: The Arrival.',
      })
    ).toBe('prompts/videos/scenes/scene-2.motion.json');
  });

  it('does not hijack scene motion output from example reference image paths', () => {
    expect(
      resolveGenerateContentOutputFile({
        contentType: 'scene_video_prompt',
        instruction:
          'Create a multi-shot motion prompt breakdown for Scene 1. referenceImages example: ["characters/elara.md", "settings/abandoned_oil_well_surface_.profile.md"]',
      })
    ).toBe('prompts/videos/scenes/scene-1.motion.json');
  });

  it('only extracts custom paths when the instruction explicitly says save to', () => {
    expect(
      resolveGenerateContentOutputFile({
        contentType: 'scene',
        instruction:
          'Create a scene outline and save it to plans/scenes-outline.md for later editing.',
      })
    ).toBe('plans/scenes-outline.md');
  });

  it('keeps directory defaults only when no filename can be inferred', () => {
    expect(
      resolveGenerateContentOutputFile({
        contentType: 'scene',
        instruction: 'Create a scene.',
      })
    ).toBe('plans/scenes/');
  });
});

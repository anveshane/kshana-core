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

  it('keeps directory defaults only when no filename can be inferred', () => {
    expect(
      resolveGenerateContentOutputFile({
        contentType: 'scene',
        instruction: 'Create a scene.',
      })
    ).toBe('plans/scenes/');
  });
});

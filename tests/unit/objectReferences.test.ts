/**
 * TDD Tests for Object/Prop References (Change 3)
 *
 * Distinctive objects (hover-car, weapons, scrolls, props) need reference
 * images just like characters and settings, so they stay visually consistent
 * across shots.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// ──────────────────────────────────────────────────────────────────────────────
// Template: object artifact types exist
// ──────────────────────────────────────────────────────────────────────────────

describe('Object references: template definition', () => {
  it('narrative template has an "object" artifact type', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const objectType = types['object'];
    expect(objectType).toBeDefined();
    expect(objectType.isCollection).toBe(true);
    expect(objectType.category).toBe('entity');
  });

  it('narrative template has an "object_image" artifact type', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const objectImageType = types['object_image'];
    expect(objectImageType).toBeDefined();
    expect(objectImageType.category).toBe('visual_ref');
    expect(objectImageType.isExpensive).toBe(true);
  });

  it('object depends on story', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const objectType = types['object'];
    const storyDep = objectType.dependencies.find((d: any) => d.artifactTypeId === 'story');
    expect(storyDep).toBeDefined();
  });

  it('object_image depends on object and world_style', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const objectImageType = types['object_image'];
    const objectDep = objectImageType.dependencies.find((d: any) => d.artifactTypeId === 'object');
    const styleDep = objectImageType.dependencies.find((d: any) => d.artifactTypeId === 'world_style');
    expect(objectDep).toBeDefined();
    expect(styleDep).toBeDefined();
  });

  it('shot_image depends on object_image (all scope)', async () => {
    const { narrativeTemplate } = await import('../../src/templates/narrative.js');
    const types = narrativeTemplate.artifactTypes as Record<string, any>;
    const shotImageType = types['shot_image'];
    const objectImageDep = shotImageType.dependencies.find((d: any) => d.artifactTypeId === 'object_image');
    expect(objectImageDep).toBeDefined();
    expect(objectImageDep.scope).toBe('all');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Schema: collection extraction includes objects
// ──────────────────────────────────────────────────────────────────────────────

describe('Object references: schema', () => {
  it('collectionExtractionSchema accepts objects array', async () => {
    const { collectionExtractionSchema } = await import('../../src/core/planner/schemas.js');
    const result = collectionExtractionSchema.safeParse({
      characters: ['kai', 'aria'],
      settings: ['village_square'],
      objects: ['hover_car', 'lazarus_drive'],
      scenes: [{ sceneNumber: 1, title: 'Opening' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objects).toEqual(['hover_car', 'lazarus_drive']);
    }
  });

  it('collectionExtractionSchema defaults objects to empty array', async () => {
    const { collectionExtractionSchema } = await import('../../src/core/planner/schemas.js');
    const result = collectionExtractionSchema.safeParse({
      characters: ['kai'],
      settings: [],
      scenes: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objects).toEqual([]);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Shot image guide: references can include objects
// ──────────────────────────────────────────────────────────────────────────────

describe('Object references: prompt guides', () => {
  it('shot_image_guide mentions object references', () => {
    const guide = readFileSync(
      join(process.cwd(), 'prompts/skills/defaults/shot_image_guide.md'),
      'utf-8',
    );
    expect(guide).toMatch(/object|prop/i);
  });

  it('reference schema type includes "object"', async () => {
    const { validateWithSchema } = await import('../../src/core/planner/schemas.js');
    // Multi-frame format with object reference should validate
    const result = validateWithSchema('shot_image_prompt', {
      shotNumber: 1,
      frames: {
        first_frame: {
          imagePrompt: 'A wide shot with a hover-car in frame',
          generationMode: 'image_text_to_image',
          references: [
            { imageNumber: 1, type: 'object', refId: 'object_image:hover_car' },
          ],
        },
      },
      negativePrompt: '',
      aspectRatio: '16:9',
    });
    expect(result.valid).toBe(true);
  });
});

/**
 * Red-Green TDD for buildShotAwareReferences.
 *
 * Replaces the global "all refs in the project" approach for shot_image_prompt
 * generation. The Flux Klein workflow has 4 input slots; image 1 is the base
 * (setting), images 2-4 are characters/objects layered on top.
 *
 * Bugs we are fixing (evidenced by The Village & Out of this world):
 *   - Shot 2.2: "young woman walking through the forest from image 8" — image
 *     numbers exceed Flux's 4-slot cap; protagonist missing from references[].
 *   - Shot 2.3: two settings simultaneously ("forest from image 2" AND
 *     "forest edge from image 1") — wastes the slot budget.
 *
 * The helper is pure: given (allRefs, shotContext) → produces a 0..4-length
 * list where image 1 is the setting (when one exists), images 2+ are
 * characters/objects, prioritising mainSubject.
 */

import { describe, it, expect } from 'vitest';

const allRefsFixture = [
  { imageNumber: 1, type: 'character' as const, refId: 'character_image:protagonist', label: 'protagonist' },
  { imageNumber: 2, type: 'character' as const, refId: 'character_image:officer', label: 'officer' },
  { imageNumber: 3, type: 'character' as const, refId: 'character_image:sister', label: 'sister' },
  { imageNumber: 4, type: 'character' as const, refId: 'character_image:mc', label: 'mc' },
  { imageNumber: 5, type: 'setting' as const, refId: 'setting_image:forest', label: 'forest' },
  { imageNumber: 6, type: 'setting' as const, refId: 'setting_image:forest_edge', label: 'forest_edge' },
  { imageNumber: 7, type: 'setting' as const, refId: 'setting_image:underground_tunnel', label: 'underground_tunnel' },
  { imageNumber: 8, type: 'setting' as const, refId: 'setting_image:outside_the_wall', label: 'outside_the_wall' },
  { imageNumber: 9, type: 'setting' as const, refId: 'setting_image:trap_door', label: 'trap_door' },
];

describe('buildShotAwareReferences: setting in slot 1, capped at 4', () => {
  it('renumbers refs locally starting at imageNumber 1 (Flux 4-slot cap)', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      focusPrimary: 'protagonist',
      focusBackground: ['forest'],
      purpose: 'show_passage',
    });

    expect(result.length).toBeLessThanOrEqual(4);
    expect(result.map(r => r.imageNumber)).toEqual(
      Array.from({ length: result.length }, (_, i) => i + 1),
    );
  });

  it('places the setting in image 1 when a setting is present', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      focusPrimary: 'protagonist',
      focusBackground: ['forest'],
      purpose: 'show_passage',
    });

    const slot1 = result.find(r => r.imageNumber === 1);
    expect(slot1?.type).toBe('setting');
    expect(slot1?.label).toBe('forest');
  });

  it('includes mainSubject even for show_passage (Village 2.2 regression)', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      focusPrimary: 'protagonist',
      focusBackground: ['forest'],
      purpose: 'show_passage',
    });

    expect(result.find(r => r.label === 'protagonist')).toBeDefined();
  });

  it('places characters in slots 2..4 (after setting in slot 1)', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      secondarySubject: 'officer',
      focusPrimary: 'officer',
      focusBackground: ['protagonist', 'forest_edge'],
      purpose: 'show_action',
    });

    expect(result[0]?.type).toBe('setting');
    for (const r of result.slice(1)) {
      expect(r.type === 'character' || r.type === 'object').toBe(true);
    }
  });

  it('caps total references at 4 even when many candidates exist', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      secondarySubject: 'officer',
      focusPrimary: 'protagonist',
      focusBackground: ['officer', 'sister', 'mc', 'forest'],
      purpose: 'show_action',
    });

    expect(result.length).toBeLessThanOrEqual(4);
  });

  it('keeps mainSubject when capping (drops non-mainSubject chars first)', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      focusPrimary: 'protagonist',
      focusBackground: ['officer', 'sister', 'mc', 'forest'],
      purpose: 'show_action',
    });

    expect(result.find(r => r.label === 'protagonist')).toBeDefined();
  });
});

describe('buildShotAwareReferences: at most 1 setting per shot', () => {
  it('keeps only one setting when focus.background lists multiple (Village 2.3 regression)', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      secondarySubject: 'officer',
      focusPrimary: 'officer',
      focusBackground: ['protagonist', 'forest_edge', 'forest'],
      purpose: 'show_action',
    });

    const settings = result.filter(r => r.type === 'setting');
    expect(settings).toHaveLength(1);
  });

  it('prefers focus.primary as the setting when it is itself a setting', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      focusPrimary: 'forest_edge',
      focusBackground: ['protagonist', 'forest'],
      purpose: 'show_passage',
    });

    const setting = result.find(r => r.type === 'setting');
    expect(setting?.label).toBe('forest_edge');
  });

  it('falls back to first focus.background setting when focus.primary is a character', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      focusPrimary: 'protagonist',
      focusBackground: ['forest', 'forest_edge'],
      purpose: 'show_passage',
    });

    const setting = result.find(r => r.type === 'setting');
    expect(setting?.label).toBe('forest');
  });
});

describe('buildShotAwareReferences: shot-scope filtering', () => {
  it('excludes refs not named in this shot (no leaking unrelated settings)', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      focusPrimary: 'protagonist',
      focusBackground: ['forest'],
      purpose: 'show_passage',
    });

    expect(result.find(r => r.label === 'underground_tunnel')).toBeUndefined();
    expect(result.find(r => r.label === 'outside_the_wall')).toBeUndefined();
    expect(result.find(r => r.label === 'trap_door')).toBeUndefined();
    expect(result.find(r => r.label === 'mc')).toBeUndefined();
    expect(result.find(r => r.label === 'sister')).toBeUndefined();
  });

  it('falls back to allRefs (capped) when shot context has no subjects/focus', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      purpose: 'show_action',
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(4);
  });
});

describe('buildShotAwareReferences: text_to_image purposes return empty', () => {
  it('set_the_mood returns empty (mood/sensory shot, no refs)', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      focusPrimary: 'rain_drop',
      purpose: 'set_the_mood',
    });

    expect(result).toHaveLength(0);
  });
});

describe('buildShotAwareReferences: no setting case', () => {
  it('when shot has no setting, slot 1 holds mainSubject (character)', async () => {
    const { buildShotAwareReferences } = await import('../../src/core/planner/shotReferenceMapping.js');

    const result = buildShotAwareReferences(allRefsFixture, {
      mainSubject: 'protagonist',
      focusPrimary: 'protagonist',
      focusBackground: [],
      purpose: 'hold_emotion',
    });

    expect(result[0]?.label).toBe('protagonist');
    expect(result[0]?.imageNumber).toBe(1);
  });
});

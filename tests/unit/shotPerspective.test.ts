/**
 * Tests for shot perspective, focus, and continuity fields in scene_video_prompt.
 */

import { describe, it, expect } from 'vitest';
import { validateWithSchema, getPromptSchema, normalizeShotImagePrompt } from '../../src/core/planner/schemas.js';

// Minimal valid shot (has description, purpose not action/meet — no perspective required)
function baseShot(overrides: Record<string, unknown> = {}) {
  return {
    shotNumber: 1,
    description: 'A rainy street at night.',
    cameraWork: 'wide establishing, static',
    purpose: 'set_the_world',
    duration: 4,
    audio: 'rain and thunder',
    transition: 'cut',
    ...overrides,
  };
}

function baseSVP(shots: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    sceneNumber: 1,
    sceneTitle: 'The Dhaba',
    totalDuration: 30,
    shots,
    ...overrides,
  };
}

describe('scene_video_prompt: perspective', () => {
  it('accepts a shot with perspective=main_subject when mainSubject is declared', () => {
    const svp = baseSVP(
      [baseShot({ purpose: 'show_action', perspective: 'main_subject' })],
      { mainSubject: 'vikram' },
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });

  it('rejects show_action shot without perspective', () => {
    const svp = baseSVP(
      [baseShot({ purpose: 'show_action' })],
      { mainSubject: 'vikram' },
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(false);
  });

  it('rejects meet_character shot without perspective', () => {
    const svp = baseSVP(
      [baseShot({ purpose: 'meet_character' })],
      { mainSubject: 'vikram' },
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(false);
  });

  it('accepts show_dialogue shot without perspective (perspective optional for this purpose)', () => {
    const svp = baseSVP(
      [baseShot({ purpose: 'show_dialogue' })],
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });

  it('rejects main_subject perspective when scene lacks mainSubject', () => {
    const svp = baseSVP(
      [baseShot({ purpose: 'show_action', perspective: 'main_subject' })],
      // no mainSubject
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(false);
  });

  it('rejects secondary_subject perspective when scene lacks secondarySubject', () => {
    const svp = baseSVP(
      [baseShot({ purpose: 'show_action', perspective: 'secondary_subject' })],
      { mainSubject: 'vikram' },
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(false);
  });

  it('accepts overhead perspective without requiring mainSubject', () => {
    const svp = baseSVP(
      [baseShot({ purpose: 'show_action', perspective: 'overhead' })],
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });

  it('accepts all 5 perspective values', () => {
    for (const p of ['main_subject', 'secondary_subject', 'overhead', 'god', 'observer']) {
      const needsSubjects = p === 'main_subject' || p === 'secondary_subject';
      const svp = baseSVP(
        [baseShot({ purpose: 'show_action', perspective: p })],
        needsSubjects
          ? { mainSubject: 'vikram', secondarySubject: 'laila' }
          : {},
      );
      const result = validateWithSchema('scene_video_prompt', svp);
      expect(result.valid, `perspective=${p} should validate`).toBe(true);
    }
  });

  it('rejects unknown perspective value', () => {
    const svp = baseSVP(
      [baseShot({ purpose: 'show_action', perspective: 'aliens_pov' })],
      { mainSubject: 'vikram' },
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(false);
  });
});

describe('scene_video_prompt: focus', () => {
  it('accepts a shot with focus.primary only', () => {
    const svp = baseSVP([baseShot({ focus: { primary: 'vikram_face' } })]);
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });

  it('accepts a shot with full focus object (primary + background + lurking)', () => {
    const svp = baseSVP([baseShot({
      focus: {
        primary: 'laila_hand',
        background: ['bronze_seal', 'vikram_shoulder'],
        lurking: 'cloaked_figure',
      },
    })]);
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });

  it('rejects focus without primary', () => {
    const svp = baseSVP([baseShot({ focus: { background: ['x'] } as unknown })]);
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(false);
  });

  it('rejects focus.primary empty string', () => {
    const svp = baseSVP([baseShot({ focus: { primary: '' } })]);
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(false);
  });
});

describe('scene_video_prompt: continuityRole', () => {
  it('accepts all 4 continuityRole values', () => {
    for (const r of ['entry', 'exit', 'bridge', 'none']) {
      const svp = baseSVP([baseShot({ continuityRole: r })]);
      const result = validateWithSchema('scene_video_prompt', svp);
      expect(result.valid, `continuityRole=${r} should validate`).toBe(true);
    }
  });

  it('defaults continuityRole to "none" when omitted', () => {
    const svp = baseSVP([baseShot()]);
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
    if (result.valid) {
      const data = result.data as { shots: { continuityRole?: string }[] };
      expect(data.shots[0]!.continuityRole).toBe('none');
    }
  });

  it('rejects unknown continuityRole', () => {
    const svp = baseSVP([baseShot({ continuityRole: 'teleport' })]);
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(false);
  });
});

describe('scene_video_prompt: mainSubject / secondarySubject', () => {
  it('accepts scene with only mainSubject', () => {
    const svp = baseSVP([baseShot()], { mainSubject: 'vikram' });
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });

  it('accepts scene with mainSubject + secondarySubject', () => {
    const svp = baseSVP(
      [baseShot()],
      { mainSubject: 'vikram', secondarySubject: 'laila' },
    );
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });

  it('accepts scene without mainSubject (backward compat)', () => {
    const svp = baseSVP([baseShot()]);
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });
});

describe('scene_video_prompt: backward compatibility', () => {
  it('legacy shot without perspective/focus/continuityRole still validates when purpose allows', () => {
    const svp = baseSVP([
      baseShot({ purpose: 'show_dialogue' }),
      baseShot({ shotNumber: 2, purpose: 'show_reaction' }),
    ]);
    const result = validateWithSchema('scene_video_prompt', svp);
    expect(result.valid).toBe(true);
  });
});

describe('normalizeShotImagePrompt: edit-mode reference inheritance', () => {
  it('inherits first_frame refs into empty last_frame with edit_first_frame', () => {
    const refs = [
      { imageNumber: 1, type: 'character', refId: 'character_image:vikram' },
      { imageNumber: 4, type: 'setting', refId: 'setting_image:dhaba' },
    ];
    const p = {
      frames: {
        first_frame: { generationMode: 'image_text_to_image', references: refs },
        last_frame: { generationMode: 'edit_first_frame', references: [] },
      },
    };
    normalizeShotImagePrompt(p);
    expect(p.frames.last_frame.references).toEqual(refs);
  });

  it('inherits first_frame refs into edit_previous_shot first_frame (if somehow empty)', () => {
    const refs = [{ imageNumber: 1, type: 'character', refId: 'character_image:vikram' }];
    const p = {
      frames: {
        first_frame: {
          generationMode: 'edit_previous_shot',
          references: [],
        },
        other_frame: {
          generationMode: 'image_text_to_image',
          references: refs,
        },
      },
    };
    // Won't inherit because we only inherit FROM first_frame INTO other frames
    normalizeShotImagePrompt(p);
    expect(p.frames.first_frame.references).toEqual([]);
  });

  it('MERGES existing last_frame refs with first_frame refs (new character scenario)', () => {
    // last_frame introduces Laila as a new character — keep her AND inherit Vikram from first_frame
    const firstRefs = [
      { imageNumber: 1, type: 'character', refId: 'character_image:vikram' },
      { imageNumber: 4, type: 'setting', refId: 'setting_image:dhaba' },
    ];
    const lastRefs = [{ imageNumber: 2, type: 'character', refId: 'character_image:laila' }];
    const p = {
      frames: {
        first_frame: { generationMode: 'image_text_to_image', references: firstRefs },
        last_frame: { generationMode: 'edit_first_frame', references: lastRefs },
      },
    };
    normalizeShotImagePrompt(p);
    // Explicit (laila) first, then inherited (vikram, dhaba) — no dups
    expect(p.frames.last_frame.references).toHaveLength(3);
    expect(p.frames.last_frame.references[0]!.refId).toBe('character_image:laila');
    const ids = p.frames.last_frame.references.map((r: any) => r.refId);
    expect(ids).toContain('character_image:vikram');
    expect(ids).toContain('setting_image:dhaba');
  });

  it('dedupes by refId when explicit last_frame ref overlaps with first_frame', () => {
    // If last_frame explicitly lists vikram too, don't duplicate
    const firstRefs = [
      { imageNumber: 1, type: 'character', refId: 'character_image:vikram' },
      { imageNumber: 4, type: 'setting', refId: 'setting_image:dhaba' },
    ];
    const lastRefs = [
      { imageNumber: 1, type: 'character', refId: 'character_image:vikram' },
      { imageNumber: 2, type: 'character', refId: 'character_image:laila' },
    ];
    const p = {
      frames: {
        first_frame: { generationMode: 'image_text_to_image', references: firstRefs },
        last_frame: { generationMode: 'edit_first_frame', references: lastRefs },
      },
    };
    normalizeShotImagePrompt(p);
    const ids = p.frames.last_frame.references.map((r: any) => r.refId);
    // vikram only once
    expect(ids.filter((id: string) => id === 'character_image:vikram')).toHaveLength(1);
    expect(ids).toContain('character_image:laila');
    expect(ids).toContain('setting_image:dhaba');
  });

  it('does NOT inherit when last_frame is image_text_to_image', () => {
    const refs = [{ imageNumber: 1, type: 'character', refId: 'character_image:vikram' }];
    const p = {
      frames: {
        first_frame: { generationMode: 'image_text_to_image', references: refs },
        last_frame: { generationMode: 'image_text_to_image', references: [] },
      },
    };
    normalizeShotImagePrompt(p);
    expect(p.frames.last_frame.references).toEqual([]);
  });

  it('inherits into mid_frame too', () => {
    const refs = [{ imageNumber: 1, type: 'character', refId: 'character_image:vikram' }];
    const p = {
      frames: {
        first_frame: { generationMode: 'image_text_to_image', references: refs },
        mid_frame: { generationMode: 'edit_first_frame', references: [] },
        last_frame: { generationMode: 'edit_first_frame', references: [] },
      },
    };
    normalizeShotImagePrompt(p);
    expect(p.frames.mid_frame.references).toEqual(refs);
    expect(p.frames.last_frame.references).toEqual(refs);
  });

  it('no-op when first_frame has no refs', () => {
    const p = {
      frames: {
        first_frame: { generationMode: 'text_to_image', references: [] },
        last_frame: { generationMode: 'edit_first_frame', references: [] },
      },
    };
    normalizeShotImagePrompt(p);
    expect(p.frames.last_frame.references).toEqual([]);
  });

  it('handles malformed input gracefully', () => {
    expect(() => normalizeShotImagePrompt(null)).not.toThrow();
    expect(() => normalizeShotImagePrompt({})).not.toThrow();
    expect(() => normalizeShotImagePrompt({ frames: {} })).not.toThrow();
  });
});

describe('scene_video_prompt: getPromptSchema includes new fields', () => {
  it('exposes perspective values to LLM', () => {
    const schema = getPromptSchema('scene_video_prompt');
    expect(schema).toBeTruthy();
    expect(schema).toContain('main_subject');
    expect(schema).toContain('observer');
    expect(schema).toContain('overhead');
    expect(schema).toContain('perspective');
  });

  it('exposes focus object to LLM', () => {
    const schema = getPromptSchema('scene_video_prompt');
    expect(schema).toContain('focus');
    expect(schema).toContain('primary');
    expect(schema).toContain('lurking');
  });

  it('exposes continuityRole to LLM', () => {
    const schema = getPromptSchema('scene_video_prompt');
    expect(schema).toContain('continuityRole');
    expect(schema).toContain('entry');
    expect(schema).toContain('exit');
  });

  it('exposes mainSubject at scene level', () => {
    const schema = getPromptSchema('scene_video_prompt');
    expect(schema).toContain('mainSubject');
    expect(schema).toContain('secondarySubject');
  });
});

/**
 * normalizeShotImagePrompt — reorders a shot's references so setting
 * refs land at index 0 (maps to Klein's base_image / Ref 1 slot) and
 * renumbers both the `references` array and every `from image N`
 * phrase in `imagePrompt` so they stay in lockstep.
 *
 * The LLM-written shot_image_prompt JSON tends to list refs in the
 * order it thought of them — usually characters first, settings last.
 * That ordering means the FIRST slot (which Klein weights heavily for
 * composition) gets a close-up character ref instead of the
 * environment, and the generated images drift compositionally
 * (characters dominate frame, temple/dhaba backdrop is weak).
 *
 * Normalization happens BEFORE the upload layer because the prompt
 * text says "Vikram from image 1" etc. — if we only reordered at
 * upload, the text and the actual image slots would decouple.
 */
import { describe, it, expect } from 'vitest';
import { normalizeShotImagePrompt } from '../../src/core/planner/shotImagePromptNormalizer.js';

const charRef = (n: number, id: string) => ({
  imageNumber: n,
  type: 'character' as const,
  refId: `character_image:${id}`,
});
const settingRef = (n: number, id: string) => ({
  imageNumber: n,
  type: 'setting' as const,
  refId: `setting_image:${id}`,
});

describe('normalizeShotImagePrompt', () => {
  it('moves the only setting ref to index 0 and renumbers characters', () => {
    const input = {
      imagePrompt:
        'Vikram from image 1 at table. Laila from image 2 glides in. Cloaked figure from image 3 lurks. Dhaba from image 4 blurred behind.',
      references: [
        charRef(1, 'vikram'),
        charRef(2, 'laila'),
        charRef(3, 'cloaked_figure'),
        settingRef(4, 'torch_lit_dhaba'),
      ],
    };
    const out = normalizeShotImagePrompt(input);
    expect(out.references.map(r => r.refId)).toEqual([
      'setting_image:torch_lit_dhaba',
      'character_image:vikram',
      'character_image:laila',
      'character_image:cloaked_figure',
    ]);
    expect(out.references.map(r => r.imageNumber)).toEqual([1, 2, 3, 4]);
    // Prompt text: Vikram was image 1 → now image 2. Dhaba was image 4 → now image 1.
    expect(out.imagePrompt).toBe(
      'Vikram from image 2 at table. Laila from image 3 glides in. Cloaked figure from image 4 lurks. Dhaba from image 1 blurred behind.',
    );
  });

  it('handles non-contiguous image numbers (LLM skipping 4 and using 5)', () => {
    const input = {
      imagePrompt:
        'Over Vikram from image 1. Laila from image 2. Cloaked figure from image 3. Temple from image 5 behind.',
      references: [
        charRef(1, 'vikram'),
        charRef(2, 'laila'),
        charRef(3, 'cloaked_figure'),
        settingRef(5, 'crumbling_temple_by_the_ganges'),
      ],
    };
    const out = normalizeShotImagePrompt(input);
    expect(out.references.map(r => r.imageNumber)).toEqual([1, 2, 3, 4]);
    expect(out.references[0]!.refId).toBe('setting_image:crumbling_temple_by_the_ganges');
    // Temple was "from image 5", now "from image 1"
    expect(out.imagePrompt).toContain('Temple from image 1 behind');
    expect(out.imagePrompt).toContain('Vikram from image 2');
    expect(out.imagePrompt).toContain('Laila from image 3');
    expect(out.imagePrompt).toContain('Cloaked figure from image 4');
  });

  it('places multiple settings before characters in stable order', () => {
    const input = {
      imagePrompt:
        'Vikram from image 1. Dhaba from image 2 interior. Temple from image 3 exterior.',
      references: [
        charRef(1, 'vikram'),
        settingRef(2, 'torch_lit_dhaba'),
        settingRef(3, 'crumbling_temple'),
      ],
    };
    const out = normalizeShotImagePrompt(input);
    expect(out.references.map(r => r.refId)).toEqual([
      'setting_image:torch_lit_dhaba',
      'setting_image:crumbling_temple',
      'character_image:vikram',
    ]);
    expect(out.imagePrompt).toContain('Vikram from image 3');
    expect(out.imagePrompt).toContain('Dhaba from image 1');
    expect(out.imagePrompt).toContain('Temple from image 2');
  });

  it('no-op when there is no setting ref', () => {
    const input = {
      imagePrompt: 'Vikram from image 1 kneels. Laila from image 2 stands.',
      references: [charRef(1, 'vikram'), charRef(2, 'laila')],
    };
    const out = normalizeShotImagePrompt(input);
    expect(out.references).toEqual(input.references);
    expect(out.imagePrompt).toBe(input.imagePrompt);
  });

  it('no-op when there is only a setting ref (nothing to move before)', () => {
    const input = {
      imagePrompt: 'Marigolds on altar from image 1.',
      references: [settingRef(1, 'crumbling_temple')],
    };
    const out = normalizeShotImagePrompt(input);
    expect(out.references).toEqual(input.references);
    expect(out.imagePrompt).toBe(input.imagePrompt);
  });

  it('no-op when refs are empty (text_to_image)', () => {
    const input = { imagePrompt: 'Pure atmosphere, no refs.', references: [] };
    const out = normalizeShotImagePrompt(input);
    expect(out.references).toEqual([]);
    expect(out.imagePrompt).toBe(input.imagePrompt);
  });

  it('does not double-substitute when new number matches an old number', () => {
    // image 1 (vikram) goes to position 2; image 2 (setting) goes to position 1.
    // Naive sequential substitution could rewrite "from image 1" → "from image 2",
    // then rewrite THAT "from image 2" → "from image 1", ending back where we started.
    const input = {
      imagePrompt: 'Vikram from image 1 stands. Temple from image 2 behind.',
      references: [charRef(1, 'vikram'), settingRef(2, 'crumbling_temple')],
    };
    const out = normalizeShotImagePrompt(input);
    expect(out.imagePrompt).toBe('Vikram from image 2 stands. Temple from image 1 behind.');
  });

  it('word-boundary safe: does NOT match "from image 12" when renumbering "from image 1"', () => {
    const input = {
      imagePrompt: 'Ref from image 1 and ref from image 12.',
      references: [
        charRef(1, 'a'),
        charRef(12, 'b'),
        settingRef(2, 's'),
      ],
    };
    const out = normalizeShotImagePrompt(input);
    // New order: setting(s)=1, a=2, b=3
    // Old 1 (a) → 2; old 12 (b) → 3; old 2 (s) → 1.
    expect(out.imagePrompt).toBe('Ref from image 2 and ref from image 3.');
  });

  it('is case-insensitive for "from image N" matching', () => {
    const input = {
      imagePrompt: 'Vikram From Image 1 stands. Temple FROM IMAGE 2 behind.',
      references: [charRef(1, 'vikram'), settingRef(2, 'temple')],
    };
    const out = normalizeShotImagePrompt(input);
    expect(out.imagePrompt).toMatch(/vikram from image 2 stands/i);
    expect(out.imagePrompt).toMatch(/temple from image 1 behind/i);
  });

  it('leaves untouched an unreferenced number in prompt (dangling)', () => {
    // LLM wrote "from image 99" but 99 isn't in references. Leave as-is.
    const input = {
      imagePrompt: 'Character from image 1. Orphan from image 99 floating.',
      references: [charRef(1, 'vikram'), settingRef(2, 'temple')],
    };
    const out = normalizeShotImagePrompt(input);
    expect(out.imagePrompt).toContain('Character from image 2');
    expect(out.imagePrompt).toContain('Orphan from image 99 floating');
  });
});

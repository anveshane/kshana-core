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
import {
  normalizeShotImagePrompt,
  injectMissingShotRefs,
  normalizeShotImagePromptWithRefs,
  type AvailableRefMinimal,
} from '../../src/core/planner/shotImagePromptNormalizer.js';

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

// ---- Pass 1: injectMissingShotRefs ----

const avail = (n: number, type: 'character' | 'setting', label: string): AvailableRefMinimal => ({
  imageNumber: n,
  type,
  refId: `${type}_image:${label}`,
  label,
});

describe('injectMissingShotRefs', () => {
  it('injects "from image N" after a character name that had no phrase', () => {
    // This is the exact real-world bug from sun_hadnt_yet_cleared-2 —
    // Parvati and Isha both named in prose but neither tagged.
    const input = {
      imagePrompt:
        'A wide low-angle shot of the district sports complex from image 1, the rusted gate centered, Parvati standing frozen to the left with legs apart, tracing rightward toward the retreating figure of Isha mid-stride in jogging pose.',
      references: [avail(1, 'setting', 'district_sports_complex')],
    };
    const available = [
      avail(1, 'setting', 'district_sports_complex'),
      avail(2, 'character', 'parvati'),
      avail(3, 'character', 'isha'),
    ];
    const out = injectMissingShotRefs(input, available);

    expect(out.frame.imagePrompt).toContain('Parvati from image 2 standing frozen');
    expect(out.frame.imagePrompt).toContain('Isha from image 3 mid-stride');
    expect(out.frame.references.map(r => r.refId)).toEqual([
      'setting_image:district_sports_complex',
      'character_image:parvati',
      'character_image:isha',
    ]);
    expect(out.injected.map(i => i.label).sort()).toEqual(['isha', 'parvati']);
    expect(out.injected.every(i => i.kind === 'both')).toBe(true);
  });

  it('only adds to references array when prose already has the phrase', () => {
    const input = {
      imagePrompt: 'Parvati from image 2 stands, gate centered from image 1.',
      references: [avail(1, 'setting', 'district_sports_complex')],
    };
    const available = [
      avail(1, 'setting', 'district_sports_complex'),
      avail(2, 'character', 'parvati'),
    ];
    const out = injectMissingShotRefs(input, available);
    // Prose is untouched — only the array gets the entry.
    expect(out.frame.imagePrompt).toBe(input.imagePrompt);
    expect(out.frame.references).toHaveLength(2);
    expect(out.injected).toEqual([{ label: 'parvati', imageNumber: 2, kind: 'array' }]);
  });

  it('only injects into prose when array already has the ref', () => {
    const input = {
      imagePrompt: 'Parvati stands near the gate.',
      references: [
        { imageNumber: 2, type: 'character', refId: 'character_image:parvati' },
      ],
    };
    const available = [avail(2, 'character', 'parvati')];
    const out = injectMissingShotRefs(input, available);
    expect(out.frame.imagePrompt).toBe('Parvati from image 2 stands near the gate.');
    expect(out.frame.references).toHaveLength(1);
    expect(out.injected).toEqual([{ label: 'parvati', imageNumber: 2, kind: 'phrase' }]);
  });

  it('no-op when both phrase and array already present', () => {
    const input = {
      imagePrompt: 'Parvati from image 2 stands.',
      references: [
        { imageNumber: 2, type: 'character', refId: 'character_image:parvati' },
      ],
    };
    const out = injectMissingShotRefs(input, [avail(2, 'character', 'parvati')]);
    expect(out.frame).toEqual(input);
    expect(out.injected).toEqual([]);
  });

  it('handles labels with underscores and dots ("mrs._singh" → "Mrs. Singh")', () => {
    const input = {
      imagePrompt: 'Mrs. Singh sighs as Parvati steps out.',
      references: [],
    };
    const available = [
      avail(1, 'character', 'parvati'),
      avail(2, 'character', 'mrs._singh'),
    ];
    const out = injectMissingShotRefs(input, available);
    expect(out.frame.imagePrompt).toContain('Mrs. Singh from image 2 sighs');
    expect(out.frame.imagePrompt).toContain('Parvati from image 1 steps out');
    expect(out.frame.references.map(r => r.refId).sort()).toEqual([
      'character_image:mrs._singh',
      'character_image:parvati',
    ]);
  });

  it('does not match a label inside another word (Isha ≠ Ishan)', () => {
    const input = {
      imagePrompt: 'Ishan, a stranger, walks past.',
      references: [],
    };
    const out = injectMissingShotRefs(input, [avail(3, 'character', 'isha')]);
    expect(out.frame.imagePrompt).toBe(input.imagePrompt);
    expect(out.injected).toEqual([]);
  });

  it('matches possessive form (Isha\'s) without breaking it', () => {
    const input = {
      imagePrompt: "Parvati's eyes follow Isha's retreating figure.",
      references: [],
    };
    const available = [
      avail(1, 'character', 'parvati'),
      avail(2, 'character', 'isha'),
    ];
    const out = injectMissingShotRefs(input, available);
    // We inject after the name, before the apostrophe.
    expect(out.frame.imagePrompt).toContain("Parvati from image 1's eyes");
    expect(out.frame.imagePrompt).toContain("Isha from image 2's retreating figure");
  });

  it('does not inject for refs whose label is not in prose', () => {
    const input = {
      imagePrompt: 'An empty dusty street.',
      references: [],
    };
    const available = [
      avail(1, 'character', 'parvati'),
      avail(2, 'setting', 'empty_street'),
    ];
    const out = injectMissingShotRefs(input, available);
    expect(out.frame.imagePrompt).toBe(input.imagePrompt);
    expect(out.injected).toEqual([]);
  });

  it('case-insensitive label matching', () => {
    const input = { imagePrompt: 'PARVATI stands.', references: [] };
    const out = injectMissingShotRefs(input, [avail(1, 'character', 'parvati')]);
    expect(out.frame.imagePrompt).toBe('PARVATI from image 1 stands.');
  });

  it('injects only after the first mention when a name repeats', () => {
    const input = {
      imagePrompt: 'Parvati stands. Parvati sighs. Parvati walks away.',
      references: [],
    };
    const out = injectMissingShotRefs(input, [avail(2, 'character', 'parvati')]);
    // Count occurrences of the phrase — should be exactly 1.
    const matches = out.frame.imagePrompt.match(/from image 2/g) ?? [];
    expect(matches.length).toBe(1);
    expect(out.frame.imagePrompt.startsWith('Parvati from image 2 stands.')).toBe(true);
  });

  it('is a no-op when availableRefs is empty', () => {
    const input = {
      imagePrompt: 'Parvati stands.',
      references: [],
    };
    const out = injectMissingShotRefs(input, []);
    expect(out.frame).toEqual(input);
    expect(out.injected).toEqual([]);
  });
});

describe('normalizeShotImagePromptWithRefs (combined)', () => {
  it('injects missing refs THEN reorders so setting lands at index 0', () => {
    // Real sun_hadnt_yet_cleared-2 scene-2-shot-1 pattern: LLM named
    // Parvati + Isha in prose without tagging them, and only listed
    // settings in the refs array.
    const input = {
      imagePrompt:
        'Parvati standing frozen, Isha mid-stride, the district sports complex from image 1 framing them, singh bungalow from image 2 on the horizon.',
      references: [
        { imageNumber: 1, type: 'setting' as const, refId: 'setting_image:district_sports_complex' },
        { imageNumber: 2, type: 'setting' as const, refId: 'setting_image:singh_bungalow' },
      ],
    };
    const available: AvailableRefMinimal[] = [
      avail(1, 'setting', 'district_sports_complex'),
      avail(2, 'setting', 'singh_bungalow'),
      avail(3, 'character', 'parvati'),
      avail(4, 'character', 'isha'),
    ];
    const out = normalizeShotImagePromptWithRefs(input, available);

    // Order: both settings first, then characters.
    expect(out.frame.references.map(r => r.refId)).toEqual([
      'setting_image:district_sports_complex',
      'setting_image:singh_bungalow',
      'character_image:parvati',
      'character_image:isha',
    ]);
    expect(out.frame.references.map(r => r.imageNumber)).toEqual([1, 2, 3, 4]);
    // Prose should name each ref with matching N.
    expect(out.frame.imagePrompt).toContain('Parvati from image 3 standing frozen');
    expect(out.frame.imagePrompt).toContain('Isha from image 4 mid-stride');
    expect(out.frame.imagePrompt).toContain('district sports complex from image 1');
    expect(out.frame.imagePrompt).toContain('singh bungalow from image 2');

    expect(out.injected.map(i => i.label).sort()).toEqual(['isha', 'parvati']);
  });
});

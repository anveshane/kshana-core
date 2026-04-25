/**
 * `alignFramesToFirstFrame` regression tests.
 *
 * The LLM produces shot_image_prompt JSON in a single call. For
 * `last_frame` (and any non-first frame) it sometimes:
 *   - Renumbers refs starting at 1 — so the SAME refId gets a different
 *     imageNumber than first_frame's canonical numbering.
 *   - Drops one of first_frame's refs from `references[]` entirely
 *     (commonly the setting, because last_frame prose mentions only a
 *     PART of the setting like "gate" or "mudroom" — labels don't
 *     match for the per-frame injector).
 *   - Hallucinates a new image number (e.g., writes "from image 4"
 *     for the gate when only images 1-3 are available).
 *
 * `alignFramesToFirstFrame` enforces first_frame's mapping
 * (refId → imageNumber) as canonical for every other frame:
 *
 *   1. Renumber: when a refId is in BOTH first_frame and a non-first
 *      frame but with different imageNumbers, rewrite the frame's
 *      `from image N` tags to use first_frame's number.
 *
 *   2. Hallucination heuristic: if exactly ONE orphan tag in prose
 *      pairs with exactly ONE first_frame ref missing from local
 *      references, rewrite the orphan tag to the missing ref's
 *      canonical number.
 *
 *   3. Inheritance gate: a first_frame ref is added to a non-first
 *      frame's references[] only if its canonical N appears tagged
 *      in prose. Likewise, local refs are dropped if their renumbered
 *      N never appears in prose. This prevents ORPHAN_REF audits when
 *      a character legitimately leaves the frame.
 *
 *   4. New characters introduced ONLY in a non-first frame keep their
 *      number unless it collides with a canonical one — in which case
 *      they get the next free number and prose is rewritten.
 */
import { describe, it, expect } from 'vitest';
import {
  alignFramesToFirstFrame,
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

describe('alignFramesToFirstFrame', () => {
  it('rewrites prose when last_frame renumbered shared refIds', () => {
    // Real s1sh3 bug: LLM renumbered Parvati=1, Isha=2 in last_frame
    // but first_frame had Parvati=2, Isha=3.
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt:
            'OTS of Isha from image 3 with Parvati from image 2 sharp at the gate from image 1.',
          references: [
            settingRef(1, 'district_sports_complex'),
            charRef(2, 'parvati'),
            charRef(3, 'isha'),
          ],
        },
        last_frame: {
          imagePrompt:
            "Isha from image 2's shoulder blurred. Parvati from image 1 fully facing camera.",
          references: [charRef(1, 'parvati'), charRef(2, 'isha')],
        },
      },
    };
    alignFramesToFirstFrame(parsed);

    expect(parsed.frames.last_frame.imagePrompt).toContain('Isha from image 3');
    expect(parsed.frames.last_frame.imagePrompt).toContain('Parvati from image 2');
    const parvati = parsed.frames.last_frame.references.find(
      r => r.refId === 'character_image:parvati',
    );
    expect(parvati?.imageNumber).toBe(2);
    const isha = parsed.frames.last_frame.references.find(
      r => r.refId === 'character_image:isha',
    );
    expect(isha?.imageNumber).toBe(3);
    // Setting NOT inherited — prose never tagged it. (Realistic: last_frame
    // is a delta where the setting isn't named again.)
    const setting = parsed.frames.last_frame.references.find(
      r => r.refId === 'setting_image:district_sports_complex',
    );
    expect(setting).toBeUndefined();
  });

  it('handles a swap (1↔2) without cascading double-substitution', () => {
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'Vikram from image 1 stands. Temple from image 2 behind.',
          references: [charRef(1, 'vikram'), settingRef(2, 'temple')],
        },
        last_frame: {
          // LLM swapped: vikram=2, temple=1
          imagePrompt: 'Vikram from image 2 turned. Temple from image 1 still.',
          references: [charRef(2, 'vikram'), settingRef(1, 'temple')],
        },
      },
    };
    alignFramesToFirstFrame(parsed);

    expect(parsed.frames.last_frame.imagePrompt).toBe(
      'Vikram from image 1 turned. Temple from image 2 still.',
    );
    const vikram = parsed.frames.last_frame.references.find(
      r => r.refId === 'character_image:vikram',
    );
    expect(vikram?.imageNumber).toBe(1);
    const temple = parsed.frames.last_frame.references.find(
      r => r.refId === 'setting_image:temple',
    );
    expect(temple?.imageNumber).toBe(2);
  });

  it('uses 1-orphan-1-missing heuristic to reattach a hallucinated number', () => {
    // Real s1sh3 prose pattern: "gate from image 4" when image 4 doesn't
    // exist and the setting (canonical 1) is the obvious target. With
    // exactly one orphan tag and one missing first_frame ref, we
    // unambiguously remap.
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt:
            'Wide shot of district sports complex from image 1, Parvati from image 2, Isha from image 3.',
          references: [
            settingRef(1, 'district_sports_complex'),
            charRef(2, 'parvati'),
            charRef(3, 'isha'),
          ],
        },
        last_frame: {
          imagePrompt:
            'Same composition. Parvati from image 2 fully facing camera. Isha from image 3 walked off. Gate from image 4 still in background.',
          references: [charRef(2, 'parvati'), charRef(3, 'isha')],
        },
      },
    };
    alignFramesToFirstFrame(parsed);

    // Orphan "from image 4" rewritten to setting's canonical 1.
    expect(parsed.frames.last_frame.imagePrompt).toContain('Gate from image 1');
    expect(parsed.frames.last_frame.imagePrompt).not.toContain('from image 4');
    // Setting now in references at canonical 1.
    const setting = parsed.frames.last_frame.references.find(
      r => r.refId === 'setting_image:district_sports_complex',
    );
    expect(setting?.imageNumber).toBe(1);
  });

  it('drops a local ref whose number never appears in prose (character left frame)', () => {
    // Last_frame: Isha walked off. LLM stale-included her in references
    // without tagging her in prose. Drop the stale entry.
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt:
            'Setting from image 1, Parvati from image 2, Isha from image 3.',
          references: [
            settingRef(1, 'street'),
            charRef(2, 'parvati'),
            charRef(3, 'isha'),
          ],
        },
        last_frame: {
          imagePrompt:
            'Same setting from image 1. Parvati from image 2 alone, expression hardening.',
          references: [
            settingRef(1, 'street'),
            charRef(2, 'parvati'),
            charRef(3, 'isha'),
          ],
        },
      },
    };
    alignFramesToFirstFrame(parsed);

    // Isha dropped — never tagged.
    const isha = parsed.frames.last_frame.references.find(
      r => r.refId === 'character_image:isha',
    );
    expect(isha).toBeUndefined();
    // Setting + Parvati kept (both tagged).
    expect(parsed.frames.last_frame.references).toHaveLength(2);
  });

  it('preserves a NEW character introduced in last_frame', () => {
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'Vikram from image 1 at table. Dhaba from image 2.',
          references: [charRef(1, 'vikram'), settingRef(2, 'dhaba')],
        },
        last_frame: {
          imagePrompt:
            'Vikram from image 1 still seated. Laila from image 3 has glided in.',
          references: [charRef(1, 'vikram'), charRef(3, 'laila')],
        },
      },
    };
    alignFramesToFirstFrame(parsed);

    // Laila preserved at her introduced number 3.
    const laila = parsed.frames.last_frame.references.find(
      r => r.refId === 'character_image:laila',
    );
    expect(laila?.imageNumber).toBe(3);
    // Vikram kept at canonical 1.
    const vikram = parsed.frames.last_frame.references.find(
      r => r.refId === 'character_image:vikram',
    );
    expect(vikram?.imageNumber).toBe(1);
    // Setting NOT inherited (no "from image 2" in prose).
    const dhaba = parsed.frames.last_frame.references.find(
      r => r.refId === 'setting_image:dhaba',
    );
    expect(dhaba).toBeUndefined();
  });

  it('renumbers a NEW character that collides with a canonical number', () => {
    // first_frame: setting=1, vikram=2.
    // last_frame: prose mentions vikram and a NEW character laila.
    // LLM put both vikram and laila at imageNumber=2 (collision).
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'Dhaba from image 1, Vikram from image 2 at table.',
          references: [settingRef(1, 'dhaba'), charRef(2, 'vikram')],
        },
        last_frame: {
          imagePrompt:
            'Vikram from image 2 watching as Laila from image 2 enters; the dhaba from image 1 dim.',
          references: [
            settingRef(1, 'dhaba'),
            charRef(2, 'vikram'),
            charRef(2, 'laila'),
          ],
        },
      },
    };
    alignFramesToFirstFrame(parsed);

    // Laila must move out of canonical-2.
    const laila = parsed.frames.last_frame.references.find(
      r => r.refId === 'character_image:laila',
    );
    expect(laila).toBeDefined();
    expect(laila!.imageNumber).not.toBe(2);
    expect(laila!.imageNumber).toBeGreaterThan(2);
  });

  it('no-op when first_frame has no refs', () => {
    const parsed = {
      frames: {
        first_frame: { imagePrompt: 'Pure atmosphere.', references: [] },
        last_frame: {
          imagePrompt: 'Same atmosphere, deeper fog.',
          references: [],
        },
      },
    };
    const before = JSON.parse(JSON.stringify(parsed));
    alignFramesToFirstFrame(parsed);
    expect(parsed).toEqual(before);
  });

  it('no-op when there is no last_frame (single-frame shot)', () => {
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'Vikram from image 1 stands.',
          references: [charRef(1, 'vikram')],
        },
      },
    };
    const before = JSON.parse(JSON.stringify(parsed));
    alignFramesToFirstFrame(parsed);
    expect(parsed).toEqual(before);
  });

  it('does not mangle prose that already uses canonical numbering', () => {
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'Vikram from image 1 stands.',
          references: [charRef(1, 'vikram')],
        },
        last_frame: {
          imagePrompt: 'Vikram from image 1 has turned to face the door.',
          references: [charRef(1, 'vikram')],
        },
      },
    };
    alignFramesToFirstFrame(parsed);
    expect(parsed.frames.last_frame.imagePrompt).toBe(
      'Vikram from image 1 has turned to face the door.',
    );
  });

  it('order-of-operations: per-frame inject + reorder + align produces clean refs and prose', () => {
    // Real s1sh3 pattern: LLM renumbered last_frame and emitted a
    // hallucinated "from image 4" tag. The full pipeline must converge
    // on canonical numbering with no orphans and no fabricated numbers.
    const availableRefs: AvailableRefMinimal[] = [
      { imageNumber: 1, type: 'setting', refId: 'setting_image:district_sports_complex', label: 'district_sports_complex' },
      { imageNumber: 2, type: 'character', refId: 'character_image:parvati', label: 'parvati' },
      { imageNumber: 3, type: 'character', refId: 'character_image:isha', label: 'isha' },
    ];
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt:
            'OTS of Isha from image 3 with Parvati from image 2 sharp at the gate from image 1.',
          references: [
            { imageNumber: 1, type: 'setting' as const, refId: 'setting_image:district_sports_complex' },
            { imageNumber: 2, type: 'character' as const, refId: 'character_image:parvati' },
            { imageNumber: 3, type: 'character' as const, refId: 'character_image:isha' },
          ],
        },
        last_frame: {
          // LLM renumbered + hallucinated.
          imagePrompt:
            "Same composition. Isha from image 2's shoulder blurred. Parvati from image 1 fully facing camera. Gate from image 4 visible.",
          references: [
            { imageNumber: 1, type: 'character' as const, refId: 'character_image:parvati' },
            { imageNumber: 2, type: 'character' as const, refId: 'character_image:isha' },
          ],
        },
      },
    };

    parsed.frames.first_frame = normalizeShotImagePromptWithRefs(
      parsed.frames.first_frame,
      availableRefs,
    ).frame as typeof parsed.frames.first_frame;

    alignFramesToFirstFrame(parsed);

    parsed.frames.last_frame = normalizeShotImagePromptWithRefs(
      parsed.frames.last_frame,
      availableRefs,
    ).frame as typeof parsed.frames.last_frame;

    const refsByRefId = new Map(parsed.frames.last_frame.references.map(r => [r.refId, r.imageNumber]));
    expect(refsByRefId.get('setting_image:district_sports_complex')).toBe(1);
    expect(refsByRefId.get('character_image:parvati')).toBe(2);
    expect(refsByRefId.get('character_image:isha')).toBe(3);

    const prose = parsed.frames.last_frame.imagePrompt;
    expect(prose).toContain('Parvati from image 2');
    expect(prose).toContain('Isha from image 3');
    expect(prose).toContain('Gate from image 1');
    expect(prose).not.toContain('from image 4');

    // No duplicate "from image N" tags.
    expect((prose.match(/from image 1/g) ?? []).length).toBe(1);
    expect((prose.match(/from image 2/g) ?? []).length).toBe(1);
    expect((prose.match(/from image 3/g) ?? []).length).toBe(1);
  });

  it('handles mid_frame and last_frame independently', () => {
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'Setting from image 1, Vikram from image 2.',
          references: [settingRef(1, 'temple'), charRef(2, 'vikram')],
        },
        mid_frame: {
          imagePrompt: 'Vikram from image 1 mid-transformation.',
          references: [charRef(1, 'vikram')],
        },
        last_frame: {
          imagePrompt: 'Vikram from image 1 fully changed.',
          references: [charRef(1, 'vikram')],
        },
      },
    };
    alignFramesToFirstFrame(parsed);

    for (const frame of [parsed.frames.mid_frame, parsed.frames.last_frame]) {
      const vikram = frame.references.find(r => r.refId === 'character_image:vikram');
      expect(vikram?.imageNumber).toBe(2);
      expect(frame.imagePrompt).toContain('Vikram from image 2');
    }
  });
});

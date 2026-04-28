/**
 * `scanOTSWithSingleChar` regression tests.
 *
 * OTS (over-the-shoulder) framing is inherently a two-character
 * composition: foreground anchor blurred + focal subject sharp. With
 * only one character ref, image models either invent a phantom second
 * character (Seedream) or distort focus (Klein). The validator
 * deterministically rejects shot_image_prompts that combine OTS prose
 * with fewer than two character refs in any frame.
 *
 * Real bug from sun_hadnt_yet_cleared-2: scene 4 shot 2 — single-char
 * shot of Parvati at a bucket — used "Over Parvati from image 2's
 * shoulder" framing because the upstream cameraWork said OTS. The
 * shot_composition_guide rule alone wasn't enough; we need a hard
 * gate at validation time.
 */
import { describe, it, expect } from 'vitest';
import { scanOTSWithSingleChar } from '../../src/core/planner/shotImagePromptNormalizer.js';

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

describe('scanOTSWithSingleChar', () => {
  it('flags hyphenated `over-the-shoulder` with single character', () => {
    const issues = scanOTSWithSingleChar({
      frames: {
        first_frame: {
          imagePrompt:
            "An over-the-shoulder view of Parvati from image 2 in the mudroom from image 1, her hands sharply in focus reaching for a bucket.",
          references: [settingRef(1, 'singh_bungalow'), charRef(2, 'parvati')],
        },
      },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.frame).toBe('first_frame');
    expect(issues[0]!.reason).toMatch(/over.the.shoulder/i);
  });

  it('flags `Over X\'s shoulder` phrasing with single character', () => {
    // Real s4sh2 prose pattern.
    const issues = scanOTSWithSingleChar({
      frames: {
        first_frame: {
          imagePrompt:
            "Over Parvati from image 2's shoulder, a close-up of her right hand on the floor.",
          references: [settingRef(1, 'mudroom'), charRef(2, 'parvati')],
        },
      },
    });
    expect(issues).toHaveLength(1);
  });

  it('flags `OTS` abbreviation with single character', () => {
    const issues = scanOTSWithSingleChar({
      frames: {
        first_frame: {
          imagePrompt:
            'OTS framing on Parvati from image 1, hands extended toward bucket.',
          references: [charRef(1, 'parvati')],
        },
      },
    });
    expect(issues).toHaveLength(1);
  });

  it('passes when OTS used with 2+ character refs', () => {
    const issues = scanOTSWithSingleChar({
      frames: {
        first_frame: {
          imagePrompt:
            "Over Vikram from image 1's shoulder, Laila from image 2 stands sharp.",
          references: [charRef(1, 'vikram'), charRef(2, 'laila')],
        },
      },
    });
    expect(issues).toEqual([]);
  });

  it('passes when no OTS phrasing used (insert/close_up)', () => {
    const issues = scanOTSWithSingleChar({
      frames: {
        first_frame: {
          imagePrompt:
            "Insert shot: Parvati from image 2's hand reaching toward the bucket on the mudroom floor from image 1, fingers extended in shallow focus.",
          references: [settingRef(1, 'mudroom'), charRef(2, 'parvati')],
        },
      },
    });
    expect(issues).toEqual([]);
  });

  it('does not match unrelated "over her shoulder" prose like a slung bag', () => {
    // Earlier audit false positive — guard against the broader regex.
    const issues = scanOTSWithSingleChar({
      frames: {
        first_frame: {
          imagePrompt:
            'Parvati from image 2 walks down the road, a canvas bag slung over her shoulder.',
          references: [settingRef(1, 'road'), charRef(2, 'parvati')],
        },
      },
    });
    expect(issues).toEqual([]);
  });

  it('flags OTS in last_frame independently of first_frame', () => {
    const issues = scanOTSWithSingleChar({
      frames: {
        first_frame: {
          imagePrompt: 'Close-up on Parvati from image 1.',
          references: [charRef(1, 'parvati')],
        },
        last_frame: {
          imagePrompt:
            'Over-the-shoulder shot of Parvati from image 1 reaching for a bucket.',
          references: [charRef(1, 'parvati')],
        },
      },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.frame).toBe('last_frame');
  });

  it('counts only character-type refs (settings do not satisfy 2+ requirement)', () => {
    const issues = scanOTSWithSingleChar({
      frames: {
        first_frame: {
          imagePrompt:
            "Over Parvati from image 2's shoulder, the room from image 1 visible behind her.",
          references: [settingRef(1, 'room'), charRef(2, 'parvati')],
        },
      },
    });
    expect(issues).toHaveLength(1);
  });

  it('returns empty when no frames present', () => {
    const issues = scanOTSWithSingleChar({ frames: {} });
    expect(issues).toEqual([]);
  });
});

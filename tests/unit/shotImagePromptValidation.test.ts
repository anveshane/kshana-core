/**
 * Tests for shot_image_prompt semantic validators.
 *
 * Background: deepseek-v4-flash hallucinated a completely unrelated
 * scene (Elena in apartment with rain) for what should have been
 * "Parvati in mudroom" on a real run. The output was syntactically
 * valid JSON — passed Zod schema and ref injection — but referenced an
 * Elena character who doesn't exist in the project, contained no refs,
 * and reported `shotNumber: 5` for what was supposed to be shot 1.
 *
 * These validators close that gap by asserting:
 *   1. The response's `shotNumber` matches the requested shot's number
 *      (extracted from the node's itemId like `scene_4_shot_1`).
 *   2. The output mentions at least one of the project's known
 *      character / setting / object refIds — either inline in
 *      `imagePrompt` text or via a `references[]` entry. Zero-ref
 *      output indicates the LLM ignored the project's entities and
 *      hallucinated unrelated content.
 *
 * Failures here are forwarded into the existing JSON-repair retry path
 * in ExecutorAgent so the LLM gets a chance to fix itself.
 */
import { describe, it, expect } from 'vitest';
import {
  validateShotNumber,
  validateRefMentions,
  expectedShotNumberFromItemId,
} from '../../src/core/planner/shotImagePromptValidation.js';

describe('expectedShotNumberFromItemId', () => {
  it('extracts shot number from "scene_N_shot_M"', () => {
    expect(expectedShotNumberFromItemId('scene_1_shot_1')).toBe(1);
    expect(expectedShotNumberFromItemId('scene_4_shot_12')).toBe(12);
    expect(expectedShotNumberFromItemId('scene_10_shot_99')).toBe(99);
  });

  it('returns null when itemId does not match the expected shape', () => {
    expect(expectedShotNumberFromItemId('not-a-shot-id')).toBeNull();
    expect(expectedShotNumberFromItemId('scene_1')).toBeNull();
    expect(expectedShotNumberFromItemId('')).toBeNull();
    expect(expectedShotNumberFromItemId(undefined)).toBeNull();
  });
});

describe('validateShotNumber', () => {
  it('returns valid when parsed.shotNumber matches expected', () => {
    expect(validateShotNumber({ shotNumber: 1 }, 1).valid).toBe(true);
  });

  it('returns invalid with a clear error when shotNumber mismatches', () => {
    const r = validateShotNumber({ shotNumber: 5 }, 1);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/shotNumber.*expected.*1.*got.*5|expected 1.*got 5/i);
  });

  it('returns invalid when shotNumber is missing', () => {
    const r = validateShotNumber({}, 1);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/shotNumber|missing/i);
  });

  it('returns valid when expected is null (caller couldn\'t determine — skip check)', () => {
    expect(validateShotNumber({ shotNumber: 99 }, null).valid).toBe(true);
  });
});

describe('validateRefMentions', () => {
  const availableRefIds = [
    'character_image:parvati',
    'character_image:isha',
    'character_image:mrs._singh',
    'setting_image:district_sports_complex',
    'setting_image:singh_bungalow',
  ];

  it('passes when imagePrompt mentions a character refId by name', () => {
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'Parvati from image 2 walks toward the gate',
          references: [],
        },
      },
    };
    expect(validateRefMentions(parsed, availableRefIds).valid).toBe(true);
  });

  it('passes when imagePrompt mentions a setting refId by name', () => {
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'A wide shot of the singh bungalow with characters',
          references: [],
        },
      },
    };
    expect(validateRefMentions(parsed, availableRefIds).valid).toBe(true);
  });

  it('passes when references[] contains a valid refId', () => {
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'A wide shot of an empty room',
          references: [{ imageNumber: 1, refId: 'setting_image:district_sports_complex' }],
        },
      },
    };
    expect(validateRefMentions(parsed, availableRefIds).valid).toBe(true);
  });

  it('FAILS when no character/setting/object name appears anywhere — the deepseek hallucination case', () => {
    // Real bug from production: deepseek emitted "Elena" in an apartment
    // for what should have been Parvati in the mudroom.
    const parsed = {
      frames: {
        first_frame: {
          imagePrompt: 'A wide shot of a dimly lit apartment at dusk. Rain streams down a large window. A young woman, Elena, sits on a worn sofa.',
          references: [],
        },
      },
    };
    const r = validateRefMentions(parsed, availableRefIds);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/no.*ref|character|setting|hallucin/i);
  });

  it('handles a flat shape (no .frames wrapper) — single imagePrompt at the root', () => {
    const parsed = {
      imagePrompt: 'parvati at the gate',
      references: [],
    };
    expect(validateRefMentions(parsed, availableRefIds).valid).toBe(true);
  });

  it('passes when at least ONE frame mentions a known ref (others can be context-free)', () => {
    const parsed = {
      frames: {
        first_frame: { imagePrompt: 'a generic establishing shot', references: [] },
        last_frame: { imagePrompt: 'parvati turns away', references: [] },
      },
    };
    expect(validateRefMentions(parsed, availableRefIds).valid).toBe(true);
  });

  it('case-insensitive match on character names', () => {
    const parsed = {
      frames: {
        first_frame: { imagePrompt: 'PARVATI walks in', references: [] },
      },
    };
    expect(validateRefMentions(parsed, availableRefIds).valid).toBe(true);
  });

  it('handles empty availableRefIds (no project refs known) by passing — caller can\'t check', () => {
    const parsed = {
      frames: { first_frame: { imagePrompt: 'anything', references: [] } },
    };
    expect(validateRefMentions(parsed, []).valid).toBe(true);
  });

  it('handles refs containing dots/underscores (e.g. mrs._singh)', () => {
    const parsed = {
      frames: {
        first_frame: { imagePrompt: 'Mrs. Singh sips tea', references: [] },
      },
    };
    expect(validateRefMentions(parsed, availableRefIds).valid).toBe(true);
  });
});

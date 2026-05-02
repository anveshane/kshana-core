/**
 * Tests for `buildShotAudioBlock`.
 *
 * Background: scene_video_prompt's per-shot `audio` field carries
 * dialogue and ambient sounds in a "SPEAKER: dialogue. ambient."
 * format (e.g. `"PARVATI: Go on, beti. Distant birds, rusted gate."`).
 *
 * The motion-directive LLM is supposed to pull dialogue out of this
 * field per the motion_directive_guide, but in practice it ignores
 * the instruction. The fix is to extract the dialogue/ambient up
 * front and inject them as a clearly-delimited <shot_audio> block
 * directly in the user message, with explicit per-line directives.
 *
 * The block format makes both pieces unambiguous:
 *   <shot_audio>
 *   DIALOGUE: "Go on, beti." — speaker: PARVATI
 *   AMBIENT: Distant birds, rusted gate.
 *   </shot_audio>
 *
 * If only ambient sounds are present (no SPEAKER:), only the AMBIENT
 * line is emitted. Empty input → empty block (caller filters).
 */
import { describe, it, expect } from 'vitest';
import { buildShotAudioBlock } from '../../src/core/planner/buildShotAudioBlock.js';

describe('buildShotAudioBlock', () => {
  it('extracts dialogue and ambient when both are present', () => {
    const result = buildShotAudioBlock(
      'PARVATI: Go on, beti. Coach is waiting. Distant morning birds, creak of rusted gate.',
    );
    expect(result).toContain('<shot_audio>');
    expect(result).toContain('</shot_audio>');
    expect(result).toMatch(/DIALOGUE:.*Go on, beti.*Coach is waiting/);
    expect(result).toMatch(/speaker:\s*PARVATI/i);
    expect(result).toMatch(/AMBIENT:.*Distant morning birds.*creak of rusted gate/);
  });

  it('extracts dialogue only when no ambient is present', () => {
    const result = buildShotAudioBlock('ISHA: Did you pack the glucose powder?');
    expect(result).toMatch(/DIALOGUE:.*Did you pack the glucose powder/);
    expect(result).toMatch(/speaker:\s*ISHA/i);
    // No AMBIENT line when nothing follows the dialogue
    expect(result).not.toMatch(/AMBIENT:/);
  });

  it('extracts ambient only when no SPEAKER: prefix is present', () => {
    const result = buildShotAudioBlock('Faint sound of dust underfoot, bag strap adjusting.');
    expect(result).not.toMatch(/DIALOGUE:/);
    expect(result).toMatch(/AMBIENT:.*dust underfoot.*bag strap adjusting/);
  });

  it('preserves multi-sentence dialogue verbatim', () => {
    const result = buildShotAudioBlock(
      "ISHA: Okay, Ma. Go now, or you'll be late. Don't scrub too hard. Faint sound of dust underfoot.",
    );
    // The whole multi-sentence dialogue stays in the dialogue field
    expect(result).toMatch(/DIALOGUE:.*Okay, Ma\..*Go now.*late.*Don't scrub too hard/);
    expect(result).toMatch(/AMBIENT:.*dust underfoot/);
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(buildShotAudioBlock('')).toBe('');
    expect(buildShotAudioBlock('   ')).toBe('');
    expect(buildShotAudioBlock(undefined)).toBe('');
  });

  it('handles SPEAKER: with mixed-case names (uppercase only convention)', () => {
    // Per the convention from the existing scene_video_prompt schema,
    // speaker names are ALL CAPS.
    const result = buildShotAudioBlock('MRS. SINGH: Late again, Parvati. Faint ceiling fan hum.');
    expect(result).toMatch(/speaker:\s*MRS\.\s*SINGH/i);
    expect(result).toMatch(/DIALOGUE:.*Late again, Parvati/);
    expect(result).toMatch(/AMBIENT:.*ceiling fan hum/);
  });

  it('emits guidance about reading the dialogue verbatim into the motion directive', () => {
    // The block isn't just data — it carries an explicit instruction
    // so the LLM doesn't ignore it. Match a cue indicating the
    // dialogue must be emitted verbatim in a "says" clause.
    const result = buildShotAudioBlock('PARVATI: She will run. Wet scrubbing sounds.');
    expect(result).toMatch(/verbatim|exactly|MUST/i);
  });
});

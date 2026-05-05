/**
 * Tests for `stripSpeechVerbs`.
 *
 * Background: in prompt-relay mode, LTX 2.3's audio head fires on
 * motion-directive verbs like "speaking", "calls out", "whispers".
 * Even with the negative prompt suppressing "speech/dialogue/talking",
 * the positive signal wins and the model produces phoneme-shaped
 * gibberish (sounds like a language but isn't). Stripping the speech
 * clauses from local_prompts before submission removes the trigger.
 *
 * The function operates at clause level: split on `,` and `.`, drop
 * any clause that contains a speech-verb pattern, rejoin. Visual
 * description and movement stay intact.
 */
import { describe, it, expect } from 'vitest';
import { stripSpeechVerbs } from '../../src/services/providers/stripSpeechVerbs.js';

describe('stripSpeechVerbs', () => {
  it('drops clauses containing "speaking"', () => {
    const input = 'The runner girl bounces on her feet, speaking quickly, her hand on her bag strap';
    const result = stripSpeechVerbs(input);
    expect(result).not.toMatch(/speaking/i);
    expect(result).toMatch(/bounces on her feet/);
    expect(result).toMatch(/her hand on her bag strap/);
  });

  it('drops clauses containing "calls out"', () => {
    const input = 'She raises her hand and calls out to him, her shoulders straight';
    const result = stripSpeechVerbs(input);
    expect(result).not.toMatch(/calls? out/i);
    expect(result).toMatch(/her shoulders straight/);
  });

  it('drops clauses containing "whispers"', () => {
    const input = 'Parvati leans forward, whispers a fierce vow, then turns away';
    const result = stripSpeechVerbs(input);
    expect(result).not.toMatch(/whispers?/i);
    expect(result).toMatch(/leans forward/);
    expect(result).toMatch(/turns away/);
  });

  it('drops sentence-level matches at the start of a sentence', () => {
    const input = 'Isha speaks rapidly. The wind whips past her ponytail.';
    const result = stripSpeechVerbs(input);
    expect(result).not.toMatch(/speaks/i);
    expect(result).toMatch(/wind whips past her ponytail/);
  });

  it('handles multiple speech verbs in one prompt', () => {
    const input = 'The mother stands still, the daughter speaks to her, the dust rises, she replies softly';
    const result = stripSpeechVerbs(input);
    expect(result).not.toMatch(/speaks/i);
    expect(result).not.toMatch(/replies/i);
    expect(result).toMatch(/mother stands still/);
    expect(result).toMatch(/dust rises/);
  });

  it('preserves the prompt unchanged when no speech verbs are present', () => {
    const input = 'A wide low-angle shot of the gate, dust motes catching golden light';
    const result = stripSpeechVerbs(input);
    expect(result).toBe(input);
  });

  it('does not match speech-verb substrings in unrelated words', () => {
    // "spoke" is a speech verb; "speakers" or "speakerphone" aren't action verbs.
    // "talks" matches but "stalks" should not.
    const input = 'The hunter stalks through the forest, the bicycle has spoke wheels';
    const result = stripSpeechVerbs(input);
    expect(result).toMatch(/stalks through the forest/);
    expect(result).toMatch(/spoke wheels/);
  });

  it('returns empty string when ALL clauses contain speech verbs', () => {
    const input = 'She speaks. He talks. They whisper.';
    const result = stripSpeechVerbs(input);
    expect(result.trim()).toBe('');
  });

  it('cleans up extra punctuation when clauses are removed', () => {
    const input = 'She walks forward, speaks to him, her hand raised';
    const result = stripSpeechVerbs(input);
    // No double commas, no trailing comma
    expect(result).not.toMatch(/,\s*,/);
    expect(result).not.toMatch(/,\s*$/);
    expect(result).not.toMatch(/^\s*,/);
  });

  it('handles "mouth movement" / "lip sync" descriptors', () => {
    // These are also LTX audio triggers per the existing negative prompt.
    const input = 'She faces the camera with mouth movement, then turns away';
    const result = stripSpeechVerbs(input);
    expect(result).not.toMatch(/mouth movement/i);
    expect(result).toMatch(/turns away/);
  });

  it('handles "shouts/screams/exclaims" past-tense and present-tense', () => {
    expect(stripSpeechVerbs('She shouts a warning, her hand raised')).toMatch(/her hand raised/);
    expect(stripSpeechVerbs('She shouts a warning, her hand raised')).not.toMatch(/shouts/i);
    expect(stripSpeechVerbs('He screamed in shock, the dust rose')).not.toMatch(/screamed/i);
    expect(stripSpeechVerbs('Mrs. Singh exclaims at the late arrival, her cup down')).not.toMatch(/exclaims/i);
  });
});

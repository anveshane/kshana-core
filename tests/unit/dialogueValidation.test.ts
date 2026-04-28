/**
 * dialogueValidation — soft-warn scanners that detect dialogue
 * drift from the scene_breakdown / motion_directive guide rules.
 * Both are pure functions with no side effects.
 */
import { describe, it, expect } from 'vitest';
import {
  scanMultiSpeakerShots,
  scanAmbiguousSpeakerTag,
} from '../../src/core/planner/dialogueValidation.js';

describe('scanMultiSpeakerShots', () => {
  it('flags a shot whose audio has two speakers', () => {
    const shots = [{
      shotNumber: 3,
      audio: "ALPHA: First line. BRAVO: Second line.",
    }];
    const w = scanMultiSpeakerShots(shots);
    expect(w).toHaveLength(1);
    expect(w[0]!.shotNumber).toBe(3);
    expect(w[0]!.speakers.sort()).toEqual(['alpha', 'bravo']);
  });

  it('does not flag a single-speaker shot', () => {
    const shots = [{ shotNumber: 1, audio: "ALPHA: Only one line here. Ambient wind." }];
    expect(scanMultiSpeakerShots(shots)).toHaveLength(0);
  });

  it('does not flag pure ambient audio', () => {
    const shots = [{ shotNumber: 1, audio: "distant thunder, cicada hum, soft rain" }];
    expect(scanMultiSpeakerShots(shots)).toHaveLength(0);
  });

  it('handles multi-word speaker names ("MRS. SINGH:") as one speaker', () => {
    const shots = [{
      shotNumber: 2,
      audio: "MRS. TULLY: You're late. Newspaper rustling.",
    }];
    expect(scanMultiSpeakerShots(shots)).toHaveLength(0);
  });

  it('flags 3+ speakers in a crowded shot', () => {
    const shots = [{
      shotNumber: 5,
      audio: "ALPHA: Here. BRAVO: No. CHARLIE: Wait.",
    }];
    const w = scanMultiSpeakerShots(shots);
    expect(w).toHaveLength(1);
    expect(w[0]!.speakers.length).toBeGreaterThanOrEqual(3);
  });

  it('scans a list and returns one warning per offending shot', () => {
    const shots = [
      { shotNumber: 1, audio: "ALPHA: hi" },                  // clean
      { shotNumber: 2, audio: "ALPHA: hi. BRAVO: hi" },       // multi
      { shotNumber: 3, audio: "ambient noises only" },        // clean
      { shotNumber: 4, audio: "DELTA: first. ECHO: second" }, // multi
    ];
    const w = scanMultiSpeakerShots(shots);
    expect(w.map(x => x.shotNumber)).toEqual([2, 4]);
  });

  it('handles missing / empty audio gracefully', () => {
    expect(scanMultiSpeakerShots([{ shotNumber: 1 }])).toHaveLength(0);
    expect(scanMultiSpeakerShots([{ shotNumber: 1, audio: '' }])).toHaveLength(0);
  });

  it('case-insensitively dedups the same speaker written twice', () => {
    // Same speaker twice → still one speaker, no warning.
    const shots = [{ shotNumber: 1, audio: "ALPHA: Line one. ALPHA: Line two." }];
    expect(scanMultiSpeakerShots(shots)).toHaveLength(0);
  });
});

describe('scanAmbiguousSpeakerTag', () => {
  it('flags a bare "She says" when 2+ chars are in the shot', () => {
    const md = `The figure at the window turns. She says "Stay here."`;
    const w = scanAmbiguousSpeakerTag(md, ['alpha', 'bravo']);
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]!.reason).toContain('too generic');
  });

  it('flags "The woman says" when 2+ chars are in the shot', () => {
    const md = `The woman at the dining table, lowering her gaze, says "We shall see."`;
    const w = scanAmbiguousSpeakerTag(md, ['alpha', 'bravo']);
    expect(w).toHaveLength(1);
    expect(w[0]!.quotedDialogue).toBe('We shall see.');
  });

  it('flags "The man says"', () => {
    const md = `The man says "Get out."`;
    expect(scanAmbiguousSpeakerTag(md, ['alpha', 'bravo'])).toHaveLength(1);
  });

  it('flags "Woman says" without an article (sentence-start)', () => {
    const md = `Static close-up. Woman says "That girl."`;
    const w = scanAmbiguousSpeakerTag(md, ['alpha', 'bravo']);
    expect(w).toHaveLength(1);
  });

  it('does NOT flag "The tall woman says" — adjective is a valid descriptor', () => {
    // "tall" sits between article and class noun, breaking direct
    // adjacency. The scanner treats this as a proper visual descriptor
    // (bearded, young, silver-haired, etc. are all valid disambiguators).
    const md = `The tall woman says "Hello."`;
    expect(scanAmbiguousSpeakerTag(md, ['alpha', 'bravo'])).toHaveLength(0);
  });

  it('does NOT flag a unique visual descriptor', () => {
    const md = `The bearded captain in the oilskin coat, gripping the helm, says "Hold fast!"`;
    expect(scanAmbiguousSpeakerTag(md, ['captain', 'deckhand'])).toHaveLength(0);
  });

  it('does NOT flag bare pronouns when only 1 char is in the shot', () => {
    // A solo-character shot can safely use "She says" — no disambiguation needed.
    const md = `The figure turns. She says "Hello."`;
    expect(scanAmbiguousSpeakerTag(md, ['alpha'])).toHaveLength(0);
    expect(scanAmbiguousSpeakerTag(md, [])).toHaveLength(0);
  });

  it('flags multiple ambiguous tags in the same directive', () => {
    const md = `The woman says "Go." The man says "Wait."`;
    const w = scanAmbiguousSpeakerTag(md, ['a', 'b']);
    expect(w).toHaveLength(2);
  });

  it('handles curly quotes and typographic apostrophes', () => {
    const md = `The woman says “We shall see.”`;
    const w = scanAmbiguousSpeakerTag(md, ['a', 'b']);
    expect(w).toHaveLength(1);
    expect(w[0]!.quotedDialogue).toBe('We shall see.');
  });

  it('returns an empty array for an empty motion directive', () => {
    expect(scanAmbiguousSpeakerTag('', ['a', 'b'])).toHaveLength(0);
  });
});

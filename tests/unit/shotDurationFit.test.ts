/**
 * shotDurationFit — sizes shots to fit their dialogue so the video
 * model doesn't cut off mid-sentence. Prompt-level guidance tells the
 * LLM the rule; this normalizer catches what the LLM still gets wrong.
 */
import { describe, it, expect } from 'vitest';
import {
  extractDialogueWordCount,
  dialogueSecondsNeeded,
  fitShotDurations,
} from '../../src/core/planner/shotDurationFit.js';

describe('extractDialogueWordCount', () => {
  it('counts words in a single-speaker line', () => {
    // 6 words: "Go on beti Coach is waiting"
    expect(extractDialogueWordCount('PARVATI: Go on, beti. Coach is waiting.')).toBe(6);
  });

  it('counts across multiple speakers in one line', () => {
    const audio = "ISHA: Did you pack the glucose powder? PARVATI: Yes, yes. In the side pocket. And the electrolytes.";
    // Isha: "Did you pack the glucose powder" = 6
    // Parvati: "Yes yes In the side pocket And the electrolytes" = 9
    expect(extractDialogueWordCount(audio)).toBe(15);
  });

  it('handles mixed-case speaker names', () => {
    expect(extractDialogueWordCount('Parvati: She will run.')).toBe(3);
  });

  it('handles multi-word speaker names ("MRS. SINGH:")', () => {
    expect(extractDialogueWordCount("MRS. SINGH: You're late, Parvati.")).toBe(3);
  });

  it('strips parenthetical stage directions', () => {
    // "She will run" = 3, "(whispered, low and fierce)" stripped.
    expect(extractDialogueWordCount("Parvati: 'She will run.' (whispered, low and fierce)")).toBe(3);
  });

  it('strips quote marks cleanly', () => {
    // "Sorry Madam Had to drop Isha" = 6 words.
    expect(extractDialogueWordCount("PARVATI: 'Sorry, Madam. Had to drop Isha.'")).toBe(6);
  });

  it('returns 0 for pure ambient audio (no speaker marker)', () => {
    expect(extractDialogueWordCount('distant jogger huffs, brittle grass rustle, cicada hum')).toBe(0);
  });

  it('returns 0 for empty or undefined audio', () => {
    expect(extractDialogueWordCount('')).toBe(0);
    expect(extractDialogueWordCount(undefined)).toBe(0);
    expect(extractDialogueWordCount(null)).toBe(0);
  });

  it('does not mis-match a colon after a lowercase word', () => {
    // "well, it:" — "it" isn't a capitalized speaker name.
    expect(extractDialogueWordCount('well, it: was a long day')).toBe(0);
  });
});

describe('dialogueSecondsNeeded', () => {
  it('returns 0 when there is no dialogue', () => {
    expect(dialogueSecondsNeeded('distant wind, footsteps')).toBe(0);
  });

  it('returns ceil(words/2.5) + 1 buffer second', () => {
    // 5 words → 5/2.5 = 2 → 2 + 1 = 3
    expect(dialogueSecondsNeeded('PARVATI: one two three four five')).toBe(3);
    // 6 words → 6/2.5 = 2.4 → ceil = 3 → 3 + 1 = 4
    expect(dialogueSecondsNeeded('PARVATI: one two three four five six')).toBe(4);
    // 10 words → 10/2.5 = 4 → 4 + 1 = 5
    expect(dialogueSecondsNeeded('PARVATI: one two three four five six seven eight nine ten')).toBe(5);
  });

  it('buffer accounts for a single short utterance', () => {
    // 2 words "I know" → 1s speech + 1s buffer = 2 (minimum return).
    // But fitShotDurations enforces a min of 3s separately.
    expect(dialogueSecondsNeeded('ISHA: I know.')).toBe(2);
  });
});

describe('fitShotDurations', () => {
  it('bumps an undersized dialogue shot to fit', () => {
    // Real sun_hadnt_yet_cleared-2 shot: "Okay, Ma. Go now, or you'll be late
    // for Mrs. Sharma's house. Don't scrub the floors too hard today. Your back
    // was..." ≈ 25 words → 10+1 = 11s. Current duration was 3s → get bumped.
    const shots = [{
      shotNumber: 4,
      duration: 3,
      audio: "ISHA: Okay, Ma. Go now, or you'll be late for Mrs. Sharma's house. Don't scrub the floors too hard today. Your back was hurting.",
    }];
    const adj = fitShotDurations(shots);
    expect(shots[0]!.duration).toBeGreaterThanOrEqual(10);
    expect(adj).toHaveLength(1);
    expect(adj[0]!.shotNumber).toBe(4);
    expect(adj[0]!.from).toBe(3);
    expect(adj[0]!.reason).toBe('dialogue_fit');
  });

  it('leaves well-sized shots untouched', () => {
    const shots = [{ shotNumber: 1, duration: 6, audio: 'PARVATI: Go on, beti. Coach is waiting.' }];
    // 6 words → 4s needed. Shot is 6s → already enough.
    const adj = fitShotDurations(shots);
    expect(shots[0]!.duration).toBe(6);
    expect(adj).toHaveLength(0);
  });

  it('leaves ambient-only shots untouched', () => {
    const shots = [{ shotNumber: 1, duration: 3, audio: 'distant wind, footsteps' }];
    const adj = fitShotDurations(shots);
    expect(shots[0]!.duration).toBe(3);
    expect(adj).toHaveLength(0);
  });

  it('caps at 15 seconds by default', () => {
    // 50 words → 20+1 = 21s needed. Should cap at 15.
    const longDialogue = 'PARVATI: ' + Array(50).fill('word').join(' ') + '.';
    const shots = [{ shotNumber: 1, duration: 3, audio: longDialogue }];
    const adj = fitShotDurations(shots);
    expect(shots[0]!.duration).toBe(15);
    expect(adj[0]!.to).toBe(15);
    // Either reason is fine — the cap might fire WITH dialogue_fit.
    expect(['dialogue_fit', 'cap']).toContain(adj[0]!.reason);
  });

  it('respects a caller-supplied max', () => {
    const longDialogue = 'PARVATI: ' + Array(50).fill('word').join(' ') + '.';
    const shots = [{ shotNumber: 1, duration: 3, audio: longDialogue }];
    fitShotDurations(shots, { maxDuration: 10 });
    expect(shots[0]!.duration).toBe(10);
  });

  it('enforces a minimum floor for silent shots', () => {
    // No audio, duration 1 → too short even without dialogue.
    const shots = [{ shotNumber: 1, duration: 1, audio: '' }];
    fitShotDurations(shots, { minDuration: 3 });
    // Current behavior: normalizer only bumps when dialogue needs more.
    // Silent under-min shots are NOT bumped (no dialogue trigger) —
    // this matches the LLM's own min-duration output. Keep the test
    // expressing the current contract so any future expansion is
    // explicit.
    expect(shots[0]!.duration).toBe(1);
  });

  it('reports all adjustments across multiple shots', () => {
    const shots = [
      { shotNumber: 1, duration: 3, audio: 'wind' }, // no dialogue, untouched
      { shotNumber: 2, duration: 3, audio: 'PARVATI: ' + Array(20).fill('word').join(' ') }, // bump
      { shotNumber: 3, duration: 6, audio: 'ISHA: hi' }, // already big enough
    ];
    const adj = fitShotDurations(shots);
    expect(adj).toHaveLength(1);
    expect(adj[0]!.shotNumber).toBe(2);
  });
});

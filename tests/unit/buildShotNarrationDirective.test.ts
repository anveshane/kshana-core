/**
 * Tests for `buildShotNarrationDirective`.
 *
 * Background: StoryEssence.narration { mode, voice } describes how a
 * narrator's voice carries content the camera and dialogue can't. The
 * scene-prose generator already injects this; the motion-directive
 * generator hasn't been wired to it. With pervasive narration enabled,
 * the LLM should optionally emit a narrator line on top of (or in
 * place of) character dialogue when the shot benefits — e.g. interior
 * thought beats or transition moments.
 *
 * Modes:
 *   - 'none' → no block emitted (caller skips)
 *   - 'minimal' → narrator allowed only at scene transitions / key beats
 *   - 'pervasive' → narrator routinely available, voice-tuned
 */
import { describe, it, expect } from 'vitest';
import { buildShotNarrationDirective } from '../../src/core/planner/buildShotNarrationDirective.js';

describe('buildShotNarrationDirective', () => {
  it('returns empty string when narration is undefined', () => {
    expect(buildShotNarrationDirective(undefined)).toBe('');
  });

  it('returns empty string when mode is none', () => {
    expect(buildShotNarrationDirective({ mode: 'none', voice: '' })).toBe('');
  });

  it('emits a <narration> block for mode=minimal with the voice descriptor', () => {
    const result = buildShotNarrationDirective({
      mode: 'minimal',
      voice: 'third-person omniscient, somber, parental',
    });
    expect(result).toContain('<narration>');
    expect(result).toContain('</narration>');
    expect(result).toContain('third-person omniscient, somber, parental');
    expect(result).toMatch(/minimal|sparingly|only at|key beat|transition/i);
  });

  it('emits a <narration> block for mode=pervasive with stronger guidance', () => {
    const result = buildShotNarrationDirective({
      mode: 'pervasive',
      voice: 'first-person, retrospective',
    });
    expect(result).toContain('<narration>');
    expect(result).toContain('first-person, retrospective');
    expect(result).toMatch(/pervasive|liberally|routine|throughout/i);
  });

  it('describes the narrator template format the LLM should use', () => {
    const result = buildShotNarrationDirective({
      mode: 'pervasive',
      voice: 'third-person omniscient',
    });
    // Must teach the LLM the narrator-line format so the motion
    // directive can attach it. e.g. `Narrator says "..."` or
    // `Voice over: "..."` — match a few plausible cues.
    expect(result).toMatch(/narrator|voice ?over|VO:/i);
    expect(result).toMatch(/says|"|format/i);
  });

  it('clarifies narrator is OPTIONAL — does not force every shot to have one', () => {
    const result = buildShotNarrationDirective({
      mode: 'minimal',
      voice: 'somber third-person',
    });
    expect(result).toMatch(/optional|may|when needed|when it serves/i);
  });

  it('says do NOT replace character dialogue with narrator when both are present', () => {
    const result = buildShotNarrationDirective({
      mode: 'pervasive',
      voice: 'observer',
    });
    expect(result).toMatch(/do not replace|alongside|in addition to|both/i);
  });
});

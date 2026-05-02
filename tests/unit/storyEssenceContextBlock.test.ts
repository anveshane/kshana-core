/**
 * Tests for the story-essence context block builder.
 *
 * The function is what `ExecutorAgent.buildPromptContext` injects into
 * the user prompt for `scene` nodes when `prompts/story_essence.json`
 * has been generated. It carries genre / throughline / tonal notes /
 * dramatic emphasis and a small genre-tuned guidance line so the
 * scene-prose LLM call writes voice that matches the kind of story
 * being told.
 *
 * Tests cover:
 *   - happy path: full essence renders all four fields + a genre-tuned
 *     guidance line
 *   - null/undefined essence: empty string, NO block injected
 *   - genre matching: known genres get their tuned guidance, unknown
 *     genres fall back to a generic line (no crash, no empty)
 */
import { describe, it, expect } from 'vitest';
import { buildStoryEssenceBlock } from '../../src/core/planner/storyEssenceContextBlock.js';
import type { StoryEssence } from '../../src/core/planner/storyEssenceExtractor.js';

const dramaEssence: StoryEssence = {
  genre: 'emotional drama',
  throughline: 'A mother\'s grit and sacrifice are repaid in a quiet, hard-won victory.',
  tonalNotes: 'Linger on quiet moments. Let small physical detail carry the weight.',
  dramaticEmphasis: 'Internal conflict, mother-daughter bond, sacrifice over years.',
  narration: { mode: 'pervasive', voice: 'third-person omniscient, somber, parental' },
};

const actionEssence: StoryEssence = {
  genre: 'sci-fi action',
  throughline: 'A survivor outruns hostile drones across a dead Earth.',
  tonalNotes: 'Tight cuts, kinetic camera, no breathing room.',
  dramaticEmphasis: 'External survival, escalating threat.',
  narration: { mode: 'none', voice: '' },
};

describe('buildStoryEssenceBlock', () => {
  it('returns an empty string when essence is null', () => {
    expect(buildStoryEssenceBlock(null)).toBe('');
  });

  it('returns an empty string when essence is undefined', () => {
    expect(buildStoryEssenceBlock(undefined)).toBe('');
  });

  it('renders all four essence fields in the block when essence is provided', () => {
    const block = buildStoryEssenceBlock(dramaEssence);
    expect(block).toContain('<story-essence>');
    expect(block).toContain('</story-essence>');
    expect(block).toContain('emotional drama');
    expect(block).toContain('mother\'s grit');
    expect(block).toContain('Linger on quiet moments');
    expect(block).toContain('mother-daughter bond');
  });

  it('includes genre-tuned guidance for emotional drama (linger / quiet / detail)', () => {
    const block = buildStoryEssenceBlock(dramaEssence);
    // Drama guidance asks for breathing room, internal state via small physical detail.
    expect(block.toLowerCase()).toMatch(/linger|silence|breathe|quiet|small.*detail/);
  });

  it('includes genre-tuned guidance for action (punchy / verbs / cut quick)', () => {
    const block = buildStoryEssenceBlock(actionEssence);
    expect(block.toLowerCase()).toMatch(/punch|verb|kinetic|tight|fast/);
  });

  it('falls back to a generic guidance line for an unknown genre without crashing', () => {
    const weirdEssence: StoryEssence = {
      genre: 'absurdist surrealist clown opera',
      throughline: 'A clown discovers the void.',
      tonalNotes: 'Disorienting.',
      dramaticEmphasis: 'Existential dread.',
      narration: { mode: 'none', voice: '' },
    };
    const block = buildStoryEssenceBlock(weirdEssence);
    expect(block).toContain('<story-essence>');
    expect(block).toContain('absurdist surrealist clown opera');
    // Generic fallback: ask the writer to honor the throughline + tonal notes.
    expect(block.toLowerCase()).toMatch(/throughline|tonal|essence|tone/);
  });

  it('includes the directive that prose must serve the essence', () => {
    const block = buildStoryEssenceBlock(dramaEssence);
    // Active directive language so prose tone matches the essence —
    // not just a passive context dump.
    expect(block.toLowerCase()).toMatch(/in service of|serve|tune|match/);
  });
});

// ── Narration directive ─────────────────────────────────────────────────────

describe('buildStoryEssenceBlock — narration directive', () => {
  it('omits any narration directive when mode is "none"', () => {
    const block = buildStoryEssenceBlock(actionEssence);
    expect(block.toLowerCase()).not.toContain('narration');
    expect(block).not.toContain('NARRATION (V.O.');
  });

  it('emits a narration directive when mode is "pervasive", with voice and format hint', () => {
    const block = buildStoryEssenceBlock(dramaEssence);
    // The block must mention narration is active, name the voice, and
    // tell the model how to format narration blocks so downstream tooling
    // (TTS pipeline, subtitles) can extract them.
    expect(block.toLowerCase()).toContain('narration');
    expect(block).toContain('third-person omniscient, somber, parental');
    // Format hint — pick any of the conventional V.O. markers we accept.
    expect(block).toMatch(/NARRATION \(V\.O\.|VOICEOVER|V\.O\./);
  });

  it('emits a directive for "minimal" mode that scopes narration to scene transitions / key beats', () => {
    const minimalEssence: StoryEssence = {
      ...actionEssence,
      narration: { mode: 'minimal', voice: 'first-person, retrospective' },
    };
    const block = buildStoryEssenceBlock(minimalEssence);
    expect(block.toLowerCase()).toContain('narration');
    expect(block).toContain('first-person, retrospective');
    // Minimal mode should ASK the model to use narration sparingly —
    // the directive must include the "sparing" / "transitions only" idea.
    expect(block.toLowerCase()).toMatch(/sparingly|only when|key (exposition|beats|moments)|transition/);
  });

  it('warns the model not to overuse narration when mode is non-"none"', () => {
    const block = buildStoryEssenceBlock(dramaEssence);
    // Even pervasive narration must earn its place — the directive should
    // tell the model to use narration only where camera/dialogue genuinely
    // can't carry the content, not as a shortcut.
    expect(block.toLowerCase()).toMatch(/earn|only when|cannot|can.?t.*carry|interior|cannot be (shown|carried)/);
  });
});

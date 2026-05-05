/**
 * TDD tests for the prompt-relay global prompt builder.
 *
 * The global prompt is what's patched once across the whole video. It
 * must anchor identity + style and give a brief scene beat — but it
 * MUST NOT be a past-tense plot summary, because LTX-2.3's audio head
 * reads narrative-shaped text as voice-over and invents a narrator.
 *
 * Inputs: list of (character name, brief visual description),
 * scene-level description (visual/atmospheric, kept short), project
 * style ("anime", "noir", etc.).
 *
 * Output: a single string suitable as the `global_prompt` field on
 * PromptRelayEncode.
 */

import { describe, it, expect } from 'vitest';
import { buildPromptRelayGlobalPrompt } from '../../src/services/providers/promptRelayGlobalPrompt.js';

describe('buildPromptRelayGlobalPrompt', () => {
  it('opens with style + cinematic-continuity anchor', () => {
    const out = buildPromptRelayGlobalPrompt({
      style: 'anime',
      characters: [],
      sceneDescription: '',
    });
    expect(out.toLowerCase()).toContain('anime style');
    expect(out.toLowerCase()).toMatch(/continuity|consistent/);
  });

  it('falls back to cinematic when style is empty', () => {
    const out = buildPromptRelayGlobalPrompt({
      style: '',
      characters: [],
      sceneDescription: '',
    });
    expect(out.toLowerCase()).toContain('cinematic');
  });

  it('includes each character name as an identifier with their description', () => {
    const out = buildPromptRelayGlobalPrompt({
      style: 'noir',
      characters: [
        { name: 'Vikram', description: 'detective in late 30s, dark coat, weathered face' },
        { name: 'Laila', description: 'woman in crimson sari, hennaed hands' },
      ],
      sceneDescription: '',
    });
    expect(out).toContain('Vikram');
    expect(out).toContain('detective in late 30s, dark coat, weathered face');
    expect(out).toContain('Laila');
    expect(out).toContain('crimson sari');
  });

  it('includes the scene description', () => {
    const out = buildPromptRelayGlobalPrompt({
      style: 'noir',
      characters: [{ name: 'Vikram', description: 'detective' }],
      sceneDescription: 'Torch-lit dhaba in monsoon rain. Vikram receives a bloodstained seal and pursues a cloaked figure.',
    });
    expect(out).toContain('Torch-lit dhaba');
    expect(out).toContain('cloaked figure');
  });

  it('truncates long character descriptions so the prompt stays focused', () => {
    const long = 'a'.repeat(2000);
    const out = buildPromptRelayGlobalPrompt({
      style: 'anime',
      characters: [{ name: 'X', description: long }],
      sceneDescription: '',
    });
    // Each character description should be capped well below 1000 chars
    // so the prompt doesn't drown the relay's per-segment local prompts.
    expect(out.length).toBeLessThan(2000);
  });

  it('handles missing/empty characters gracefully', () => {
    const out = buildPromptRelayGlobalPrompt({
      style: 'anime',
      characters: [],
      sceneDescription: 'A village by the river at dawn.',
    });
    expect(out).toContain('A village by the river at dawn');
    expect(out.toLowerCase()).toContain('anime style');
  });

  it('skips characters with empty names or descriptions', () => {
    const out = buildPromptRelayGlobalPrompt({
      style: 'anime',
      characters: [
        { name: '', description: 'no name' },
        { name: 'NoDesc', description: '' },
        { name: 'Real', description: 'has both' },
      ],
      sceneDescription: '',
    });
    expect(out).toContain('Real');
    expect(out).toContain('has both');
    expect(out).not.toContain('no name');
    expect(out).not.toContain('NoDesc');
  });

  it('produces a single string (not multiline JSON or structured object)', () => {
    const out = buildPromptRelayGlobalPrompt({
      style: 'anime',
      characters: [{ name: 'A', description: 'b' }],
      sceneDescription: 'c',
    });
    expect(typeof out).toBe('string');
    expect(out).not.toMatch(/^\{/);   // not a JSON object
    expect(out).not.toMatch(/^\[/);   // not a JSON array
  });
});

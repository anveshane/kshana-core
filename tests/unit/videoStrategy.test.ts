/**
 * TDD tests for the video-render strategy resolver.
 *
 * Defaults to `prompt_relay` (one mp4 per scene, rendered via LTX 2.3 +
 * kijai PromptRelay). Setting `KSHANA_VIDEO_STRATEGY=per_shot` opts out
 * and falls back to the existing per-shot FL2V flow.
 *
 * Pure function — no env mutation, takes the env explicitly so tests
 * stay deterministic and parallel-safe.
 */

import { describe, it, expect } from 'vitest';
import { getVideoStrategy, isPromptRelayMode } from '../../src/services/providers/videoStrategy.js';

describe('getVideoStrategy', () => {
  it('defaults to prompt_relay when env var is unset', () => {
    expect(getVideoStrategy({})).toBe('prompt_relay');
  });

  it('returns per_shot when KSHANA_VIDEO_STRATEGY=per_shot', () => {
    expect(getVideoStrategy({ KSHANA_VIDEO_STRATEGY: 'per_shot' })).toBe('per_shot');
  });

  it('returns prompt_relay when KSHANA_VIDEO_STRATEGY=prompt_relay', () => {
    expect(getVideoStrategy({ KSHANA_VIDEO_STRATEGY: 'prompt_relay' })).toBe('prompt_relay');
  });

  it('treats unknown values as prompt_relay (the default) rather than throwing', () => {
    // We don't want a typo in the env to crash the whole pipeline; default is safest.
    expect(getVideoStrategy({ KSHANA_VIDEO_STRATEGY: 'gibberish' })).toBe('prompt_relay');
  });

  it('is case-insensitive', () => {
    expect(getVideoStrategy({ KSHANA_VIDEO_STRATEGY: 'PER_SHOT' })).toBe('per_shot');
    expect(getVideoStrategy({ KSHANA_VIDEO_STRATEGY: 'Prompt_Relay' })).toBe('prompt_relay');
  });

  it('treats empty string as unset', () => {
    expect(getVideoStrategy({ KSHANA_VIDEO_STRATEGY: '' })).toBe('prompt_relay');
  });
});

describe('isPromptRelayMode', () => {
  it('true by default', () => {
    expect(isPromptRelayMode({})).toBe(true);
  });

  it('false when per_shot', () => {
    expect(isPromptRelayMode({ KSHANA_VIDEO_STRATEGY: 'per_shot' })).toBe(false);
  });
});

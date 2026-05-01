import { describe, it, expect } from 'vitest';
import { resolveStyle } from '../../scripts/styleAlias.js';

describe('resolveStyle — friendly aliases for pnpm new --style', () => {
  it('canonicalizes live-action aliases to cinematic_realism', () => {
    for (const alias of ['live', 'live-action', 'live_action', 'liveaction',
      'realism', 'realistic', 'cinematic', 'cinematic_realism', 'photorealistic', 'real']) {
      expect(resolveStyle(alias)).toBe('cinematic_realism');
    }
  });

  it('canonicalizes animation aliases to anime', () => {
    for (const alias of ['anime', 'animation', 'animated', 'cartoon', '2d', 'illustrated']) {
      expect(resolveStyle(alias)).toBe('anime');
    }
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveStyle('LIVE')).toBe('cinematic_realism');
    expect(resolveStyle(' Anime ')).toBe('anime');
    expect(resolveStyle('Cinematic_Realism')).toBe('cinematic_realism');
  });

  it('returns null for unknown styles', () => {
    expect(resolveStyle('noir')).toBeNull(); // not yet a top-level option
    expect(resolveStyle('vaporwave')).toBeNull();
    expect(resolveStyle('')).toBeNull();
  });
});

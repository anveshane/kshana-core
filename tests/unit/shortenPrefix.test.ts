/**
 * Saved image/video files on disk are named using a filename prefix
 * supplied by the caller (e.g. ExecutorAgent). The prefix carries
 * per-shot context like `scene_1_shot_3_last_frame`. Shortening it to
 * `s1shot3_last_frame` keeps Finder listings scannable without losing
 * the shot/frame identity.
 *
 * Regression-tests the pure helper so renames don't break quietly.
 */
import { describe, it, expect } from 'vitest';
import { shortenPrefix, shortModelName } from '../../src/services/providers/comfyui/ComfyUIProvider.js';

describe('shortenPrefix', () => {
  it('shortens a well-formed shot prefix', () => {
    expect(shortenPrefix('scene_1_shot_3_last_frame')).toBe('s1shot3_last_frame');
  });

  it('handles two-digit scene and shot numbers', () => {
    expect(shortenPrefix('scene_12_shot_7_first_frame')).toBe('s12shot7_first_frame');
  });

  it('handles both scene and shot in the same prefix', () => {
    expect(shortenPrefix('scene_2_shot_5_edit_previous_shot_layer1')).toBe('s2shot5_edit_previous_shot_layer1');
  });

  it('passes through character-ref style prefixes', () => {
    expect(shortenPrefix('CharRef_vikram')).toBe('CharRef_vikram');
    expect(shortenPrefix('SettingRef_torch_lit_dhaba')).toBe('SettingRef_torch_lit_dhaba');
  });

  it('returns empty string for undefined or empty input', () => {
    expect(shortenPrefix(undefined)).toBe('');
    expect(shortenPrefix('')).toBe('');
  });

  it('strips characters that are unsafe in filenames', () => {
    expect(shortenPrefix('scene_1_shot_3 / last frame')).toBe('s1shot3_last_frame');
  });

  it('collapses repeated underscores', () => {
    expect(shortenPrefix('scene_1_shot_3__last__frame')).toBe('s1shot3_last_frame');
  });
});

describe('shortModelName', () => {
  it('recognizes Klein variants', () => {
    expect(shortModelName('flux2_klein_edit_cloud')).toBe('klein');
    expect(shortModelName('klein_v2')).toBe('klein');
  });

  it('recognizes Grok', () => {
    expect(shortModelName('grok_image_edit')).toBe('grok');
  });

  it('recognizes zimage variants', () => {
    expect(shortModelName('zimage_standard_cloud')).toBe('zimage');
    expect(shortModelName('zimage_cloud')).toBe('zimage');
    expect(shortModelName('zimage')).toBe('zimage');
  });

  it('recognizes LTX video workflows', () => {
    expect(shortModelName('ltx23_fl2v_cloud')).toBe('ltx23');
    expect(shortModelName('ltx23_fml2v_cloud')).toBe('ltx23');
  });

  it('recognizes Qwen and generic Flux', () => {
    expect(shortModelName('qwen_edit')).toBe('qwen');
    expect(shortModelName('flux_schnell')).toBe('flux');
  });

  it('falls back to first token for unknown workflow IDs', () => {
    expect(shortModelName('custom_model_v2')).toBe('custom');
  });

  it('returns empty string for undefined/empty input', () => {
    expect(shortModelName(undefined)).toBe('');
    expect(shortModelName('')).toBe('');
  });

  it('is case-insensitive for pattern matching', () => {
    expect(shortModelName('FLUX2_Klein_Edit')).toBe('klein');
  });
});

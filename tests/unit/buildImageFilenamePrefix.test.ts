/**
 * Tests for `buildImageFilenamePrefix`.
 *
 * Background: ComfyUI saves outputs using whatever filenamePrefix we pass.
 * For character refs we use `CharRef_<name>`, for setting refs
 * `SettingRef_<name>` — both scannable in Finder. Object refs were
 * silently falling through to the scene-level branch and getting saved
 * as `scene_1_0002.png` etc, indistinguishable from shot images. The
 * helper now branches on `object_ref` and yields `ObjectRef_<name>`.
 */
import { describe, it, expect } from 'vitest';
import { buildImageFilenamePrefix } from '../../src/tasks/video/buildImageFilenamePrefix.js';

describe('buildImageFilenamePrefix', () => {
  it('returns CharRef_<name> for character refs', () => {
    expect(buildImageFilenamePrefix({
      image_type: 'character_ref',
      character_name: 'Parvati',
      scene_number: 1,
    })).toBe('CharRef_Parvati');
  });

  it('returns SettingRef_<name> for setting refs', () => {
    expect(buildImageFilenamePrefix({
      image_type: 'setting_ref',
      setting_name: 'Singh Bungalow',
      scene_number: 1,
    })).toBe('SettingRef_SinghBungalow');
  });

  it('returns ObjectRef_<name> for object refs (was falling through to scene)', () => {
    expect(buildImageFilenamePrefix({
      image_type: 'object_ref',
      object_name: 'tiffin carriers',
      scene_number: 1,
    })).toBe('ObjectRef_tiffincarriers');
  });

  it('strips non-alphanumerics from character name', () => {
    expect(buildImageFilenamePrefix({
      image_type: 'character_ref',
      character_name: 'Mrs. Singh',
      scene_number: 1,
    })).toBe('CharRef_MrsSingh');
  });

  it('strips non-alphanumerics from setting name', () => {
    expect(buildImageFilenamePrefix({
      image_type: 'setting_ref',
      setting_name: "Singh residence - mudroom",
      scene_number: 1,
    })).toBe('SettingRef_Singhresidencemudroom');
  });

  it('falls through to scene for shot images (scene_N_shot_M_<frame>)', () => {
    expect(buildImageFilenamePrefix({
      image_type: 'scene',
      scene_number: 2,
      shot_number: 3,
      frame_id: 'first_frame',
    })).toBe('scene_2_shot_3_first_frame');
  });

  it('scene branch with no shot/frame produces scene_N only', () => {
    expect(buildImageFilenamePrefix({
      image_type: 'scene',
      scene_number: 4,
    })).toBe('scene_4');
  });

  it('character_ref without character_name falls through to scene', () => {
    // Defensive: if the caller passes character_ref but no name, we
    // still produce something usable rather than crashing.
    expect(buildImageFilenamePrefix({
      image_type: 'character_ref',
      scene_number: 1,
    })).toBe('scene_1');
  });

  it('object_ref without object_name falls through to scene', () => {
    expect(buildImageFilenamePrefix({
      image_type: 'object_ref',
      scene_number: 1,
    })).toBe('scene_1');
  });
});

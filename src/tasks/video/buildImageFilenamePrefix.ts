/**
 * Build the filenamePrefix passed to ComfyUI's SaveImage node.
 *
 *   character_ref → CharRef_<name>
 *   setting_ref   → SettingRef_<name>
 *   object_ref    → ObjectRef_<name>
 *   scene (shot)  → scene_N[_shot_M[_<frame>]]
 *
 * Non-alphanumerics are stripped from names so the resulting filename
 * is filesystem-safe and uniformly scannable in Finder. The "scene"
 * branch is reached for shot images and as a defensive fallback when
 * a ref-type is set but the corresponding name is missing.
 */
export interface ImageFilenameInput {
  image_type?: 'scene' | 'character_ref' | 'setting_ref' | 'object_ref';
  character_name?: string;
  setting_name?: string;
  object_name?: string;
  scene_number: number;
  shot_number?: number;
  frame_id?: string;
}

export function buildImageFilenamePrefix(input: ImageFilenameInput): string {
  const t = input.image_type ?? 'scene';
  if (t === 'character_ref' && input.character_name) {
    return `CharRef_${input.character_name.replace(/[^a-zA-Z0-9]/g, '')}`;
  }
  if (t === 'setting_ref' && input.setting_name) {
    return `SettingRef_${input.setting_name.replace(/[^a-zA-Z0-9]/g, '')}`;
  }
  if (t === 'object_ref' && input.object_name) {
    return `ObjectRef_${input.object_name.replace(/[^a-zA-Z0-9]/g, '')}`;
  }
  // Scene/shot fallback. Carry full scene/shot/frame identity into the
  // filename so listings stay scannable.
  const parts = [`scene_${input.scene_number}`];
  if (input.shot_number !== undefined) parts.push(`shot_${input.shot_number}`);
  if (input.frame_id) parts.push(input.frame_id);
  return parts.join('_');
}

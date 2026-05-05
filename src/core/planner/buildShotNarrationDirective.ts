/**
 * Build a `<narration>` directive block for the motion-directive LLM
 * based on `StoryEssence.narration` (mode + voice).
 *
 *   - `none` → no block emitted (caller skips).
 *   - `minimal` → narrator allowed only at scene transitions / key
 *     exposition beats. Compression tool, not a constant presence.
 *   - `pervasive` → narrator is a load-bearing voice through much of
 *     the video; routinely available per shot.
 *
 * The block teaches the LLM the narrator-line format
 * (`Narrator says "..."`) so it can attach a narrator line to the
 * motion directive when it serves the shot. It also makes clear the
 * narrator does NOT replace character dialogue when both are present.
 */
import type { NarrationConfig } from './storyEssenceExtractor.js';

export function buildShotNarrationDirective(narration: NarrationConfig | undefined | null): string {
  if (!narration || narration.mode === 'none') return '';
  const voice = (narration.voice ?? '').trim();
  const lines: string[] = ['<narration>'];
  lines.push(`NARRATOR VOICE: ${voice || 'unspecified'}`);
  if (narration.mode === 'pervasive') {
    lines.push(
      'Mode: pervasive. The narrator routinely carries weight across shots. ' +
      'A narrator line is OPTIONAL per shot but available throughout — use it ' +
      'liberally when the visual alone under-serves the story (interior thought, ' +
      'compression of beats, retrospective framing).',
    );
  } else {
    lines.push(
      'Mode: minimal. The narrator line is optional per shot — use it sparingly, ' +
      'only at scene transitions, key exposition beats, or when the camera and ' +
      'dialogue cannot convey what the shot needs. Most shots should have NO ' +
      'narrator line.',
    );
  }
  lines.push(
    'Format: append `Narrator says "<narrator line>."` to the motion directive ' +
    'in the narrator voice described above. Keep it short (≤20 words). ' +
    'Do NOT replace character dialogue with narrator — when both are present, ' +
    'emit them alongside (e.g. `[char] says "..." Narrator says "..."`).',
  );
  lines.push('</narration>');
  return lines.join('\n');
}

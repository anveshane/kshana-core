/**
 * Build the `global_prompt` for kijai/PromptRelayEncode.
 *
 * The global prompt is what gets patched once across the whole video.
 * Its job is to anchor identity, style, and atmosphere — not to tell
 * the story. Per-segment beats belong in `local_prompts`, joined with
 * `|`, fed separately.
 *
 * Two non-obvious constraints (learned from the woman_medieval probe):
 *
 *   1. LTX 2.3 generates audio. Past-tense narrative copy ("Elara
 *      adamantly refuses…") triggers the audio head into voice-over
 *      narration. Keep the scene description visual/atmospheric and
 *      avoid plot verbs like "refuses", "decides", "argues".
 *
 *   2. Long descriptions drown out the per-segment prompts. We cap
 *      each character description at ~250 chars and the scene
 *      description at ~400 chars; total budget stays under ~1500
 *      chars so Gemma tokenization leaves room for everything else.
 */

const MAX_CHAR_DESC = 250;
const MAX_SCENE_DESC = 400;

export interface CharacterId {
  name: string;
  description: string;
}

export interface BuildPromptRelayGlobalPromptInput {
  style: string;
  characters: CharacterId[];
  sceneDescription: string;
}

function trimTo(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 3).trimEnd() + '...' : t;
}

export function buildPromptRelayGlobalPrompt(input: BuildPromptRelayGlobalPromptInput): string {
  const style = (input.style || 'cinematic').trim();
  const styleLine = `${style} style. Cinematic continuity across shots, consistent character identity and lighting.`;

  const charLines = input.characters
    .filter(c => c.name.trim().length > 0 && c.description.trim().length > 0)
    .map(c => `${c.name.trim()}: ${trimTo(c.description, MAX_CHAR_DESC)}`);

  const parts = [styleLine];
  if (charLines.length > 0) {
    parts.push('Characters: ' + charLines.join('; ') + '.');
  }
  if (input.sceneDescription.trim().length > 0) {
    parts.push('Scene: ' + trimTo(input.sceneDescription, MAX_SCENE_DESC));
  }
  return parts.join(' ');
}

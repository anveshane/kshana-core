/**
 * Build a `<shot_audio>` block that surfaces the dialogue + ambient
 * sounds from a scene_video_prompt's per-shot `audio` field directly
 * into the motion-directive user message.
 *
 * Background: scene_video_prompt stores per-shot audio as
 *   "PARVATI: Go on, beti. Distant morning birds, rusted gate."
 *
 * The motion-directive LLM was supposed to extract the dialogue from
 * this field per the motion_directive_guide, but in practice it
 * ignores soft "if there's dialogue" instructions. Surfacing the
 * dialogue/ambient as a delimited block with MUST language forces
 * the LLM to honor it.
 *
 * Format:
 *   <shot_audio>
 *   DIALOGUE: "Go on, beti. Coach is waiting." — speaker: PARVATI
 *   AMBIENT: Distant morning birds, rusted gate.
 *   You MUST emit the dialogue verbatim in a "says" clause...
 *   </shot_audio>
 *
 * Empty/whitespace input → empty string (caller skips the block).
 */
export function buildShotAudioBlock(audio: string | undefined | null): string {
  const text = (audio ?? '').trim();
  if (text.length === 0) return '';

  // Match SPEAKER: dialogue at the start. SPEAKER is one or more ALL-CAPS
  // tokens (allowing periods inside, e.g. "MRS. SINGH"), followed by a
  // colon. Capture the speaker and everything until the next paragraph
  // break or the segment we'll classify as ambient.
  const speakerMatch = text.match(/^([A-Z][A-Z .]*[A-Z]):\s*(.*)$/s);

  let dialogue = '';
  let speaker = '';
  let ambient = '';

  if (speakerMatch) {
    speaker = speakerMatch[1]!.trim();
    const remainder = speakerMatch[2]!.trim();
    // Heuristic split: the dialogue block is everything up to (but not
    // including) the trailing ambient sentence. Ambient sentences
    // typically describe sound textures and don't contain spoken
    // words — they're keyword-y phrases like "Distant birds, rusted
    // gate." or "Wet scrubbing sounds."
    //
    // We split on sentence boundaries and walk from the END,
    // gathering trailing sentences whose content reads as ambient
    // (no first-person pronouns, no quoted speech, characteristic
    // ambient keywords). The remaining prefix is the dialogue.
    const sentences = remainder
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);
    const ambientSentences: string[] = [];
    while (sentences.length > 1) {
      const last = sentences[sentences.length - 1]!;
      if (looksLikeAmbient(last)) {
        ambientSentences.unshift(last);
        sentences.pop();
      } else {
        break;
      }
    }
    dialogue = sentences.join(' ').trim();
    ambient = ambientSentences.join(' ').trim();
  } else {
    // No SPEAKER prefix — the whole thing is ambient.
    ambient = text;
  }

  const lines: string[] = ['<shot_audio>'];
  if (dialogue) {
    lines.push(`DIALOGUE: "${stripTrailingPunctuation(dialogue)}." — speaker: ${speaker}`);
  }
  if (ambient) {
    lines.push(`AMBIENT: ${ambient}`);
  }
  if (dialogue) {
    lines.push(
      'You MUST emit the dialogue verbatim in a `says` clause attached to the speaking character ' +
      '(e.g. `[speaker tag] says "..."`). Do NOT use speech-action verbs ("speaks", "talks", "calls out") ' +
      'as substitutes — write the exact words. Translate the AMBIENT description into visible motion ' +
      '(per the sound-to-visual rule); do NOT name ambient sounds in the motion directive text.',
    );
  } else if (ambient) {
    lines.push(
      'No dialogue this shot. Translate the AMBIENT description into visible motion (per the ' +
      'sound-to-visual rule); do NOT name ambient sounds in the motion directive text.',
    );
  }
  lines.push('</shot_audio>');
  return lines.join('\n');
}

const AMBIENT_KEYWORDS = [
  // sound-texture words common in ambient descriptions
  'sound', 'sounds', 'distant', 'faint', 'rustle', 'creak', 'whistle', 'whistles',
  'crackling', 'humming', 'hum', 'fan', 'wind', 'rain', 'splash', 'splashing',
  'footsteps', 'dripping', 'echo', 'whisper of', 'flapping', 'thud', 'rumble',
  'sniff', 'sniffs', 'breath', 'breathing', 'pat', 'tap', 'rustling', 'birds',
  'gate', 'traffic', 'fabric', 'scrubbing', 'water dripping', 'water',
];

function looksLikeAmbient(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  // No quoted dialogue and no first-person pronouns inside it.
  if (/"|'|\bi\b|\bi'm\b|\bi'll\b|\bme\b|\bmy\b/.test(sentence)) return false;
  for (const k of AMBIENT_KEYWORDS) {
    if (lower.includes(k)) return true;
  }
  return false;
}

function stripTrailingPunctuation(s: string): string {
  return s.replace(/[.!?]+$/, '');
}

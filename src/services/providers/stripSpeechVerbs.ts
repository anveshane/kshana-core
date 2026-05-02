/**
 * Strip clauses containing speech verbs from a motion-directive prompt.
 *
 * Background: in prompt-relay mode, LTX 2.3 generates an audio track
 * along with the video. Verbs like "speaking", "calls out", "whispers"
 * trigger the audio head — even with the negative prompt suppressing
 * "speech/dialogue/talking", the positive signal in the per-segment
 * prompt wins, and the model produces phoneme-shaped gibberish that
 * sounds like a real language but isn't.
 *
 * This stripper splits the input on commas and periods, drops any
 * clause that contains a speech verb, and rejoins the survivors. The
 * visual / movement description stays intact; only the speech-action
 * clauses are removed.
 *
 * Word boundaries are honored — "stalks" doesn't match "talks",
 * "spoke wheels" doesn't match "spoke" (the speech verb).
 */

// Patterns matched at clause level, with \b word boundaries so prefixes
// like "stalks", "spokes", "speakers" don't get caught.
const SPEECH_PATTERNS = [
  /\bspeak(?:s|ing|er|ers)?\b/i,
  /\b(?:spoke|spoken)\b(?!\s+wheels?)/i,
  /\btalk(?:s|ing|ed)?\b/i,           // talks, talking, talked
  /\bsay(?:s|ing)?\b/i,               // says, saying
  /\bsaid\b/i,
  /\bcalls?\s+out\b/i,
  /\bshout(?:s|ed|ing)?\b/i,
  /\bwhisper(?:s|ed|ing)?\b/i,
  /\bmutter(?:s|ed|ing)?\b/i,
  /\brepl(?:y|ies|ied|ying)\b/i,
  /\brespond(?:s|ed|ing)?\b/i,
  /\basks?\b/i,
  /\bansw(?:er|ers|ered|ering)\b/i,
  /\bscream(?:s|ed|ing)?\b/i,
  /\bexclaim(?:s|ed|ing)?\b/i,
  /\bmurmur(?:s|ed|ing)?\b/i,
  /\bsing(?:s|ing)?\b/i,
  /\bsang\b/i,
  /\bchat(?:s|ted|ting)?\b/i,
  /\bconvers(?:e|es|ing|ed|ation)\b/i,
  /\bnarrat(?:e|es|ed|ing|ion|or)\b/i,
  /\bvoice[\s-]*over\b/i,
  /\bmonologue\b/i,
  /\bdialogue\b/i,
  /\blip[\s-]*sync\b/i,
  /\bmouth\s+movement\b/i,
  /\bvocal(?:s|ize|izing)?\b/i,
];

function clauseHasSpeechVerb(clause: string): boolean {
  for (const pat of SPEECH_PATTERNS) {
    if (pat.test(clause)) return true;
  }
  return false;
}

export function stripSpeechVerbs(input: string): string {
  if (!input) return input;
  // Split on commas and periods while preserving the delimiter so
  // we can rejoin without losing sentence boundaries entirely.
  // We use a simple split-and-filter: split on `,` for clause-level
  // edits within a sentence, then on `.` for sentence-level. The
  // round-trip rejoin reconstructs the prose with `, ` and `. `.
  const sentences = input.split(/\.\s*/).map(s => s.trim()).filter(Boolean);
  const cleanedSentences: string[] = [];
  for (const sentence of sentences) {
    const clauses = sentence.split(/,\s*/).map(c => c.trim()).filter(Boolean);
    const kept = clauses.filter(c => !clauseHasSpeechVerb(c));
    if (kept.length === 0) continue;
    cleanedSentences.push(kept.join(', '));
  }
  if (cleanedSentences.length === 0) return '';
  // Restore final period if the original ended with one.
  const result = cleanedSentences.join('. ');
  return /\.\s*$/.test(input) ? result + '.' : result;
}

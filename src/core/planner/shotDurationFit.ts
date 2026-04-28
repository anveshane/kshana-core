/**
 * Fit shot durations to the dialogue they need to deliver.
 *
 * Problem: the LLM that decides shot breakdowns defaults to 3–4s quick
 * cuts, even when the shot carries 20+ words of dialogue that needs
 * ~8s to deliver. The video model generates exactly the requested
 * duration, so the clip cuts off mid-sentence and creates a jarring
 * break when the final video concatenates shots.
 *
 * Fix: after the LLM writes a scene_video_prompt, walk every shot and
 * compare the required dialogue time (~2.5 words/sec conversational
 * pace + 1s buffer for cadence) against the declared `duration`. If
 * dialogue needs more time, bump the duration up — capped at
 * `maxDuration` (15s is the practical ceiling for LTX 2.3).
 *
 * This is a deterministic post-pass — the LLM is also told to size
 * dialogue shots correctly in the guide, but the normalizer guarantees
 * we never ship a clipped dialogue shot regardless of LLM drift.
 */

export interface ShotLike {
  shotNumber?: number;
  duration?: number;
  audio?: string;
  [k: string]: unknown;
}

export interface ShotDurationAdjustment {
  shotNumber: number;
  from: number;
  to: number;
  dialogueSeconds: number;
  reason: 'dialogue_fit' | 'cap';
}

// Conversational speech: ~150 words per minute ≈ 2.5 words/sec. We
// use 2.5 as the divisor — slightly conservative so the shot has room
// for natural pauses rather than squeezing every syllable.
const WORDS_PER_SECOND = 2.5;

// Pre + post buffer: 0.5s lead-in so the speaker isn't mid-syllable on
// the opening frame + 0.5s tail so the last word isn't cut off.
const BUFFER_SECONDS = 1;

// Default ceiling. LTX 2.3 handles 10–15s clips reliably; beyond that
// quality drops and the UI truncates. Callers can override.
const DEFAULT_MAX_SECONDS = 15;

// Minimum shot duration — even a silent reaction shot needs a beat.
const DEFAULT_MIN_SECONDS = 3;

/**
 * Extract dialogue text from an audio field and count words.
 *
 * The audio field is free-form prose like:
 *   "PARVATI: Go on, beti. Coach is waiting."
 *   "MRS. SINGH: 'You're late.' Newspaper rustling, delicate china clink"
 *   "Parvati: 'She will run.' (whispered), cloth scraping like claws"
 *   "distant jogger huffs, brittle grass rustle"       (no dialogue)
 *
 * A line containing `NAME:` (any capitalization, allowed trailing dots
 * like "MRS. SINGH") is treated as dialogue; everything from the colon
 * to the next `NAME:` or end of string is counted as speech. We strip
 * parenthetical stage directions (like "(whispered)") before counting
 * so performance hints don't pad the duration.
 *
 * We do NOT try to distinguish dialogue from ambient sound embedded in
 * the same line — e.g. "ISHA: I know, Ma. Footsteps on dirt." counts
 * "Footsteps on dirt" as speech. That over-estimates by 1–2 words,
 * which just means the shot gets ~0.5s longer than strictly necessary
 * — safer than under-estimating and clipping real speech.
 */
export function extractDialogueWordCount(audio: string | undefined | null): number {
  if (!audio) return 0;

  // Split into segments at speaker markers. The regex captures a
  // group so the speaker name is discarded but the split points are
  // preserved in the output array.
  //
  // Pattern: a capitalized word (with optional "MRS." / "DR." style
  // prefixes and spaces between tokens) followed by a colon.
  //   "PARVATI:"             → match
  //   "Mrs. Singh:"          → match
  //   "MR. CROWLEY JR.:"     → match
  //   "later, PARVATI:"      → match (leading text goes to segment 0)
  //   "well, it:"            → NO match (first word not capitalized)
  const speakerRegex = /([A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)*):\s*/g;

  // Find all speaker markers in order.
  const segments: string[] = [];
  let lastEnd = 0;
  let hadSpeaker = false;
  let m: RegExpExecArray | null;
  while ((m = speakerRegex.exec(audio)) !== null) {
    hadSpeaker = true;
    // The TEXT between markers is dialogue — but only after the first
    // marker (text before the first marker is not attributed to anyone).
    if (lastEnd > 0) segments.push(audio.slice(lastEnd, m.index));
    lastEnd = m.index + m[0].length;
  }
  if (hadSpeaker) {
    segments.push(audio.slice(lastEnd));
  }

  if (!hadSpeaker) return 0; // Pure ambient audio — no dialogue.

  let totalWords = 0;
  for (const raw of segments) {
    // Strip parenthetical stage directions: "(whispered, low and fierce)".
    const noDirections = raw.replace(/\([^)]*\)/g, '');
    // Drop quote marks — they don't affect word count but make the
    // split cleaner.
    const noQuotes = noDirections.replace(/[""""''']/g, '');
    const words = noQuotes.trim().split(/\s+/).filter(w => w.length > 0);
    totalWords += words.length;
  }
  return totalWords;
}

/**
 * Minimum duration this shot needs to deliver its dialogue, in whole
 * seconds. Returns 0 if the shot has no dialogue.
 */
export function dialogueSecondsNeeded(audio: string | undefined | null): number {
  const words = extractDialogueWordCount(audio);
  if (words === 0) return 0;
  return Math.ceil(words / WORDS_PER_SECOND) + BUFFER_SECONDS;
}

export interface FitOptions {
  maxDuration?: number;
  minDuration?: number;
}

/**
 * Walk a shots array, bump durations that are too short to deliver
 * dialogue, and clamp at maxDuration. Mutates the passed objects in
 * place. Returns a log of adjustments so callers can report what
 * changed.
 */
export function fitShotDurations(
  shots: ShotLike[],
  opts: FitOptions = {},
): ShotDurationAdjustment[] {
  const maxDuration = opts.maxDuration ?? DEFAULT_MAX_SECONDS;
  const minDuration = opts.minDuration ?? DEFAULT_MIN_SECONDS;

  const adjustments: ShotDurationAdjustment[] = [];

  for (const shot of shots) {
    const currentDuration = typeof shot.duration === 'number' ? shot.duration : 0;
    const needed = dialogueSecondsNeeded(shot.audio);

    let target = currentDuration;
    let reason: ShotDurationAdjustment['reason'] | null = null;

    if (needed > currentDuration) {
      // Dialogue needs more time than allocated.
      target = Math.max(needed, minDuration);
      reason = 'dialogue_fit';
    }

    if (target > maxDuration) {
      // Cap — even if dialogue wants more, the video model can't
      // deliver beyond this. The user will need to split into multiple
      // shots if dialogue is extreme.
      target = maxDuration;
      reason = reason ?? 'cap';
    }

    if (target !== currentDuration) {
      adjustments.push({
        shotNumber: shot.shotNumber ?? 0,
        from: currentDuration,
        to: target,
        dialogueSeconds: needed,
        reason: reason ?? 'dialogue_fit',
      });
      shot.duration = target;
    }
  }

  return adjustments;
}

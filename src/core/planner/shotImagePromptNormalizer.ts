/**
 * Normalize a shot's image-prompt frame.
 *
 * Two independent passes, applied in order by `normalizeShotImagePromptWithRefs`:
 *
 * 1. INJECT missing character/setting refs (`injectMissingShotRefs`).
 *    The LLM frequently names a character in prose ("Parvati standing
 *    frozen...") but forgets to add "from image N" and/or forgets to
 *    list her in the `references` array. Measured on a real project:
 *    ~39% of frames dropped the "from image N" phrase for a character,
 *    ~43% dropped the character from the references array entirely.
 *    This pass scans the prose against the canonical available-refs
 *    list (same list the prompt gave the LLM), and for every ref whose
 *    label appears in prose:
 *      - if "from image N" with the canonical N is absent → inject it
 *        after the first name mention
 *      - if the ref is absent from the references array → append it
 *
 * 2. REORDER refs so settings come before characters (`reorderShotRefs`).
 *    Klein's edit workflow has 4 LoadImage nodes (base_image +
 *    reference_image_1..3). Whatever ref is at index 0 of the upload
 *    list lands in `base_image`, which Klein weights heavily for
 *    compositional framing. When characters sit at index 0, characters
 *    dominate the frame and the environment gets weak. Pushing
 *    settings to index 0 fixes that. Reordering happens here (not at
 *    the upload layer) because the prompt text says "from image 1",
 *    "from image 2", etc., and those numbers MUST track the final
 *    upload order — so this pass also renumbers both the refs array
 *    and every `from image N` phrase in `imagePrompt` to stay in
 *    lockstep.
 */

export interface ShotImagePromptRef {
  imageNumber: number;
  type: 'character' | 'setting' | string;
  refId: string;
  [k: string]: unknown;
}

export interface ShotImagePromptFrame {
  imagePrompt: string;
  references: ShotImagePromptRef[];
  [k: string]: unknown;
}

/**
 * The canonical reference list the prompt gave to the LLM. Label is the
 * itemId form (snake_case, e.g. "parvati", "mrs._singh",
 * "district_sports_complex"); we convert it to prose form ("mrs. singh")
 * for matching. Same shape as `AvailableRef` in shotReferenceMapping.ts.
 */
export interface AvailableRefMinimal {
  imageNumber: number;
  type: 'character' | 'setting' | 'object' | string;
  refId: string;
  label: string;
}

export interface InjectionEvent {
  /** The canonical label we matched in prose. */
  label: string;
  /** The canonical image number assigned by availableRefs. */
  imageNumber: number;
  /** What we actually injected. */
  kind: 'phrase' | 'array' | 'both';
}

const WORD_BOUNDARY_PREFIX = '(?<![A-Za-z0-9])';
const WORD_BOUNDARY_SUFFIX = '(?![A-Za-z0-9])';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert an itemId label ("mrs._singh") to the form likely to appear
 * in prose ("mrs. singh"). Underscores → spaces; casing is handled at
 * the regex level (case-insensitive).
 */
function labelToProseForm(label: string): string {
  return label.replace(/_/g, ' ').trim();
}

/**
 * Scan the prose for mentions of each availableRef's label. For each
 * label found in prose:
 *   - if "from image <canonical N>" is absent anywhere in prose, inject
 *     it immediately after the first name mention
 *   - if the ref is missing from the references array (matched by
 *     refId), append it
 *
 * Pure function: returns a new frame + a log of what was injected.
 */
export function injectMissingShotRefs(
  frame: ShotImagePromptFrame,
  availableRefs: AvailableRefMinimal[],
): { frame: ShotImagePromptFrame; injected: InjectionEvent[] } {
  const injected: InjectionEvent[] = [];
  if (!availableRefs || availableRefs.length === 0) return { frame, injected };

  let prose = frame.imagePrompt ?? '';
  const refsArr: ShotImagePromptRef[] = [...(frame.references ?? [])];

  for (const ar of availableRefs) {
    const proseForm = labelToProseForm(ar.label);
    if (proseForm.length < 2) continue;

    // Case-insensitive, numeric/alpha word-boundary match. Allows labels
    // containing spaces or dots ("mrs. singh") because we don't require
    // `\b` (which treats `.` as a non-word char and would split).
    const nameRe = new RegExp(
      `${WORD_BOUNDARY_PREFIX}${escapeRegex(proseForm)}${WORD_BOUNDARY_SUFFIX}`,
      'i',
    );
    const match = nameRe.exec(prose);
    if (!match) continue; // Label not used in this frame's prose.

    // Canonical "from image N" presence check: N must be THIS ref's
    // assigned imageNumber. If the LLM used a different N for this
    // label we'd still re-inject here, which is wrong — but the
    // canonical N IS what the LLM was told to use in its context, so
    // mismatches here mean the LLM hallucinated a number and the fix
    // is to add the correct one.
    const phraseRe = new RegExp(`\\bfrom\\s+image\\s+${ar.imageNumber}\\b`, 'i');
    const hasPhrase = phraseRe.test(prose);

    // refId is the stable identity (e.g. "character_image:parvati").
    // We don't match on imageNumber because the LLM sometimes uses a
    // different one — we trust the canonical.
    const hasRef = refsArr.some(r => r.refId === ar.refId);

    if (hasPhrase && hasRef) continue;

    if (!hasPhrase) {
      const insertAt = match.index + match[0].length;
      prose = prose.slice(0, insertAt) + ` from image ${ar.imageNumber}` + prose.slice(insertAt);
    }

    if (!hasRef) {
      refsArr.push({
        imageNumber: ar.imageNumber,
        type: ar.type,
        refId: ar.refId,
      });
    }

    const kind: InjectionEvent['kind'] =
      (!hasPhrase && !hasRef) ? 'both' : (!hasPhrase ? 'phrase' : 'array');
    injected.push({ label: ar.label, imageNumber: ar.imageNumber, kind });
  }

  return {
    frame: { ...frame, imagePrompt: prose, references: refsArr },
    injected,
  };
}

/**
 * Reorder refs so settings sit at index 0 (Klein's base_image slot),
 * renumber the array to 1..N, and rewrite every `from image N` phrase
 * in prose to match the new numbering.
 *
 * No-op if there are no setting refs, or if there's nothing to reorder.
 */
export function normalizeShotImagePrompt(frame: ShotImagePromptFrame): ShotImagePromptFrame {
  const refs = frame.references ?? [];
  if (refs.length === 0) return frame;

  // Bucket by type, stable within bucket.
  const settings: ShotImagePromptRef[] = [];
  const characters: ShotImagePromptRef[] = [];
  const others: ShotImagePromptRef[] = [];
  for (const r of refs) {
    if (r.type === 'setting') settings.push(r);
    else if (r.type === 'character') characters.push(r);
    else others.push(r);
  }

  // If nothing to reorder (all settings, or no settings), bail early.
  if (settings.length === 0 || (characters.length === 0 && others.length === 0)) {
    return frame;
  }

  const ordered = [...settings, ...characters, ...others];

  // Build oldNumber → newNumber map. Skip any ref whose new position
  // matches its old position (so the prompt rewrite doesn't touch it).
  const remap = new Map<number, number>();
  ordered.forEach((r, i) => {
    const newNumber = i + 1;
    if (r.imageNumber !== newNumber) remap.set(r.imageNumber, newNumber);
  });

  // Rewrite refs with new imageNumbers.
  const rewrittenRefs: ShotImagePromptRef[] = ordered.map((r, i) => ({
    ...r,
    imageNumber: i + 1,
  }));

  // Rewrite `from image N` in prose. Single pass with a callback avoids
  // the cascading-substitution trap (e.g. rewriting 1→2 then rewriting
  // THAT 2→1 back to where it started).
  const pattern = /\bfrom image (\d+)\b/gi;
  const rewrittenPrompt = frame.imagePrompt.replace(pattern, (match, nStr: string) => {
    const oldN = parseInt(nStr, 10);
    const newN = remap.get(oldN);
    if (newN === undefined) return match; // number not in refs → leave alone
    // Preserve the caller's "From Image" casing of the word "image"
    const keyword = match.slice(0, match.lastIndexOf(' ')); // "from image" or "From Image"
    return `${keyword} ${newN}`;
  });

  return {
    ...frame,
    references: rewrittenRefs,
    imagePrompt: rewrittenPrompt,
  };
}

/**
 * Convenience: inject missing refs (pass 1), then reorder + renumber
 * (pass 2). This is what ExecutorAgent should call at the output
 * boundary. Returns both the final frame and the injection log so the
 * caller can emit telemetry / debug logs.
 */
export function normalizeShotImagePromptWithRefs(
  frame: ShotImagePromptFrame,
  availableRefs: AvailableRefMinimal[],
): { frame: ShotImagePromptFrame; injected: InjectionEvent[] } {
  const after1 = injectMissingShotRefs(frame, availableRefs);
  const after2 = normalizeShotImagePrompt(after1.frame);
  return { frame: after2, injected: after1.injected };
}

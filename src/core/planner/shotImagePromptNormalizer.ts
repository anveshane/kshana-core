/**
 * Normalize a shot's image-prompt frame so setting references come
 * before character references and the `from image N` phrases in the
 * prose are renumbered to match.
 *
 * Why: Klein's edit workflow has 4 LoadImage nodes (base_image +
 * reference_image_1..3). Whatever ref is at index 0 of the upload list
 * lands in `base_image` (node 76, "Load Reference Image 1" in the UI),
 * which Klein weights heavily for compositional framing. When the LLM
 * writes the shot prompt with characters listed first, a character ref
 * ends up as base — characters dominate the frame and environments get
 * weak. Pushing settings to index 0 fixes that.
 *
 * Reordering at the UPLOAD layer alone is not enough: the prompt text
 * says "from image 1", "from image 2", etc., and those numbers must
 * track the final upload order. So this normalizer:
 *   1. Splits refs into [settings..., characters..., others...] in stable order.
 *   2. Re-sequences `imageNumber` fields to 1..N matching the new index.
 *   3. Rewrites every `from image N` phrase in `imagePrompt` to the new N.
 *
 * No-op if there are no setting refs, or if there's nothing to reorder.
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

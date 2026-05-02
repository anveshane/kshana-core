/**
 * Semantic validators for `shot_image_prompt` LLM output.
 *
 * The existing JSON-schema validation catches structural problems
 * (missing fields, wrong types). These validators close two SEMANTIC
 * gaps surfaced by deepseek-v4-flash hallucinating an entirely
 * unrelated scene during the Parvati run:
 *
 *   1. `validateShotNumber` — assert the LLM's reported `shotNumber`
 *      matches the requested shot. The Parvati bug had `shotNumber: 5`
 *      in a file written for shot 1 of scene 4.
 *
 *   2. `validateRefMentions` — assert the output mentions at least one
 *      of the project's known character / setting / object refIds,
 *      either inline in `imagePrompt` text or via a `references[]`
 *      entry. The Parvati bug had ZERO refs and emitted "Elena" — a
 *      character that doesn't exist in the project.
 *
 * On failure the existing `validateJsonOutput` flow forwards into
 * `json_repair` → full retry, so the LLM gets a chance to self-correct.
 */

export interface SemanticCheckResult {
  valid: boolean;
  error?: string;
}

/**
 * Pull the shot number out of a node's itemId (e.g. `scene_4_shot_12` → 12).
 * Returns null if the itemId doesn't match the canonical pattern, in which
 * case `validateShotNumber` skips the check.
 */
export function expectedShotNumberFromItemId(itemId: string | undefined | null): number | null {
  if (!itemId) return null;
  const m = itemId.match(/^scene_\d+_shot_(\d+)$/);
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Assert `parsed.shotNumber` matches the expected shot number derived
 * from the node's itemId. Pass `null` for `expected` to skip the check
 * (caller couldn't determine the expected number).
 */
export function validateShotNumber(
  parsed: { shotNumber?: unknown },
  expected: number | null,
): SemanticCheckResult {
  if (expected === null) return { valid: true };
  if (typeof parsed.shotNumber !== 'number') {
    return { valid: false, error: `shotNumber is missing or not a number — expected ${expected}` };
  }
  if (parsed.shotNumber !== expected) {
    return {
      valid: false,
      error: `shotNumber mismatch — expected ${expected} but got ${parsed.shotNumber}. The LLM may be confusing this shot with a different one.`,
    };
  }
  return { valid: true };
}

interface FrameLike {
  imagePrompt?: unknown;
  references?: unknown;
}

interface ShotPromptShape {
  imagePrompt?: unknown;
  references?: unknown;
  frames?: Record<string, FrameLike> | unknown;
}

/**
 * Build a list of human-readable name fragments from refIds for inline
 * matching. e.g. `character_image:mrs._singh` → ["mrs._singh", "mrs.", "singh", "mrs_singh"].
 */
function nameFragmentsFromRefId(refId: string): string[] {
  const lastSeg = refId.includes(':') ? refId.split(':').pop()! : refId;
  const fragments = new Set<string>();
  fragments.add(lastSeg.toLowerCase());
  // Replace underscores with spaces to also match the natural form
  fragments.add(lastSeg.replace(/_/g, ' ').toLowerCase());
  // Also try without the dot-prefix conventions some refs use (mrs._singh)
  fragments.add(lastSeg.replace(/[._]/g, ' ').toLowerCase());
  // Last-segment pieces (singh, parvati, isha)
  for (const piece of lastSeg.split(/[._\s]+/)) {
    if (piece.length >= 3) fragments.add(piece.toLowerCase());
  }
  return [...fragments];
}

/**
 * Walk the parsed shape and collect every imagePrompt + references entry,
 * regardless of whether it's flat (root-level) or wrapped in `.frames`.
 */
function collectFrames(parsed: ShotPromptShape): FrameLike[] {
  const out: FrameLike[] = [];
  if (typeof parsed.imagePrompt === 'string' || Array.isArray(parsed.references)) {
    out.push({ imagePrompt: parsed.imagePrompt, references: parsed.references });
  }
  if (parsed.frames && typeof parsed.frames === 'object') {
    for (const f of Object.values(parsed.frames as Record<string, FrameLike>)) {
      out.push(f);
    }
  }
  return out;
}

/**
 * Assert the parsed output mentions at least one known refId — either
 * inline in `imagePrompt` text or via a `references[]` entry. Empty
 * `availableRefIds` (no project refs known) bypasses the check.
 */
export function validateRefMentions(
  parsed: ShotPromptShape,
  availableRefIds: string[],
): SemanticCheckResult {
  if (availableRefIds.length === 0) return { valid: true };

  // Build the name-fragment haystack
  const knownFragments = new Set<string>();
  for (const refId of availableRefIds) {
    for (const f of nameFragmentsFromRefId(refId)) {
      knownFragments.add(f);
    }
  }
  const knownRefIdSet = new Set(availableRefIds);

  const frames = collectFrames(parsed);
  if (frames.length === 0) {
    return { valid: false, error: 'No imagePrompt or references found in the response — cannot verify ref mentions.' };
  }

  for (const f of frames) {
    // Check inline imagePrompt for a known fragment
    if (typeof f.imagePrompt === 'string') {
      const lower = f.imagePrompt.toLowerCase();
      for (const frag of knownFragments) {
        // Word-ish boundary check — fragment surrounded by non-letter on both sides
        // (so "ish" doesn't match "fish" but "isha" matches "Isha walks").
        // Use a simple includes for now; if false-positives become an issue
        // we can tighten with a word-boundary regex.
        if (frag.length >= 3 && lower.includes(frag)) return { valid: true };
      }
    }
    // Check references[] for a known refId
    if (Array.isArray(f.references)) {
      for (const r of f.references) {
        if (r && typeof r === 'object' && typeof (r as { refId?: unknown }).refId === 'string') {
          if (knownRefIdSet.has((r as { refId: string }).refId)) return { valid: true };
        }
      }
    }
  }

  return {
    valid: false,
    error:
      `No reference to any known character / setting / object found in the imagePrompt or references[]. ` +
      `Expected at least one of: ${availableRefIds.slice(0, 6).join(', ')}${availableRefIds.length > 6 ? `, ...` : ''}. ` +
      `The LLM may have hallucinated unrelated content — re-prompt with the project's character/setting list.`,
  };
}

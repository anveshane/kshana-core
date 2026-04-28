# Skip last-frame generation when FF → LF delta is trivially small

## Problem

For "holding" shots (character still, camera nearly static), the LLM
that writes `shot_image_prompt.json` generates a `last_frame` prompt
with micro-adjustments like:
- "eyes more distant" → "eyes even more distant"
- "hand gripped firmly" → "hand steady closer to his lips"
- "tighter waist-up framing"
- "more softly blurred" / "fully dominant torchlight"

The image editor (Klein or Grok) cannot render these as visually
distinct frames — the pair comes out near-identical (hash-different,
visually indistinguishable). Empirical check on noir S1.2: first_frame
and last_frame are perceptually the same image, yet we paid for two
full Klein calls.

At ~$0.02-0.03/Klein call and ~18 shots per project, ~40-50% of noir's
shots fit this "holding beat" pattern. Rough waste: $0.15-0.25 per
project regen. Multiplied across projects and iterations, real money.

The guide has an escape-hatch:
> "Only write 'No visible change from first frame.' for pure static
> atmosphere shots (rain falling, fire burning) where the camera and
> subject don't move."

...but it's narrowly scoped to atmosphere. Character shots with
purposes like `meet_character`, `hold_emotion`, `show_reaction` plus
static camera work (no tracking/push-in/pan/dolly) also fit — the LLM
just isn't told to escape-hatch them.

LTX later animates these shots using FF + LF as anchors; when they're
near-identical, LTX improvises subtle motion (steam curls, rain drops)
that would happen equally well with FF=LF.

## Fix path

**Option A — Broaden the guide's escape hatch (preferred).**

Update `prompts/skills/defaults/shot_composition_guide.md` section on
`edit_first_frame`/`last_frame`. Add guidance:

> If the shot's `purpose` is one of `meet_character`, `hold_emotion`,
> `show_reaction`, `set_the_mood` AND the `cameraWork` does NOT include
> a motion verb (push-in, pan, dolly, tracking, tilt, zoom), emit
> `last_frame: null` (or omit the key entirely). LTX will use the first
> frame as both anchors and improvise subtle atmosphere.

Executor already honors missing `last_frame` — the additional-frames
loop at `ExecutorAgent.ts:4126-4137` iterates `Object.keys(frames)`.

**Option B — Pre-LLM heuristic in the prompt builder.**

Before submitting the shot breakdown to the prompt-generating LLM,
parse the shot's `cameraWork` and `description` for motion verbs. If
absent and purpose is a holding beat, mark the shot as single-frame
upstream so the LLM doesn't even attempt a last_frame prompt. More
deterministic than (A), but more code.

**Option C — Post-gen perceptual similarity check.**

After both frames render, compute a perceptual hash (e.g., aHash or
dHash). If similarity >95%, discard last_frame from disk and clear
`outputPaths.last_frame`. Next-stage LTX gets FF=LF. Wastes the call
but catches everything including motion-verb false positives.

## Recommendation

Ship Option A first (guide-only change, reversible, ~1h work including
re-audit). If bottom-quartile shots regress meaningfully, roll back to
current behavior and try Option B.

Do not add Option C — it's wasted compute on the detection path.

## Notes

- Decision to defer made 2026-04-22. Discovered during noir hybrid
  regen review: S1.2 FF and LF visually indistinguishable.
- Klein-only regen confirmed ~85 avg, same as hybrid. So the waste is
  real but fidelity-neutral — a pure cost win, not a quality win.
- When this lands, re-audit noir to confirm no score regression.

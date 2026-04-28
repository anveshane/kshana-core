# Forbid OTS framing for single-character shots in shot_composition_guide

## Status: PARKED (2026-04-25)

## The bug

The shot_composition_guide allows the LLM to write `over_the_shoulder` framing for shots that have only ONE character ref. OTS is inherently a two-character composition (foreground anchor blurred + focal subject sharp). With only one character ref available, downstream image models react badly:

- **Klein** quietly under-interprets and renders something close to a regular medium shot, ignoring the OTS instruction.
- **Seedream4** (current default) takes OTS literally and *invents* a phantom second character to fill the OTS-anchor slot — the phantom often resembles the existing character (a "second Parvati") which is jarring.
- **Either**: the depth-of-field instruction (anchor blurred, subject sharp) makes no sense without two characters and produces incoherent focus.

## Repro example

`sun_hadnt_yet_cleared-2`, scene 4 shot 2. Single-char shot (Parvati alone in the mudroom kneeling at a bucket). The prompt LLM wrote:

> "A close-up over-the-shoulder view of Parvati from image 2 in the mudroom from image 1. Her hands are sharply in focus as she reaches toward a bucket of water; her face is softly blurred in the background…"

Refs: only `setting` + `parvati`. No second character. Seedream invented one in the foreground bottom-left during the regen.

## Fix sketch

Add to `prompts/skills/defaults/shot_composition_guide.md`:

1. Annotate the `over_the_shoulder` row in the shot-type table:
   > **REQUIRES 2+ characters in frame.**

2. Add a hard rule under "Rules:":
   > **Never use `over_the_shoulder` framing when the shot has only ONE character ref.** OTS is inherently a two-character composition: foreground anchor (blurred) and focal subject (sharp). With only one character, the image model will either invent a phantom second character or distort the scene. For self-OTS-style framings (camera angled over the protagonist's own shoulder, focusing on their hands or an object), use `insert`, `extreme_close_up`, or `close_up` shot types instead — and write the prose with the focal element (hands, object, face detail) as the subject. Example: instead of `"OTS view of Parvati reaching for the bucket"`, write `"Insert shot: Parvati's hand from image 2 reaching toward the bucket, fingers extended, in shallow focus..."`

## Resume trigger

After the current Seedream regen completes and we visually QA the result. If we see other examples of phantom-character invention from single-char OTS prompts, this becomes the priority fix and we reset shot_image_prompt to regenerate prose.

## Files to touch

- `prompts/skills/defaults/shot_composition_guide.md` (rule + table annotation)
- Optionally: a deterministic validator in `validateJsonOutput` for `shot_image_prompt` that detects `over-the-shoulder|OTS` phrases in prose when the references array has fewer than 2 character refs, and warns or rejects.

---
name: edit-and-regen-shot
description: Apply a creative change to a single shot or frame by editing its prompt file in-place and regenerating just that node. Triggers when the user asks for a tweak to one specific shot/frame ("make s1 shot 3's last frame have her hands tied", "change the lighting on s2 shot 5 to dawn", "redo s1 shot 1 with a wider angle"). Avoids running the whole pipeline.
---

# Edit and regenerate one shot

Use this when the user asks for a creative change to **one specific
shot or frame** — not for project-wide stylistic changes (those need
`scene_video_prompt` resets) and not for fresh starts (those use
`dhee_run_to`).

## Steps

1. **Load the right craft skill BEFORE you write.** A bad prompt is
   the leading cause of bad regens. Pull in:
   - **image-prompting** — for any change to `imagePrompt` (rules
     for composition, "from image N" reference markers, style cues,
     what the generator needs).
   - **video-direction** — for any change to `motionDirective`
     (camera vs subject motion, timing, transition vocabulary).

   These hold the same craft instructions the original generation
   pipeline used. Without them you'll lose character continuity,
   break reference markers, or produce prompts the generator
   misinterprets.

2. **Read the prompt file.** Use the `read` tool on:
   - `prompts/images/shots/scene-<N>-shot-<M>.json` — for image
     prompt changes (first/last/mid frames).
   - `prompts/motion/scene_<N>_shot_<M>.json` — for motion-directive
     changes that affect the rendered video.

   Note the path conventions differ:
   - **image prompts**: hyphens, in a `shots/` subfolder
   - **motion prompts**: underscores, no `shots/` subfolder

3. **Modify the right field.** For image prompts, the structure is
   ```
   { frames: { first_frame: { imagePrompt, references, ... },
               last_frame:  { imagePrompt, references, ... } } }
   ```
   Edit only `frames.<frame>.imagePrompt`. Keep `references`,
   `generationMode`, and other fields exactly as they are — they
   pin the visual identity. Apply the rules from `image-prompting`:
   if the existing prompt names a character via "from image 1",
   the edited prompt MUST keep the same reference and the same
   image number.

   For motion prompts, the file is `{ motionDirective: "..." }`.
   Replace the string per `video-direction` guidance.

4. **Write the file back** with `write` (or `edit` if it's a small
   targeted change). The new JSON must remain valid.

5. **Trigger the regen** with `dhee_invalidate` + `dhee_run_to`:
   - `dhee_invalidate node=shot_image:scene_<N>_shot_<M>` then
     `dhee_run_to scope='last_invalidated'` — regenerates just that
     image (uses the new prompt; produces fresh first+last frames).
   - `dhee_invalidate node=shot_video:scene_<N>_shot_<M>` then
     `dhee_run_to scope='last_invalidated'` — regenerates the video
     (uses the new motion directive over the existing frames).

   The regenerated asset surfaces as a media card in the chat as it
   lands on disk — you don't need to call `dhee_show_*` after.

## What NOT to do

- **Don't stage the new prompt in a sidecar / `_new` / `.draft` file.**
  The pipeline reads the canonical filename only — anything you write
  to `scene-<N>-shot-<M>_new.json` or similar is invisible to the
  executor. If you want to propose a change before committing, paste
  the proposed JSON into the chat as a code block and wait for the
  user's "go" — do NOT touch the filesystem until then. Once approved,
  overwrite the actual prompt file path (step 4) and run the regen
  (step 5). Half-applied edits leave the project in a confusing state
  where the preview shows the old prompt and there's a mystery file
  on disk no one wired in.
- Don't rewrite the entire prompt file from scratch — preserve the
  scaffolding (references, generationMode, schema fields).
- Don't run `dhee_run_to <stage>` for a single-shot change — that
  re-executes every shot.
- Don't call `dhee_invalidate stage=<upstream>` (plot, story,
  characters, setting, scene, world_style, scene_video_prompt) — that
  wipes wide swaths of generated content. Always invalidate the
  smallest scope that gets the job done; for a single shot edit that
  scope is one `node=`.

## Confirming the result

After `dhee_run_to scope='last_invalidated'` finishes:

1. **Call `dhee_describe_image`** on the regenerated frame, passing
   the prompt you just edited as `expectedPrompt`. The VLM tells you
   whether the new image actually reflects the edit (or whether the
   regen drifted, lost a reference, etc.).
2. **Summarize for the user.** Either "✓ regen matches the new prompt
   — <one-line description>" or "✗ regen still shows X — likely
   cause Y, want me to retry?". Don't just say "done — does it look
   right?" without having looked yourself.
3. If the user wants another iteration, repeat steps 1–4 of this
   skill with their next change.

Skip step 1 only if `dhee_describe_image` returns "VLM not
configured" — in that case fall back to `dhee_show_*` + asking
the user.

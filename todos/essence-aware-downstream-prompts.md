# Essence-aware downstream prompts (Phases 3–5)

## Context

Phases 1 + 2 of the story-essence work shipped on `feature/pi-agent-prompt-relay`:

- **Phase 1**: `story_essence` is now a first-class artifact (`src/core/planner/storyEssenceExtractor.ts` + registration in `src/templates/narrative.ts` + dep wiring in `src/core/planner/stages.ts`). It runs after `story` and before `character`/`setting`/`scene`. Stage A and Stage B of the hierarchical scene extractor inject an `<essence>` block when essence is loaded — including editorial license to invent beats the source under-serves if doing so strengthens the throughline.
- **Phase 2**: scene-prose generation injects a `<story-essence>` block (`src/core/planner/storyEssenceContextBlock.ts`) with genre-tuned guidance into per-scene prompts via `ExecutorAgent.buildPromptContext`.

What's left: the rest of the pipeline (motion directives, shot image prompts, world style) is still essence-blind. An emotional drama and a sci-fi action piece still get rendered with identical camera moves and shot compositions. That's the gap this todo closes.

## Phase 3 — Motion directives read essence

Tone-tune camera pacing per shot. The `shot_motion_directive` artifact is generated from `scene_video_prompt` shot data — its prompt should receive the essence so it can pick essence-appropriate motion.

- Drama → slow dolly, hold frames, breathing room, no whip-pans.
- Action → fast pan, hand-held, kinetic, snap zooms.
- Erotica → slow tracking, lingering close-ups.
- Horror → restrained moves, slow push-ins, sudden whips for jump beats.

### Implementation

- Inject `buildStoryEssenceBlock(this.storyEssence)` (already exists from Phase 2) into the user prompt for `shot_motion_directive` nodes, parallel to how Phase 2 does it for `scene` nodes. The block lives in `src/core/planner/ExecutorAgent.ts` `buildPromptContext` — extend the `node.typeId === 'scene' && this.storyEssence` guard to also cover `'shot_motion_directive'`.
- Genre guidance lookup may need to be expanded to motion-specific advice. Either reuse the existing prose guidance (it'll mostly carry over — "linger" applies equally to prose and camera) or split into a separate `buildMotionEssenceBlock()` helper if the per-genre advice diverges.

### Tests

Extend `tests/unit/storyEssenceContextBlock.test.ts` (or a new sibling file) to cover motion-directive injection. Verify that with essence loaded, the motion-directive user prompt contains the `<story-essence>` block.

## Phase 4 — Shot image prompts read essence

Tone-tune framing, lighting, and palette. The `shot_image_prompt` artifact is the last LLM step before image generation; its output drives ComfyUI workflow params (camera angle, lens, lighting setup).

- Drama → intimate close-ups, golden-hour or window-light, muted earth-tones, shallow DOF.
- Action → wide kinetic compositions, high contrast, saturated palette, crisp DOF.
- Erotica → soft focus, candle/window light, warm tones, intimate framing.
- Horror → high contrast, cool palette, hard shadows, off-balance compositions.

### Implementation

Same pattern as Phase 3: extend the essence-injection guard in `buildPromptContext` to cover `'shot_image_prompt'`. The image-prompt LLM already has access to character/setting refs and world_style; adding the essence block tilts framing and lighting choices toward the story's tone.

### Risk

Shot image prompts feed into existing image-generation workflows that have been tuned against today's prompt format. Adding a new context block could shift output style enough to require re-tuning calibration sets (`pnpm calibrate-vlm`). Verify on a small project before declaring done.

## Phase 5 — World style optionally reads essence

The `world_style` artifact today is visual-style focused (palette, lighting bible, atmosphere). It already touches tone, but doesn't know about narrative essence. Lightly thread essence so the visual style doesn't pull in a different tonal direction than the story wants (e.g. don't generate a vibrant saturated palette for an emotional drama).

### Implementation

Same injection pattern. Lighter touch — world_style's existing prompt already produces tone-aware output, so essence here is a sanity nudge rather than a wholesale rewrite. If preliminary inspection shows world_style is already producing essence-appropriate styles, this phase can be skipped.

## Decision criteria for proceeding

Before starting these phases:

1. Run Phases 1 + 2 on 2–3 contrasting real projects (`sun_hadnt_yet_cleared` style emotional, `lazarus_drive` style action, an erotica piece).
2. Check that `prompts/story_essence.json` produces sensible genre / throughline calls.
3. Compare the resulting per-scene `chapters/chapter_1/scenes/scene_*.md` files between contrasting genres — drama prose vs action prose. Should clearly differ in voice.
4. If essence detection is unreliable for ambiguous stories, prioritize tuning the essence prompt or making it user-editable at a stage gate before threading through more downstream prompts.

If essence detection is solid, ship 3 → 4 → 5 in that order. Each is independently shippable and adds incremental value (camera tone, framing tone, world-style consistency).

## Related files

- `src/core/planner/storyEssenceExtractor.ts` — Stage 0 LLM call (Phase 1)
- `src/core/planner/hierarchicalSceneExtractor.ts` — Stage A + B prompts inject essence (Phase 1)
- `src/core/planner/storyEssenceContextBlock.ts` — pure helper that builds the `<story-essence>` block (Phase 2; reusable for 3/4/5)
- `src/core/planner/ExecutorAgent.ts:3232` — current injection site for scene prose (Phase 2 wiring; extend the guard for 3/4/5)
- `src/templates/narrative.ts` — artifact registration + dep tree
- `src/core/planner/stages.ts` — STAGE_ALIASES + TEMPLATE_DEPS

## How a user re-runs after this lands

```
pnpm reset <project> shot_motion_directive   # phase 3
pnpm reset <project> shot_image_prompt       # phase 4
pnpm reset <project> world_style             # phase 5
pnpm run-to <project>                        # picks up from the reset point
```

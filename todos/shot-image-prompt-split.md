# Split shot_image_prompt Into Multi-Call Pipeline

## Status: PARKED (2026-04-24)

Pipeline code is built and unit-tested in `src/core/planner/shotImagePipeline.ts`
(`generateShotImagePromptPipeline`, `assembleShotImagePrompt`, per-mode guides in
`prompts/skills/defaults/shot_*_guide.md`) but **not wired into ExecutorAgent**.
`ExecutorAgent.ts` still maps `shot_image_prompt → shot_composition_guide` (the
single-call monolithic path).

Parked because: on the same model, 2–3 calls per shot is neutral-to-slightly-more
expensive than 1. The split only pays off if we downgrade to a cheaper model for
each simpler call, and we're not currently blocked on the `mimo-v2-flash` 80.6%
ceiling hard enough to justify the wire-up + model-swap work.

To resume: wire `generateShotImagePromptPipeline` into the `shot_image_prompt`
branch of `ExecutorAgent.generateForNode`, retire `shot_composition_guide.md`,
and decide per-call model tiers.

## Priority: HIGH (unblocks quality ceiling for smaller LLMs)

## Problem

The current shot_image_prompt generation asks the LLM to do 6 competing tasks in a single call:
1. Decide mode (edit_previous_shot vs image_text_to_image) — classification
2. Select correct references — logic
3. Write a cinematic prompt in the right style — creative
4. Follow frozen-instant constraints — self-editing
5. Write a dramatic delta for last_frame — creative + constrained
6. Get JSON structure right — formatting

Smaller models (mimo-v2-flash) plateau at ~80% because they can't juggle all constraints simultaneously. The guide is ~20KB but the model ignores rules that compete with each other.

## Proposed Architecture

Split into 3 focused LLM calls + deterministic assembly:

### Call 1: Mode Decision (classification)
- **Input**: shot description, previous shot info, available references, shot purpose
- **Output**: `{ mode: "edit_previous_shot" | "image_text_to_image" | "text_to_image", newCharacterRefs: [...], existingSubjects: [...] }`
- **Guide**: Short, focused on decision criteria only (~1KB)
- Small models excel at classification tasks

### Call 2: First Frame Prompt (creative)
- **Input**: shot description + mode + refs from call 1
- **Guide**: Loaded per-mode (not a single monolithic guide):
  - `edit_previous_shot_guide.md` — delta-only template, frozen-instant rules (~2KB)
  - `image_text_to_image_guide.md` — full scene description, lighting, composition rules (~3KB)
  - `text_to_image_guide.md` — detail/mood shots (~1KB)
- **Output**: imagePrompt string only (not JSON)

### Call 3: Last Frame Prompt (creative)
- **Input**: first_frame prompt + `<last_frame_changes>` state diff
- **Guide**: ONLY delta rules + frozen-instant (~1KB)
- **Output**: imagePrompt string only

### Deterministic Assembly (no LLM)
- Code builds the JSON from calls 1-3:
  - `generationStrategy` from `getVideoStrategy()` (already code-driven)
  - `frames.first_frame` = { imagePrompt from call 2, generationMode from call 1, references from call 1 }
  - `frames.last_frame` = { imagePrompt from call 3, generationMode: "edit_first_frame", references: [] }
  - `negativePrompt` from a deterministic template per shot type
  - `aspectRatio` always "16:9"
- JSON structure is always correct — zero VALID_JSON failures

## What This Fixes By Design

| Current Failure | Fix |
|----------------|-----|
| VALID_JSON (was 12/12) | Eliminated — code builds JSON |
| STRATEGY_APPROPRIATE | Eliminated — code sets strategy |
| MODE_DECISION | Isolated to call 1 with focused classification guide |
| EDIT_PREV_DELTA | Call 2 loads delta-only guide — no full-scene rules to confuse it |
| EDIT_PREV_REFS | Decided in call 1 (classification), not mixed with creative writing |
| FROZEN_INSTANT | Only competes with creative writing, not mode/ref/JSON rules |
| LAST_FRAME_DELTA | Isolated to call 3 with only delta rules |

## Tradeoffs

- 3 LLM calls per shot instead of 1 (~2x wall time per shot)
- Each call is simpler/faster (shorter prompts, shorter outputs)
- More code complexity in executor (3-call orchestration)
- Per-mode guides to maintain instead of one monolithic guide

## Implementation

### New files needed:
- `prompts/skills/defaults/shot_mode_decision_guide.md` — call 1 guide
- `prompts/skills/defaults/shot_edit_previous_guide.md` — call 2 guide (edit mode)
- `prompts/skills/defaults/shot_fresh_generation_guide.md` — call 2 guide (fresh mode)
- `prompts/skills/defaults/shot_last_frame_guide.md` — call 3 guide

### Modified files:
- `src/core/planner/ExecutorAgent.ts` — replace single `generateForNode` call with 3-call pipeline for `shot_image_prompt` nodes
- `src/core/planner/schemas.ts` — add schemas for call 1 output
- `tests/autoresearch/rubrics/` — split rubric into per-call rubrics

### Key files:
- `src/core/planner/ExecutorAgent.ts` — main execution, ~line 1340 (buildPromptForNode for shot_image_prompt)
- `prompts/skills/defaults/shot_composition_guide.md` — current monolithic guide (to be replaced)
- `scripts/autoresearch-shot-composition.ts` — update to test multi-call pipeline

## Current Baseline

- Single-call with mimo-v2-flash: **80.6% (145/180)** — 15-question rubric, 12 test shots
- Stubborn failures: FROZEN_INSTANT (7), LAST_FRAME_DELTA (8), SHOT_FAITHFUL (5)

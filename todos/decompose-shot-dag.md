# Decompose Shot Image Prompt & Motion Directive into Mini-DAGs

## Problem

shot_image_prompt and shot_motion_directive are monolithic LLM calls that do too much:
- Pick strategy (flfv/fmlfv)
- Pick references and assign image numbers
- Decide generation mode (image_text_to_image, edit_previous_shot, text_to_image)
- Write prose prompts
- Include dialogue
- Assemble JSON

This causes: hallucinated refIds (mr_pattern instead of mr_patel), wrong strategy choices, missing dialogue, broken JSON structure.

## Solution: Decompose into Deterministic + Stochastic Steps

### Shot Image Prompt — Mini-DAG

```
scene_breakdown
    ↓
[DETERMINISTIC] resolve_available_refs
    → scan completed character_image, setting_image, object_image nodes
    → match against shot's characters[] and setting
    → output: ordered reference list with image numbers
    ↓
[DETERMINISTIC] classify_shot_complexity
    → VFX/transformation keywords → fmlfv
    → duration > 6s → fmlfv
    → else → flfv
    ↓
[DETERMINISTIC] determine_generation_mode
    → shot 1 in scene → image_text_to_image
    → continuation shot, similar angle → edit_previous_shot
    → extreme close-up on detail → text_to_image
    ↓
[LLM - STOCHASTIC] write_frame_prompts
    → receives: description, resolved refs with image numbers, strategy, mode
    → ONLY job: write imagePrompt prose for first_frame (+ last_frame if needed)
    → much simpler LLM call — no decisions, just prose
    ↓
[DETERMINISTIC] assemble_shot_image_prompt_json
    → combine: strategy + mode + refs + prompts → final JSON
```

### Shot Motion Directive — Mini-DAG

```
scene_breakdown
    ↓
[DETERMINISTIC] extract_shot_context
    → pull: description, dialogue, soundCue, cameraWork, duration
    ↓
[LLM - STOCHASTIC] write_motion_prompt
    → receives: structured context (not raw JSON)
    → ONLY job: write 30-60 word motion prompt following template
    ↓
[DETERMINISTIC] inject_dialogue
    → if dialogue exists, append: '[Character] says "[line]"'
    ↓
[DETERMINISTIC] assemble_motion_json
    → wrap in {"motionDirective": "..."}
```

### Shot Continuity — Deterministic Chain

Currently shots are generated independently. Shot 1 shows an empty bed, Shot 2 shows Keerti lying down, Shot 4 shows her standing — no visual continuity.

```
[DETERMINISTIC] establish_shot_continuity (runs before write_frame_prompts)
    → For shot N (N > 1), read shot N-1's data:
      - Last frame description (what characters were visible, positions, state)
      - Which characters were in frame
      - What the end state looked like
    → Inject continuity context into the LLM prompt:
      "Previous shot ended with: [shot N-1 last frame description]"
      "Characters carried forward: [list with last-known positions]"
    → Decide generation mode deterministically:
      - Same characters + similar camera angle → edit_previous_shot
      - Different characters or new location → image_text_to_image
      - Detail/insert shot → text_to_image
```

This ensures:
- Shot 2's first frame is visually consistent with Shot 1's end
- Character positions don't teleport between shots
- The LLM prompt for each shot includes what came before
- Generation mode is chosen based on continuity, not LLM guessing

The sequential dependency (shot N depends on shot N-1) already enforces execution order. This step adds **content continuity** on top of execution order.

## Key Benefits

1. **Reference resolution is deterministic** — no hallucinated refIds
2. **Strategy selection is deterministic** — rules-based, not LLM judgment
3. **Generation mode is deterministic** — first shot = i2t, continuation = edit_previous, detail = t2i
4. **Shot continuity is deterministic** — previous shot context injected, no teleporting characters
5. **LLM only writes prose** — simplest task, no JSON/refs/strategy/continuity decisions
6. **Dialogue injection is deterministic** — never lost
7. **Each step is independently testable** — unit tests for deterministic, autoresearch for LLM

## Priority

High — this eliminates the most common failure modes in the current pipeline.

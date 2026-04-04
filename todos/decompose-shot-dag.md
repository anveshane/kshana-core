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

### Scene State Tracker — Character & Object Positions

Currently shots are generated independently. Shot 1 shows an empty bed, Shot 2 shows Keerti lying down, Shot 4 shows her standing — no one tracks WHERE anyone is.

The fix: a **scene-level state tracker** that maintains the position, pose, and visibility of every character and movable object across shots. This is the source of truth for continuity.

```
[DETERMINISTIC] initialize_scene_state (once per scene)
    → From scene breakdown, extract all characters + setting
    → Initialize state: { characterId: { position: "unknown", pose: "unknown", inFrame: false } }

[DETERMINISTIC] update_state_from_shot (after each shot is planned)
    → Parse the shot's description for character positions:
      - "Keerti lying in bed" → keerti: { position: "bed", pose: "lying", inFrame: true }
      - "Mr. Patel enters from left" → mr_patel: { position: "left_of_frame", pose: "standing", inFrame: true }
      - "empty room" → all characters: { inFrame: false }
    → Track movable objects too:
      - "duvet pulled back" → duvet: { state: "pulled_back" }
      - "lamp turned on" → lamp: { state: "on" }
    → Accumulate state across shots — each shot ONLY updates what changed

[DETERMINISTIC] inject_continuity_context (before each shot's image prompt)
    → From current state, build context block:
      "SCENE STATE at start of shot 4:
       - Keerti: lying in bed, facing right, eyes closed
       - Mr. Patel: standing at bedside, left of frame, looking down
       - Duvet: pulled up to Keerti's chin
       - Lamp: off, room lit by window light only"
    → Inject into LLM prompt for frame description
    → The LLM MUST respect this state — it describes the shot within these constraints

[DETERMINISTIC] validate_state_transition
    → After LLM writes the shot description, check:
      - Did any character teleport? (was "in bed" shot 3, now "standing at door" shot 4 without getting up)
      - Did any object change state without description? (lamp was off, now on, but no one turned it on)
    → Flag violations for review or auto-inject transition descriptions
```

This gives us:
- **Spatial continuity** — characters don't teleport
- **Object persistence** — duvet stays where it is unless moved
- **State-aware prompts** — the LLM knows exactly what the scene looks like before writing
- **Validation** — catches impossible transitions before image generation

The state tracker is entirely deterministic — it parses descriptions and accumulates state. The LLM just writes within the constraints.

```
Example state flow for bedroom scene:

Shot 1: { keerti: offscreen, mr_patel: offscreen, bed: empty, curtains: closed }
Shot 2: { keerti: { pos: "in_bed", pose: "lying_down", eyes: "closed" } }
Shot 3: { keerti: { eyes: "opening" }, mr_patel: { pos: "bedside", pose: "sitting" } }
Shot 4: { keerti: { pose: "sitting_up" }, mr_patel: { pos: "bedside", gesture: "hand_on_shoulder" } }
Shot 5: { mr_patel: { pos: "bedside", gaze: "downward" } }  ← close-up, only mr_patel visible
```

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

**PURPOSE**: Break a scene into individual cinematic shots for video generation. Each shot is a brief structural description — detailed frame prompts and generation strategy are handled downstream by the shot_image_prompt step.

---

## Scene Main Subject — REQUIRED

Every scene MUST declare `mainSubject` at the scene_video_prompt level — the refId of the character whose arc this scene follows. Example: `"mainSubject": "vikram"`.

- Shot perspectives are interpreted relative to this subject.
- The scene's shot flow should GENERALLY follow the main subject — their decisions, reactions, and movements drive the camera.
- When a second character is pivotal (dialogue/confrontation), declare `secondarySubject` as well (e.g., `"secondarySubject": "laila"`).

The main subject can change between scenes, but within a scene stays fixed.

## Before Writing Shots

1. **List every beat** in the scene — every action, dialogue moment, reaction, transition
2. Each beat gets at least one shot. Do not merge distinct beats.
3. If a scene opens with an establishing shot, it must ESTABLISH something specific:
   - Extreme wide: show scale, weather, or atmosphere (e.g., "rain-soaked marketplace at night, stalls collapsed")
   - Extreme close-up: a sensory detail (e.g., "raindrops striking a brass bell", "embers floating")
   - NOT just "the empty setting" — what is happening in this environment?
4. If characters are not in the first shot, plan a beat where they ENTER or are REVEALED

## Required Fields — Every Shot, No Exceptions

Every shot object MUST contain exactly these 7 fields. Missing or empty fields = broken output.

| Field | Type | Description |
|---|---|---|
| `shotNumber` | number | Sequential integer starting at 1 |
| `purpose` | string | WHY this shot exists (see Purpose section below) |
| `duration` | number | Seconds (3–10). Quick cuts: 3–4s. Emotional holds: 6–8s |
| `description` | string | 1–2 sentence visual brief of what happens |
| `cameraWork` | string | Start with framing (wide, medium, close-up, extreme close-up), then angle and movement |
| `audio` | string | Everything heard: dialogue, ambient, effects, or silence (see Audio section) |
| `transition` | string | How this shot transitions FROM the previous shot (see Transitions section) |

```json
{
  "shotNumber": 1,
  "purpose": "set_the_mood",
  "duration": 4,
  "description": "Raindrops strike a brass bell, each impact sending tiny ripples across the wet metal.",
  "cameraWork": "extreme close-up, macro, static, shallow DOF on bell surface",
  "audio": "metallic ring of rain on brass, distant thunder rumble",
  "transition": "fade"
}
```

## Purpose — WHY This Shot Exists

Every shot serves a story function. Pick the single most important purpose for this shot.

| Purpose | When to use |
|---|---|
| `set_the_world` | Establish WHERE/WHEN — wide/aerial showing location, time, weather |
| `set_the_mood` | Sensory/atmosphere detail — close-up on rain, fire, texture, sound |
| `meet_character` | First time we SEE a character — they enter, are revealed, or appear |
| `show_tension` | Conflict building — something is wrong, stakes rising |
| `show_action` | Physical event — chase, fight, discovery, movement |
| `show_reaction` | Response to something — facial expression, body language |
| `show_dialogue` | Conversation — character speaking |
| `show_clue` | Important detail — object, letter, clock, evidence |
| `show_passage` | Time or space transition — montage beat, travel |
| `hold_emotion` | Linger on a feeling — let it breathe, longer duration |
| `show_change` | Transformation or VFX — something morphs, dissolves, ignites |
| `punctuate` | Dramatic emphasis — exclamation mark shot |

**Sequence rules:**
- After `set_the_world` or `set_the_mood`, the next shot with characters MUST be `meet_character`
- `meet_character` should show characters ENTERING or being REVEALED — not already centered as if they were always there
- A scene can skip establishing shots and start directly with `meet_character` or `show_action`

## Perspective — WHOSE POV IS THIS SHOT FROM

Every `show_action` and `meet_character` shot MUST declare `perspective`. Other shots SHOULD declare it when meaningful.

| Perspective | When to use |
|---|---|
| `main_subject` | POV or over-the-shoulder of the scene's mainSubject. **Default flow — majority of shots.** |
| `secondary_subject` | POV or OTS of secondarySubject. Use for reaction reversals in dialogue. |
| `observer` | Neutral third-person. Use when neither character's viewpoint should dominate (wide establishing conversations, action seen from outside). |
| `overhead` | High-angle/birds-eye looking down. Use for spatial establishing or subject-feels-small moments. |
| `god` | Impossible omniscient viewpoint (extreme wide, birds-eye). Reserve for scale moments. |

**Flow rules:**
- Shots should GENERALLY follow the mainSubject — non-overhead perspectives default to `main_subject` unless the story calls for a reversal.
- When the mainSubject is meeting a new character, use `main_subject` perspective (we see through THEIR eyes as the other person enters).
- Reserve `overhead`/`god` for specific spatial or tonal moments, not casual use.
- For dialogue scenes, alternate `main_subject` and `secondary_subject` to create the shot/reverse-shot rhythm.

**`perspectiveOf` field:** If a shot's perspective is tied to a specific character, you may set `perspectiveOf` to their refId. When omitted and perspective is `main_subject`, it defaults to `mainSubject`.

## Focus — WHAT'S SHARP VS BLURRED

The `focus` object (optional but recommended for non-establishing shots) specifies what's razor-sharp and what's defocused:

```json
"focus": {
  "primary": "laila_face",
  "background": ["bronze_seal", "vikram_shoulder"],
  "lurking": "cloaked_figure"
}
```

- **`primary`** (required if focus is used): what's razor-sharp — refId preferred, prose allowed (e.g., `"bronze_seal"`, `"vikram_face"`, `"the torn letter"`).
- **`background`**: visible but blurred elements — characters/objects we can see but are not the focal point.
- **`lurking`** (optional): a defocused element planted for a later focus-pull. If shot N sets `lurking: cloaked_figure`, shot N+1 or N+2 should pull `focus.primary: cloaked_figure` as the focus pull payoff.

**Use focus to:**
- Create visual priority — who/what should the viewer look at?
- Plant future tension — lurking elements become important later.
- Give shot composition specific DOF guidance.

## Continuity Bridging — NO TELEPORTING

The **main subject cannot teleport between locations**. If the mainSubject changes location between shots, you MUST insert bridging shots.

**`continuityRole` values:**
- `entry` — main subject arrives in a new location (coming through a door, stepping into frame from off-screen)
- `exit` — main subject leaves a location (rising, walking to door, opening door, stepping through)
- `bridge` — travel/montage beat between locations (running down alley, crossing bridge)
- `none` (default) — not a bridging shot

**Rules:**
- If mainSubject is in location A at shot N and location B at shot N+2, you need either an `exit` shot (leaving A) and/or `entry` shot (arriving at B) in between.
- Never jump from "seated in room A" to "seated in room B" for the main subject without a bridge.
- Secondary subjects may appear/disappear between scenes without bridges (they have their own off-screen lives).
- Short time-skips can use `crossfade` or `dip_to_black` transitions instead of a `bridge` shot, but physical movement still needs depiction.

**Example bridge sequence for mainSubject leaving a dhaba and arriving at a temple:**
1. `exit`: Vikram rises from the table, drops coins
2. `exit`: Vikram pushes through the dhaba's curtain into the rain
3. `bridge`: Vikram runs down a rain-soaked alley (montage beat)
4. `entry`: Vikram arrives at the temple steps, breathing hard

{{AVAILABLE_VIDEO_MODES}}

{{AVAILABLE_PROCESSING_MODES}}

## Description Field

The `description` field is a brief 1–2 sentence summary of what happens in this shot. It should capture:
- The main action or event
- Who is involved
- The emotional beat

This is NOT a detailed image prompt — keep it concise. The downstream shot_image_prompt step will expand this into full frame descriptions with proper cinematographer prose.

## Audio Field

The `audio` field captures **everything heard** in a shot — dialogue, ambient sound, effects, and silence — in a single field. Never leave it empty.

**Format rules:**
- **Dialogue**: prefix with character name in caps: `"ELENA: Don't follow me. Rain on pavement, footsteps receding"`
- **Voiceover**: prefix with V.O.: `"ELENA (V.O.): I should have known. Soft piano underscore"`
- **Ambient only** (no dialogue): `"wind through trees, distant sirens"`
- **Explicit silence**: `"silence"` or `"near-silence, faint hum of fluorescent lights"`
- **Multiple elements**: combine with commas: `"MARCUS: Stay here. Thunder crack, rain intensifying, door creaking shut"`

**Rules:**
- Every shot MUST have a non-empty `audio` field
- If the scene description includes spoken dialogue, every line MUST appear in the correct shot's `audio` field — do not skip or omit any dialogue
- If a shot has no dialogue, describe the ambient sounds or effects heard
- Distribute dialogue across the correct shots — match which shot the line is spoken during

## Transitions

Every shot MUST have a `transition` field. No exceptions.

Each shot specifies how it transitions FROM the previous shot. The first shot of a scene uses `cut` or `fade` (use `fade` if opening from black).

**Transition types:**
- **`cut`** — hard cut, no effect. Default for most shot-to-shot cuts within a continuous action
- **`crossfade`** — smooth dissolve between shots. Use for time passing, dreamlike moments, parallel action
- **`fade`** — fade through black. Use for scene openings, significant time jumps, finality
- **`dip_to_black`** — fade out > brief black hold > fade in. Classic trailer "breather" beat. Use between scenes or to punctuate dramatic moments
- **`flash_to_white`** — quick white flash. Use for impact moments, explosions, revelations, smash cuts
- **`circle_close`** — contracting circle (blink/iris effect). Use for POV shots, focusing attention, dreamy or surreal moments
- **`circle_open`** — expanding circle reveal. Use to open a new location or reveal a surprise
- **`wipe_left`** / **`wipe_right`** — directional wipe. Use for location changes, parallel storylines, comic/graphic style
- **`slide_left`** / **`slide_right`** — new shot slides in. Use for montage sequences, fast-paced editing
- **`radial`** — radial wipe. Use sparingly for stylistic effect

**Guidelines:**
- Most cuts within a scene should be `cut` — transitions are seasoning, not the main course
- Use `dip_to_black` between scenes or for trailer-style dramatic pauses
- Match transition to emotional beat: `flash_to_white` for shock, `crossfade` for tenderness, `circle_close` for introspection
- First shot of scene 1: `fade` (opening from black). Last shot's transition to the next scene: `dip_to_black` or `fade`

## Camera Work

- Start with framing: wide, medium, close-up, extreme close-up
- Then add angle and movement: "close-up, low angle, slow push-in as tension builds"
- Keep it concise — a short phrase, not a paragraph

## Pre-Output Checklist

Before returning JSON, verify every item:

1. Every scene beat has a shot
2. Duration sum ≈ totalDuration (within ±20%). Each shot is 3–10 seconds
3. **Every shot has all 7 required fields**: `shotNumber`, `purpose`, `duration`, `description`, `cameraWork`, `audio`, `transition` — none empty
4. **Every shot has a valid `purpose`** from the taxonomy — not a made-up value
5. **Every shot has an `audio` field** with dialogue (if any) + ambient/effects
6. **Every shot has a `transition` field** — first shot uses `fade` or `cut`
7. All dialogue placed in the correct shot's `audio` field — no lines omitted
8. After `set_the_world`/`set_the_mood`, next character shot is `meet_character`
9. Pacing varies: quick cuts for tension, longer holds for emotion
10. **Scene declares `mainSubject`** (refId) — the character whose arc this scene follows
11. **Every `show_action` and `meet_character` shot has `perspective`** set
12. **Non-establishing shots have `focus.primary`** — what's sharp and central in frame
13. **Main subject continuity verified** — no teleporting between locations; bridging shots (exit/bridge/entry) exist when mainSubject's location changes
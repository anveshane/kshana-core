**PURPOSE**: Break a scene into individual cinematic shots for video generation. Each shot is a brief structural description — detailed frame prompts and generation strategy are handled downstream by the shot_image_prompt step.

---

## Before Writing Shots

1. **List every beat** in the scene — every action, dialogue moment, reaction, transition
2. Each beat gets at least one shot. Do not merge distinct beats.
3. Plan at least one character-free shot (establishing, insert, or atmosphere)

## Required Fields — Every Shot, No Exceptions

Every shot object MUST contain exactly these 6 fields. Missing or empty fields = broken output.

| Field | Type | Description |
|---|---|---|
| `shotNumber` | number | Sequential integer starting at 1 |
| `duration` | number | Seconds (3–10). Quick cuts: 3–4s. Emotional holds: 6–8s |
| `description` | string | 1–2 sentence visual brief of what happens |
| `cameraWork` | string | Specific camera direction (angle, movement, framing) |
| `audio` | string | Everything heard: dialogue, ambient, effects, or silence (see Audio section) |
| `transition` | string | How this shot transitions FROM the previous shot (see Transitions section) |

```json
{
  "shotNumber": 1,
  "duration": 5,
  "description": "Elena steps into the rain-soaked alley, her silhouette framed by a flickering neon sign.",
  "cameraWork": "wide establishing, static tripod, shallow focus on Elena with neon bokeh behind",
  "audio": "rain pattering on cobblestones, distant thunder rumble, neon sign buzzing",
  "transition": "fade"
}
```

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

- Specific direction: angle, movement, framing, depth of field
- Not just "medium shot" — describe behavior: "static medium, slight push-in as tension builds"
- Keep it concise — a short phrase, not a paragraph

## Pre-Output Checklist

Before returning JSON, verify every item:

1. Every scene beat has a shot
2. Duration sum ≈ totalDuration (within ±20%). Each shot is 3–10 seconds
3. **Every shot has all 6 required fields**: `shotNumber`, `duration`, `description`, `cameraWork`, `audio`, `transition` — none empty
4. **Every shot has an `audio` field** with dialogue (if any) + ambient/effects. No shot is missing audio
5. **Every shot has a `transition` field** — first shot uses `fade` or `cut`, all others have an explicit transition value
6. All dialogue from the scene description is placed in the correct shot's `audio` field — no lines omitted
7. Pacing varies: quick cuts for tension, longer holds for emotion
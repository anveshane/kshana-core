**PURPOSE**: Break a scene into individual cinematic shots for video generation. Each shot is a brief structural description — detailed frame prompts and generation strategy are handled downstream by the shot_image_prompt step.

---

## Before Writing Shots

1. **List every beat** in the scene — every action, dialogue moment, reaction, transition
2. Each beat gets at least one shot. Do not merge distinct beats.
3. Plan at least one character-free shot (establishing, insert, or atmosphere)

## Shot Structure

Each shot must have:
- **description**: 1-2 sentence brief of what happens in this shot
- **characters**: array of character item IDs visible in this shot
- **setting**: setting item ID or null
- **cameraWork**: camera movement and angle
- **soundCue**: what is heard (ambient, effects, explicit silence)
- **dialogue**: spoken line for this shot, or `null` if none (see Dialogue section below)
- **transition**: how this shot transitions FROM the previous shot (see below)

{{AVAILABLE_VIDEO_MODES}}

{{AVAILABLE_PROCESSING_MODES}}

## Description Field

The `description` field is a brief 1-2 sentence summary of what happens in this shot. It should capture:
- The main action or event
- Who is involved
- The emotional beat

This is NOT a detailed image prompt — keep it concise. The downstream shot_image_prompt step will expand this into full frame descriptions with proper cinematographer prose.

## Transitions

Each shot specifies how it transitions FROM the previous shot. The first shot of a scene uses `cut` (or `fade` if the scene opens from black).

**Transition types:**
- **`cut`** — hard cut, no effect. Default for most shot-to-shot cuts within a continuous action
- **`crossfade`** — smooth dissolve between shots. Use for time passing, dreamlike moments, parallel action
- **`fade`** — fade through black. Use for scene breaks, significant time jumps, finality
- **`dip_to_black`** — fade out > brief black hold > fade in. The classic trailer "breather" beat. Use between scenes or to punctuate dramatic moments
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

## Character & Setting IDs

- Use ONLY the exact IDs provided — no variations, no full names
- Any character visible (even hand/silhouette) or speaking off-screen -> include their ID
- Named location -> must have setting ID

## Dialogue

- If the scene description includes character dialogue (spoken lines, voiceover, V.O.), you MUST include it
- Set the `dialogue` field to the character's spoken line for that shot, prefixed with the character name: `"JOHN: Don't worry, Glitch."`
- For voiceover, prefix with V.O.: `"JOHN (V.O.): 42 years ago, I paid for everything..."`
- Set `dialogue` to `null` if the shot has no spoken dialogue
- Distribute dialogue across the correct shots — match which shot the line is spoken during
- Do NOT skip or omit any dialogue from the scene description

## Sound Cues

- Every shot MUST have a soundCue — ambient, effects, dialogue, or explicit silence

## Camera Work

- Specific direction: angle, movement, framing, depth of field
- Not just "medium shot" — describe behavior: "static medium, slight push-in as tension builds"

## Pre-Output Check

1. Every scene beat has a shot
2. Duration sum = totalDuration exactly
3. Every shot has soundCue
4. All character IDs match provided list
5. **All dialogue from the scene description is placed** — every spoken line, V.O., or voiceover has a matching `dialogue` field on the correct shot
6. Every shot has a `transition` field

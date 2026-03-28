**PURPOSE**: Break a scene into individual cinematic shots for video generation. Each shot has a first frame (and optional last frame) that gets generated as an image, then animated into video.

---

## Before Writing Shots

1. **List every beat** in the scene — every action, dialogue moment, reaction, transition
2. Each beat gets at least one shot. Do not merge distinct beats.
3. Plan at least one character-free shot (establishing, insert, or atmosphere)

## Shot Structure

Each shot must have:
- **firstFrame**: what the camera sees at the START of the shot (description, characters, setting)
- **lastFrame** (optional): what the camera sees at the END — only include if the end state differs from the start
- **generationStrategy**: how this shot will be generated (see below)
- **cameraWork**: camera movement and angle
- **soundCue**: what is heard (ambient, effects, explicit silence)
- **dialogue**: spoken line for this shot, or `null` if none (see Dialogue section below)
- **transition**: how this shot transitions FROM the previous shot (see below)

## Generation Strategy

Classify each shot:
- **`i2v`** — Characters visible in firstFrame. Generates first-frame image (with character/setting refs), then image-to-video. Use for most character shots.
- **`t2v`** — No characters in firstFrame AND no lastFrame with characters. Text-to-video only, no image generated. Use for establishing shots, atmospheric inserts, environment-only.
- **`i2v_late_entry`** — firstFrame has NO characters but lastFrame HAS characters. Generates setting-only first frame, character enters mid-shot. Use when a character walks into frame.

## First + Last Frame

**firstFrame** is always required. It describes the opening visual.

**lastFrame** — include when:
- The shot has a clear visual endpoint different from the start (character enters, object revealed, camera arrives)
- The shot needs to chain smoothly into the next shot
- Long shots (6s+) that may drift without end-frame anchoring

**lastFrame** — omit when:
- Short shots (3-4s) that stay visually consistent
- Static shots (close-up held on a face, ambient establishing)
- Free motion desired (let the video model interpret)

**Cross-shot chaining**: Shot N's lastFrame should visually match Shot N+1's firstFrame for smooth transitions.

## Transitions

Each shot specifies how it transitions FROM the previous shot. The first shot of a scene uses `cut` (or `fade` if the scene opens from black).

**Transition types:**
- **`cut`** — hard cut, no effect. Default for most shot-to-shot cuts within a continuous action
- **`crossfade`** — smooth dissolve between shots. Use for time passing, dreamlike moments, parallel action
- **`fade`** — fade through black. Use for scene breaks, significant time jumps, finality
- **`dip_to_black`** — fade out → brief black hold → fade in. The classic trailer "breather" beat. Use between scenes or to punctuate dramatic moments
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
- Any character visible (even hand/silhouette) or speaking off-screen → include their ID
- Named location → must have setting ID

## Descriptions (firstFrame / lastFrame)

Write each frame description as detailed, literal cinematographer prose — what the camera physically sees in this frozen moment. Think like a shot list:

- **Start with the main subject and action** — "A woman with long brown hair and light skin stands at a rain-streaked window"
- **Specific appearances** — name hair color, skin tone, clothing materials, distinguishing features
- **Precise body language** — not "they interact" but "she extends a trembling hand toward the metal handle, fingers slightly curled"
- **Environment details** — what surrounds the subject, background depth, objects in frame
- **Lighting** — direction, quality, color temperature: "warm golden light from the setting sun casts long shadows across the floor"
- **Camera framing** — implied by the level of detail (close-up describes pores, wide shot describes architecture)

Aim for 2-3 sentences per frame description. Be literal — describe only what is visible, not what it means.

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
3. At least one t2v or character-free shot
4. Every shot has soundCue
5. All character IDs match provided list
6. generationStrategy matches character presence in firstFrame/lastFrame
7. **All dialogue from the scene description is placed** — every spoken line, V.O., or voiceover has a matching `dialogue` field on the correct shot
8. Every shot has a `transition` field

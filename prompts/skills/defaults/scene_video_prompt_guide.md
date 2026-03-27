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
- **soundCue**: what is heard

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

## Character & Setting IDs

- Use ONLY the exact IDs provided — no variations, no full names
- Any character visible (even hand/silhouette) or speaking off-screen → include their ID
- Named location → must have setting ID

## Descriptions

- What a camera physically sees in this frozen moment
- Be specific: not "they interact" but "she extends a trembling hand toward the handle"

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

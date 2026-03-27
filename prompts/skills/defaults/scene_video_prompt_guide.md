**PURPOSE**: Break a scene into individual cinematic shots for video generation. Each shot becomes a separate image + video clip.

---

## Before Writing Shots

1. **List every beat** in the scene — every action, dialogue moment, reaction, transition
2. Each beat gets at least one shot. Do not merge distinct beats into one shot.
3. Plan at least one character-free shot (establishing, insert, or atmosphere)

## Shot Rules

- Each shot: shotNumber, shotType, duration (3-10s), description, cameraWork, characters, setting
- Use at least 3 different shot types
- **Duration sum must equal totalDuration exactly.** Add them up before outputting.

## Character & Setting IDs

- Use ONLY the exact IDs provided — no variations, no full names
- Any character visible (even hand/silhouette) or speaking off-screen → include their ID
- Named location → must have setting ID. Use null only for abstract/unnamed spaces.

## Descriptions

- What a camera physically sees AND hears in this moment
- Be specific: not "they interact" but "she extends a trembling hand toward the handle"
- **Every shot must include a sound cue**: ambient, action sound, body sound, dialogue, or explicit silence ("dead silence — not a sound")

## Camera Work

- Every shot needs specific direction: angle, movement, framing, depth of field
- Not just "medium shot" — describe behavior: "static medium, slight push-in as tension builds"

## Insert Shots (REQUIRED)

- At least one shot with `"characters": []` — environment, object, atmosphere, or time marker
- Default: shot 1 as establishing, or before the climactic moment

## Faithfulness

- Do not invent moments, locations, or actions the scene doesn't describe
- After writing, verify: does any shot describe something not in the scene? Remove it.

## Pre-Output Check

1. Every scene beat has a shot
2. Duration sum = totalDuration
3. At least one `"characters": []` shot
4. Every shot has a sound cue
5. All character IDs match the provided list exactly

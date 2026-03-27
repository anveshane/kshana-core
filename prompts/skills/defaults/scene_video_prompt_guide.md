**PURPOSE**: Break a scene description into individual cinematic shots for video generation. Each shot will become a separate image + video clip, so every shot must be self-contained and visually specific.

---

## Rules

### Scene Faithfulness (CRITICAL — SCENE_FAITHFUL)
- Every key action, event, dialogue moment, and emotional beat from the scene description MUST appear in at least one shot
- Do not skip or compress significant moments — if the scene describes it, a shot must show it
- **Do NOT invent moments, locations, or states that the scene does not describe.** If the scene opens with characters already present, do not fabricate a moment where the room is empty. If the scene does not mention a character leaving, do not show them leaving.
- If the scene ends with a transition (walking out, cut to black), include that as the final shot
- **Before writing shots, list every distinct beat in the scene.** After writing shots, cross-check: each beat must map to at least one shot. If any beat is missing, add a shot for it.
- Pay special attention to: dialogue lines (each significant line needs a shot), reactions (if the scene says a character reacts, show it), and scene-ending actions
- Do NOT merge two distinct beats into one shot unless they are truly simultaneous — when in doubt, give each beat its own shot
- **After writing shots, re-read the scene description and verify**: Does any shot describe something the scene never mentioned? If so, remove or rewrite that shot to match the source material exactly.

### Character & Setting IDs (CRITICAL — CHARACTER_IDS)
- characters array MUST use ONLY the exact item IDs provided in the input — no variations, no full names, no nicknames, no invented IDs
- **Before outputting, verify every character ID in your JSON exists verbatim in the provided character list.** If you wrote an ID that isn't in the input, replace it with the correct one.
- If a character is visible in a shot — even partially (hand, silhouette, reflection, back of head) — include their ID
- If a character is speaking off-screen in a shot, include their ID
- If multiple characters are in a scene together and a wide shot captures the space, include ALL characters who would be visible
- **Common mistake**: Using a character's name or a variation instead of their assigned ID. The ID might be `char_01` or `merchant` or `ada` — use exactly what was provided, character for character.
- setting MUST use ONLY the exact item IDs provided, or null only for abstract/unnamed locations
- If a shot takes place in a named location, it MUST have a setting ID

### Shot Structure
- Each shot must have: shotNumber, shotType, duration, description, cameraWork, characters, setting
- Each shot should be 3–10 seconds
- Use at least 3 different shot types — vary for cinematic interest

### Duration Arithmetic (CRITICAL)
- Set `totalDuration` to match the scene's target duration
- After writing all shots, **add up every shot's duration** and verify the sum equals `totalDuration` exactly
- If the sum is wrong, adjust shot durations before outputting
- Example: totalDuration=20, shots=[5s, 4s, 6s, 5s] → 5+4+6+5=20 ✓
- Example: totalDuration=20, shots=[5s, 4s, 3s, 4s] → 5+4+3+4=16 ✗ (6 seconds missing!)
- **This is a hard constraint — a mismatch is a failure**

### Shot Descriptions
- Describe what a camera physically sees in this frozen or moving moment
- Be specific: not "they interact" but "she extends a trembling hand toward the door handle"
- Include physical details: lighting, textures, spatial relationships, movement
- Reference character appearance where relevant for visual consistency

### Camera Work
- Every shot MUST have a specific cameraWork description
- Include: camera angle (low, high, eye-level), movement (static, pan, track, dolly, handheld), framing, depth of field
- Not just "medium shot" — describe the camera's behavior: "static medium shot, slight push-in as tension builds"

### Sound & Audio Cues (CRITICAL — SOUND_CUES)
- **EVERY shot description MUST include at least one specific sound or audio cue.** This is not optional — a shot without sound is incomplete.
- Place the audio cue as a distinct sentence in the description. Use a pattern like:
  - "The [sound] fills the air." / "The only sound is [X]." / "[Sound] echoes through the space."
  - For silence: "The room is dead silent — not a sound." / "Absolute stillness; the silence is oppressive."
  - For dialogue: "She speaks, her voice barely above a whisper: '...'" / "His words cut through the quiet."
- **Types of sound to include** (pick at least one per shot):
  - **Ambient**: wind, rain, traffic hum, fluorescent buzz, clock ticking, air conditioning drone
  - **Action-driven**: footsteps, scrubbing, fabric rustling, a door creaking, keys jangling, cutlery clinking
  - **Body sounds**: breathing (shallow, heavy, held), heartbeat, a sharp inhale, swallowing
  - **Dialogue/vocal**: whispered words, a gasp, a sigh, muttering, laughter
  - **Deliberate silence**: when silence IS the sound — state it explicitly
- **After writing all shots, scan every description for audio.** If any shot lacks a sound/audio cue, add one before outputting. A shot that only describes visuals is a failure.
- Example — WRONG: "She stares at the letter on the table, hands trembling."
- Example — RIGHT: "She stares at the letter on the table, hands trembling. The only sound is the faint tick of the wall clock and her uneven breathing."

### Insert & Establishing Shots (REQUIRED)
- At least one shot MUST have `"characters": []` — a purely character-free shot
- This is not optional. Every scene needs at least one of:
  - **Object insert**: a close-up of a key object — a dripping tap, blood on fabric, a phone screen, a clock face
  - **Atmosphere**: dust in light, steam rising, rain on glass, shadows on a wall
  - **Time marker**: sunrise, a clock, shadows shifting
  - **Environment detail**: an empty hallway, a window view, ceiling lights flickering
- **IMPORTANT**: The insert shot must depict something that exists in or is consistent with the scene. Do NOT invent a scene state (like an empty room) that contradicts the scene description. Instead, use an object close-up, environmental detail, or atmospheric moment that is faithful to the scene.
- Good placement: just before a climactic moment as a tension beat, or between two intense character shots as breathing room
- These create pacing variety between character moments

### Emotional Arc
- Shots should build a progression — the mood at the end differs from the beginning
- Vary intensity: not every shot should be at the same emotional pitch
- Use shot type to reinforce emotion: wide shots for isolation, close-ups for intimacy/tension

### Flow & Continuity
- Shots must flow logically — a viewer watching them in sequence should understand the scene
- If a character moves between locations, show the transition
- Don't jump between incompatible compositions without motivation

---

## Pre-Output Checklist

Before finalizing your JSON, verify each of these. **Do not skip any step — a single missed check causes a failure.**

1. **Scene faithfulness** — Re-read the original scene description. List every action, dialogue moment, reaction, and event. Confirm each one appears in at least one shot. Then check the reverse: does any shot describe something NOT in the scene? If a shot invents a moment, location state, or action not present in the source, rewrite it.
2. **Character IDs** — For every `characters` array in your output, confirm each ID is an exact match to an ID from the provided character list. If you used a name or variant instead of the actual ID, fix it now.
3. **Duration sum** — Add up all shot durations. Does the total equal `totalDuration`? If not, fix it.
4. **Insert shot** — Is there at least one shot with `"characters": []`? If not, add one — but make sure it depicts something from the scene, not an invented moment.
5. **Sound cues (EVERY shot)** — Go through each shot one by one. Does the description mention what is heard? Count the shots with audio and the shots without. If ANY shot lacks a sound/audio cue, add one now. The minimum is every shot, not half.
6. **No empty characters when visible** — If a character is on screen or speaking, their ID must be in the array.
**PURPOSE**: Break a scene description into individual cinematic shots for video generation. Each shot will become a separate image + video clip, so every shot must be self-contained and visually specific.

---

## Rules

### Scene Coverage
- Every key action, event, dialogue moment, and emotional beat from the scene description MUST appear in at least one shot
- Do not skip or compress significant moments — if the scene describes it, a shot must show it
- If the scene ends with a transition (walking out, cut to black), include that as the final shot

### Shot Structure
- Each shot must have: shotNumber, shotType, duration, description, cameraWork, characters, setting
- Each shot should be 3-10 seconds
- Use at least 3 different shot types — vary for cinematic interest

### Duration Arithmetic (CRITICAL)
- Set `totalDuration` to match the scene's target duration
- After writing all shots, **add up every shot's duration** and verify the sum equals `totalDuration` exactly
- If the sum is wrong, adjust shot durations before outputting
- Example: totalDuration=20, shots=[5s, 4s, 6s, 5s] → 5+4+6+5=20 ✓
- Example: totalDuration=20, shots=[5s, 4s, 3s, 4s] → 5+4+3+4=16 ✗ (6 seconds missing!)
- **This is a hard constraint — a mismatch is a failure**

### Character & Setting IDs
- characters array MUST use ONLY the exact item IDs provided — no variations, no full names
- If a character is visible in a shot (even just their hand or silhouette), include their ID
- setting MUST use ONLY the exact item IDs provided, or null only for abstract/unnamed locations
- If a shot takes place in a named location, it MUST have a setting ID

### Shot Descriptions
- Describe what a camera physically sees in this frozen or moving moment
- Be specific: not "they interact" but "she extends a trembling hand toward the door handle"
- Include physical details: lighting, textures, spatial relationships, movement
- Reference character appearance where relevant for visual consistency

### Camera Work
- Every shot MUST have a specific cameraWork description
- Include: camera angle (low, high, eye-level), movement (static, pan, track, dolly, handheld), framing, depth of field
- Not just "medium shot" — describe the camera's behavior: "static medium shot, slight push-in as tension builds"

### Sound & Audio Cues
- Every shot description MUST include what is HEARD, not just what is seen
- Prefix audio cues in the description: "The hiss of hydraulics fills the air", "Dead silence", "Footsteps echo on tile"
- If a shot has dialogue, mention it: "She speaks — her voice is barely above a whisper"
- If a shot is intentionally silent, state it explicitly: "Absolute silence"
- Sound sells the moment — a dripping tap, wind, breathing, fabric rustling, a distant siren

### Insert & Establishing Shots (REQUIRED)
- At least one shot MUST have `"characters": []` — a purely character-free shot
- This is not optional. Every scene needs at least one of:
  - **Environment establishing**: the room before anyone enters, an exterior wide
  - **Object insert**: a scanner on the floor, a dripping tap, blood on fabric
  - **Atmosphere**: dust in light, steam rising, rain on glass
  - **Time marker**: sunrise, a clock, shadows shifting
- Default placement: shot 1 as an establishing shot, or just before the climactic moment as a tension beat
- These create breathing room between intense character moments

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

Before finalizing your JSON, verify:
1. **Duration sum** — Add up all shot durations. Does the total equal `totalDuration`? If not, fix it.
2. **Insert shot** — Is there at least one shot with `"characters": []`? If not, add one.
3. **Sound cues** — Does every shot description mention what is heard? If not, add audio.
4. **Character IDs** — Every shot showing a character has their exact ID in the array? No empty arrays when characters are visible?

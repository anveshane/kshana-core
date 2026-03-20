**PURPOSE**: Compose characters and settings into a single frozen image. Reference images supply visual consistency — your prompt supplies composition, action, placement, and lighting.

## Reading Your Input

The scene description, character profiles, and setting profiles follow this guide in the user message. Read them carefully before writing anything:
- **Scene description**: the narrative moment to capture — every character and setting mentioned must appear
- **Character profiles**: each character's `referenceImagePath` (if `"exists"`, use it as an image reference)
- **Setting profiles**: each setting's `referenceImagePath` (if `"exists"`, use it as an image reference)

---

## Step 1 — Make Two Checklists Before Writing

**Character checklist:** List every character named in the scene description, including secondary characters, background figures, crowds, and groups. Every entry on this list must appear in your prompt.

**Setting checklist:** Identify the specific location named in the scene description. Use that exact location. If a character profile has no reference image, describe their appearance. If a setting profile has no reference image, describe the environment.

Do not proceed to writing until both checklists are complete.

---

## Step 2 — Check for Reference Images

For each character and setting in your checklists:
- If `referenceImagePath` = `"exists"` → it has a reference image
- If `referenceImagePath` is absent, null, or not `"exists"` → it has NO reference image

**CRITICAL:** Only reference images that actually exist as `"exists"` in the profiles. Never write `image N` for a character or setting that does not have a confirmed reference image. Doing so will break the output.

**Image ordering rule (when references exist):** Assign numbers in the order you list them: first listed = `image 1`, second = `image 2`, etc. Every reference image must be cited using `image N` (space before the number) somewhere in the prose.

---

## Step 3 — Write the Prompt

**Use the scene's actual setting.** If the scene is in a kitchen, the prompt is in a kitchen. If the scene is in a ruined city, the prompt is in that ruined city. Never substitute a neutral studio, abstract background, or invented location.

**Place every character.** For each character on your checklist: state their physical pose, and place them spatially — relative to the environment or relative to other characters. A character mentioned but not placed and posed is an error.

### Writing Order (30-80 words when references exist, 80-120 words when no references exist)

Follow this order:

1. **Shot type + main character pose** — framing and how the character is positioned
2. **Setting placement** — where in the specific environment; where each character stands relative to the space and each other
3. **Lighting** — source, direction, quality, temperature
4. **Mood/style** — one sentence max

---

## The Five Hard Rules

### Rule 1 — Frozen Instant Only

Your prompt describes one single frame — one click of the shutter. Every verb must describe a static state, not an ongoing action or movement.

**After writing, scan every verb in your prompt.** For each verb, ask: "Does this describe movement or process?" If yes, convert it.

Conversion table:
- "organizing" → "arms spread in a directing gesture"
- "walking toward" → "mid-stride, weight on left foot"
- "reaching" → "arm extended toward"
- "streams through" → "falling in ribbons through" — NO. Use: "light entering through the window in thick bands"
- "float" → "suspended"
- "strokes" → "resting against"
- "rises" → "suspended above" or cut it
- "drifting" → "suspended"
- "flows" → "draped" or "spread flat"
- "begins to" → find the end state and describe that instead
- "makes her way" → "positioned halfway across"

**Bad:** "organizing a small group", "streams through", "float like tiny stars", "thumb strokes the fabric", "steam rises", "slowly turns", "drifting past"
**Good:** "arms spread in a directing gesture toward the group", "light entering through the window in thick bands", "dust motes suspended in the air", "his thumb resting against the fabric", "steam suspended above cooling loaves"

If an action implies continuous movement, ask: what does the body look like at the midpoint of that action? Describe that static position.

### Rule 2 — No Narrative Commentary

Describe only what a camera captures: shapes, light, position, gesture. The camera cannot capture meaning, emotion, internal states, or significance.

**After writing, scan every phrase for feeling words or significance language.** If a phrase names a feeling, names what something "conveys," or interprets what something "means," either replace it with a visible physical detail or delete it entirely.

**Bad:** "gesture of quiet awe", "contemplative and still", "suspended moment of wonder", "the weight of the unsolved case bearing down", "decades of quiet labor etched into his features", "the scene conveys desolation", "focused intensity", "a sense of quiet intimacy"
**Good:** "his gaze fixed on a point past the camera", "her shoulders drawn inward", "his hands rest in his lap, flour-dusted", "jaw set, eyes directed at the evacuation route"

Replace every emotional label with the physical detail that produces it. "Grief" → "head bowed, hands clasped tight in the lap." "Wonder" → "eyes wide, mouth slightly open." If no physical detail exists, cut the phrase.

### Rule 3 — No Re-Describing References

Do not repeat character appearance details already supplied by a reference image. Do not describe a setting's architecture or textures if a reference image provides them.

**Bad:** "the woman with sharp angular features and dark eyes from image 1", "the ruined metropolis with skeletal skyscrapers from image 2", "Rowan in his NYPD uniform from image 1"
**Good:** "the woman from image 1", "the cityscape from image 2", "Rowan from image 1"

### Rule 4 — Lighting Is Mandatory

Every prompt must specify light source, direction, and quality. Vague phrases like "good lighting", "atmospheric light", or "directional lighting" are not allowed.

**Good:** "warm overhead lamp casts a pool of light on the desk, her face half-lit from above", "cool blue natural light entering from a window camera-left, soft diffused shadows", "harsh midday sun directly overhead, deep shadows pooling under the brow and chin"

### Rule 5 — Every Character Gets a Pose and Position

For each character in your checklist: name their physical pose, and place them spatially relative to the environment or other characters.

**Bad:** mentioning a character by name only, or describing setting without stating where each character stands
**Good:** "the elder from image 2 stands to her left, arms at her sides, facing away from camera"; "Mrs. Singh stands at the counter to Parvati's right, back to the stove, shoulders rigid"

---

## Examples

### Good example (with references)

```
A medium shot of the woman from image 1 seated at a desk in the office from image 2, leaning forward with her chin resting on clasped hands. Papers spread before her, a coffee cup at the desk edge. Her partner from image 3 stands behind her to the right, arms crossed, gaze directed at the window. Warm overhead lamp creates a pool of light on the desk surface, her face half-lit from above, deep shadows below the brow. Cool blue ambient light from the window behind. Cinematic, shallow depth of field.
```

### Good example (no references — full descriptions required)

```
A wide shot of a cramped Indian kitchen at dawn. Parvati, a woman in her early 30s in a dark green sari, kneels beside the stove in the foreground, one hand pressed flat against the tiled floor. Mrs. Singh, an older woman in a white cotton kurta, stands at the counter behind her to the right, shoulders rigid, gaze fixed downward on Parvati. Copper pots hang on the wall behind Mrs. Singh. Pale blue pre-dawn light entering from a small window at upper left, casting long cool shadows across the floor. One warm tungsten bulb above the counter illuminates Mrs. Singh's profile.
```

### Bad example (motion verbs, narrative commentary, wrong setting, re-description)

```
❌ The weary detective from image 1 slowly makes her way across the dimly lit office from image 2, her exhaustion evident in every step, the weight of the unsolved case bearing down. Her sharp angular features catch the light as she turns toward the filing cabinets. Suspended memories fill the room.
```

Why it fails:
- "makes her way" — ongoing motion
- "exhaustion evident in every step" — narrative commentary (invisible internal state)
- "the weight of the unsolved case bearing down" — narrative commentary
- "sharp angular features" — re-describing a reference image
- "turns toward" — motion verb
- "Suspended memories" — narrative commentary

**Output format:**
```
**Image Prompt:**
[30-80 words when references exist; 80-120 words when no references exist — shot type, character pose/position, spatial placement, lighting, mood]

**Reference Images:**
- Character: [name]
- Setting: [name]

**Negative Prompt:**
[Brief, style-appropriate — 10-15 words max]

**Aspect Ratio:**
16:9

**Generation Mode:**
image_text_to_image
```

---

## When NO Reference Images Exist

No reference provides appearance, so describe everything visually:
- Each character's physical appearance (age, clothing, build), exact pose, and placement relative to others
- The setting's specific architecture, atmosphere, and textures
- Apply all five rules above — frozen instant, no narrative commentary, no vague lighting, every character placed

**Use the scene's actual setting.** Do not default to a neutral studio or abstract background.

**Generation Mode for text-only:** `text_to_image`
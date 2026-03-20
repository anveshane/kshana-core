**PURPOSE**: Compose characters and settings into a single frozen image prompt. Reference images supply visual consistency — your prompt supplies composition, pose, placement, and lighting.

## Reading Your Input

The scene description, character profiles, and setting profiles follow this guide in the user message. Read them carefully before writing:
- **Scene description**: the narrative moment to capture — every character and setting mentioned must appear
- **Character profiles**: each character's `referenceImagePath` field tells you whether a reference image exists
- **Setting profiles**: each setting's `referenceImagePath` field tells you whether a reference image exists

---

## What Your Prompt Must Contain

Your prompt must include ALL of the following — treat this as a checklist to verify before finalizing:

1. **Every character named in the scene description** — including secondary characters, background figures, and ensemble groups like "villagers" or "children." No character may be omitted.
2. **The specific setting** named in the scene description — not a generic background.
3. **A pose and spatial placement for every character** — where they stand or sit, what their body is doing, where their gaze is directed. This applies to EVERY character including background and ensemble figures.
4. **Explicit spatial relationships** — name who is in the foreground, mid-ground, background; who is left, right, near, far. Do not leave any character's position unspecified.
5. **Lighting** — light source, direction, quality, and temperature (see Rule 4 below).

---

## SPATIAL PLACEMENT IS MANDATORY

This is the most common failure point. For every single character — including crowd members, children, villagers, and background figures — you must state:
- **Where they are** in the frame (foreground, mid-ground, background; left, right, center)
- **What their body is doing** (standing, crouched, seated, arms extended, etc.)
- **Where their gaze is directed**

For ensemble groups: "a cluster of villagers in the mid-ground — three crouched over crops, two children seated at the field edge to the left" is acceptable. Never leave an ensemble character without any positional description.

**BAD:** "Rowan directs fleeing civilians" — civilians have no position, no pose, no placement
**GOOD:** "Rowan from image 1 stands at the top of the subway steps in the foreground, arms spread in a directing gesture. Thirty meters behind him in the mid-ground, civilians — men and women in office clothes — stream left across the frame, hunched forward."

---

## Reference Image Rules

For each character and setting, check their `referenceImagePath`:
- If `referenceImagePath` = `"exists"` → cite this entity as `image N` in your prompt
- If `referenceImagePath` is absent, null, or anything other than `"exists"` → **do NOT write `image N`** — describe their appearance in full prose instead

**CRITICAL — Never fabricate image citations.** Only write `image N` when you can point to a `referenceImagePath: "exists"` in the profile. When in doubt: describe in prose.

**Image numbering:** Assign numbers in the order entities appear in the profiles: first = `image 1`, second = `image 2`, etc. Every confirmed reference image must be cited using `image N` somewhere in the prose.

---

## Two Modes

### Mode A: References Exist (30-80 words)

Cite each confirmed reference image as `image N`. Do NOT re-describe the appearance of referenced entities — the reference provides that. Write only composition, pose, placement, and lighting.

### Mode B: No Reference Images (80-120 words)

No reference provides visual details, so you must describe everything:
- Each character's physical appearance (age, build, clothing), exact pose, and spatial placement
- The setting's specific architecture, textures, and atmosphere

---

## The Five Hard Rules

### Rule 1 — Frozen Instant Only

Your prompt describes one single frame — one click of the shutter. Every verb must describe a static state, not ongoing motion.

Scan every verb. For each verb, ask: "Does this describe movement or process?" If yes, convert it.

Conversion table:
- "organizing" → "arms spread in a directing gesture"
- "walking toward" → "mid-stride, weight on left foot"
- "reaching" → "arm extended toward"
- "streams through" → "light entering through the window in thick bands"
- "float" → "suspended"
- "strokes" → "resting against"
- "rises" → "suspended above"
- "drifting" → "suspended"
- "flows" → "draped" or "spread flat"
- "begins to" → find the end state and describe that instead
- "makes her way" → "positioned halfway across"

**Bad:** "organizing a small group", "streams through", "float like tiny stars", "slowly turns"
**Good:** "arms spread in a directing gesture toward the group", "light entering through the window in thick bands", "dust motes suspended in the air"

If an action implies continuous movement, ask: what does the body look like at the midpoint of that action? Describe that static position.

### Rule 2 — No Narrative Commentary

Describe only what a camera captures: shapes, light, position, gesture. The camera cannot capture meaning, emotion, internal states, or significance.

Scan every phrase for feeling words or significance language. Replace with a visible physical detail or delete entirely.

**Bad:** "gesture of quiet awe", "contemplative and still", "the weight of the unsolved case bearing down", "focused intensity", "a sense of quiet intimacy"
**Good:** "his gaze fixed on a point past the camera", "her shoulders drawn inward", "his hands rest in his lap, flour-dusted", "jaw set, eyes directed at the evacuation route"

Replace every emotional label with the physical detail that produces it. "Grief" → "head bowed, hands clasped tight in the lap." "Wonder" → "eyes wide, mouth slightly open." If no physical detail exists, cut the phrase.

### Rule 3 — No Re-Describing References

Do not repeat character appearance details already supplied by a reference image. Do not describe a setting's architecture or textures if a reference image provides them.

**Bad:** "the woman with sharp angular features and dark eyes from image 1", "Rowan in his NYPD uniform from image 1"
**Good:** "the woman from image 1", "Rowan from image 1"

### Rule 4 — Lighting Is Mandatory

Every prompt must specify light source, direction, and quality. Vague phrases like "good lighting", "atmospheric light", or "directional lighting" are not allowed.

**Good:** "warm overhead lamp casts a pool of light on the desk, her face half-lit from above"; "cool blue natural light entering from a window camera-left, soft diffused shadows"; "harsh midday sun directly overhead, deep shadows pooling under the brow and chin"

### Rule 5 — Every Character Gets a Pose and Position

For each character: state their physical pose, and place them spatially relative to the environment or other characters.

**Bad:** mentioning a character by name only, or describing the setting without stating where each character stands
**Good:** "the elder from image 2 stands to her left, arms at her sides, facing away from camera"; "Mrs. Singh stands at the counter to Parvati's right, back to the stove, shoulders rigid"

For ensemble characters (crowds, villagers, children): describe the group's position and composition even if briefly — "a cluster of villagers in the mid-ground, several crouched over crops, two children seated at the field edge."

---

## Examples

### Good example (Mode A — references exist)

```
A medium shot of the woman from image 1 seated at a desk in the office from image 2, leaning forward with her chin resting on clasped hands. Papers spread before her, a coffee cup at the desk edge. Her partner from image 3 stands behind her to the right, arms crossed, gaze directed at the window. Warm overhead lamp creates a pool of light on the desk surface, her face half-lit from above, deep shadows below the brow. Cool blue ambient light from the window behind. Cinematic, shallow depth of field.
```

### Good example (Mode A — action scene with ensemble)

```
A wide shot of Rowan from image 1 at the top of the subway steps in the foreground, arms spread in a directing gesture, jaw set, gaze fixed left down the avenue. Behind him, thirty meters into the mid-ground, a mass of civilians — suits, bags, hunched shoulders — pressed rightward across the frame. Above, the ships from image 2 hang motionless against the orange sky, geometric shadows falling across the street below. Cool blue emergency light from the subway entrance at Rowan's feet, warm orange firelight reflecting off the pavement behind him.
```

### Good example (Mode B — no references, full descriptions required)

```
A wide shot of a cramped Indian kitchen at dawn. Parvati, a woman in her early 30s in a dark green sari, kneels beside the stove in the foreground, one hand pressed flat against the tiled floor, gaze downward. Mrs. Singh, an older woman in a white cotton kurta, stands at the counter to the right in the mid-ground, shoulders rigid, gaze fixed downward on Parvati. Copper pots hang on the wall behind Mrs. Singh. Pale blue pre-dawn light entering from a small window at upper left, casting long cool shadows across the floor. One warm tungsten bulb above the counter illuminates Mrs. Singh's profile.
```

### Good example (Mode B — scene with ensemble characters)

```
A wide establishing shot of a sun-baked village field at midday. The young girl, twelve years old in a faded yellow dress, stands at the field's near edge in the foreground, arms at her sides, gaze directed toward the distant tree line. Behind her in the mid-ground, a dozen villagers distributed across the field — three adults crouched low over rows of crops, Elder Mara standing upright with arms crossed watching the girl. Four children seated in a loose cluster at the far left edge, legs folded. Hard white overhead sun casts short dense shadows directly beneath each figure, the soil bleached pale in the open spaces.
```

### Bad example (hallucinated references, motion verbs, narrative commentary)

```
❌ The weary detective from image 1 slowly makes her way across the dimly lit office from image 3, her exhaustion evident in every step, the weight of the unsolved case bearing down. Her sharp angular features catch the light as she turns toward the filing cabinets.
```

Why it fails:
- `image 1` and `image 3` cited — if these profiles have no `referenceImagePath: "exists"`, these are hallucinated references
- "makes her way" — ongoing motion
- "exhaustion evident in every step" — narrative commentary
- "the weight of the unsolved case bearing down" — narrative commentary
- "sharp angular features" — re-describing a reference character
- "turns toward" — motion verb

**Output format:**
```
**Image Prompt:**
[Mode A: 30-80 words — shot type, character pose/position, spatial placement, lighting, mood]
[Mode B: 80-120 words — same, plus full appearance descriptions for all characters and setting]

**Reference Images:**
- Character: [name] — image N
- Setting: [name] — image N
[If no references exist, write: None]

**Negative Prompt:**
[Brief, style-appropriate — 10-15 words max]

**Aspect Ratio:**
16:9

**Generation Mode:**
image_text_to_image
```

---

## When NO Reference Images Exist

When all `referenceImagePath` fields are absent or not `"exists"`, use Mode B. Do NOT write any `image N` citations.

Describe in full:
- Each character's physical appearance (age, clothing, build), exact pose, and placement relative to others and the environment
- The setting's specific architecture, atmosphere, and textures

Apply all five rules. Use the scene's actual setting — never default to a neutral studio or abstract background.

**Generation Mode for text-only:** `text_to_image`
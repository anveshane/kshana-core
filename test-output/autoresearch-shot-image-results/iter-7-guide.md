**PURPOSE**: Write one image prompt paragraph for a specific shot within a multi-shot scene. The prompt will be fed directly to an image generation model.

---

## Step Zero: Read the Motion JSON for THIS Shot

Before writing anything, extract from the motion JSON for this specific shot:

1. **Which reference images are listed as available for this shot** — these are the ONLY images you may reference
2. **Which characters appear in this shot** — if a character is not listed in this shot's JSON, they DO NOT appear in this prompt
3. **What is the specific visual event happening right now** — this is the narrative beat you must depict
4. **What is the shot type** — this determines framing and depth of field

Characters and images from other shots in the same scene DO NOT transfer to this shot. Each shot is isolated.

---

## Reference Image Rule

**Only reference images that are explicitly listed as available for this specific shot.**

- Reference each available image using "from image N" phrasing (e.g., "the character from image 1", "the environment from image 2").
- Every available image MUST appear in the prompt paragraph. If image 2 is available, "image 2" must appear in the prose.
- If only 1 image is listed, reference only "image 1". Never invent image numbers not provided.
- If a character image is available but that character does not appear in this specific shot, do not reference that image.
- If no reference images are available, use `text_to_image` mode with no "from imageN" references.

**Do not reference image numbers that are not explicitly listed as available for this shot. Inventing image numbers that don't exist is a critical error.**

---

## Shot Composition Rules

The shot type from the motion JSON determines framing, camera position, and depth of field. These must appear as explicit words in the prompt paragraph.

| Shot Type | Composition | Depth of Field |
|-----------|-------------|----------------|
| **extreme_wide** | Vast environment, character tiny or absent, establishes scale | Deep focus — full environment sharp |
| **wide / establishing** | Full environment with characters head-to-toe | Deep focus — foreground and background both sharp |
| **medium_wide** | Character from knees up, some environment visible | Moderate — subject sharp, background slightly soft |
| **medium** | Waist-up of character(s), conversational distance | Moderate shallow — subject sharp, background softly blurred |
| **medium_close_up** | Chest and head, captures expression and gesture | Shallow — subject sharp, background blurred |
| **close_up** | Face fills the frame — face is the primary subject | Shallow — face razor-sharp, background strongly blurred |
| **extreme_close_up** | Single feature (eyes, hands, object) fills frame | Very shallow — only the feature in focus |
| **low_angle** | Camera looking up at subject — appears powerful, dominant | Varies |
| **high_angle** | Camera looking down at subject — appears smaller, vulnerable | Varies |
| **dutch_angle** | Tilted frame, creates unease and tension | Varies |
| **birds_eye** | Directly above, unusual perspective, abstract feel | Deep focus |
| **reaction** | Character responding — focus on facial expression and body language | Shallow — face sharp |
| **over_the_shoulder** | From behind one character looking at another; foreground character blurred | Shallow — far character sharp, near character blurred |
| **two_shot** | Two characters in frame together, showing spatial relationship | Moderate |
| **pov** | What a character sees, subjective perspective | Varies by what they're seeing |
| **insert** | Detail shot of object or action (hands, letter, clock) | Very shallow |
| **cutaway** | Brief shot of related element outside the main action | Varies |
| **tracking** | Camera follows moving subject, dynamic composition | Moderate shallow |

Rules:
- A wide or establishing shot uses deep focus and is dominated by the ENVIRONMENT. Characters in wide shots are small figures within the landscape, not central subjects. Do not write wide-shot prompts that center a named character's actions.
- A close-up means the face fills the frame. Do not describe the character standing in a vast environment.
- State depth of field explicitly in the prose every time.
- If the motion JSON specifies a camera angle (low angle, dutch tilt, high angle), include it in the prose.

---

## Story Faithfulness Rules

The scene description and the motion JSON for this specific shot are ground truth. The prompt must depict what literally happens at this moment in this shot — not what happens in adjacent shots.

**Before writing, answer these questions from the motion JSON:**
- What is happening in THIS shot specifically?
- Who is present in THIS shot specifically?
- What is the time of day, weather, and environment described for THIS shot?

Then write only what those answers contain.

- If the scene says golden particles: write golden particles — not "panic" or "fear."
- If the scene says daytime: use daytime — do not introduce rain, night, or storm.
- If a character is reaching out: show them reaching — do not show arms crossed.
- If something is transforming, dissolving, erupting, or colliding — that transformation IS the shot. Depict it directly.
- If someone is reacting — to what? Name the cause. That reaction IS the shot.
- If a wide shot's beat is ships appearing in the sky, the prompt must show that environmental event — do not substitute a character's command action from a later shot.

Only include locations, characters, objects, and atmosphere described in this scene and this specific shot. Do not import elements from other shots.

If a character appears in this shot but needs an appearance change from their reference image (different clothing, injuries, different emotional state), describe those changes explicitly.

---

## Lighting Rules

Lighting must appear inside the prompt paragraph. Include all four components:

1. **Source**: natural sunlight, overcast sky, practical lamp, alien energy glow, streetlights, fire
2. **Direction**: overhead, camera-left, from behind (rim), from below
3. **Quality**: harsh/hard (sharp shadows), soft/diffused (gentle gradients), dappled
4. **Temperature**: warm golden, cool blue, neutral white, sickly green

Do not write "dramatic lighting" or "cinematic lighting" — name the actual source and direction.

Match lighting to what the scene describes. Do not add atmospheric elements the scene does not include.

---

## Prompt Construction

Write a single flowing prose paragraph. Do not use bullet points, numbered steps, or keyword lists.

The paragraph must contain, in order:
1. The main subject and the specific visual action happening right now in this shot
2. The setting and spatial relationships
3. Shot framing, camera angle, and depth of field (explicit words from the shot type table)
4. "from image N" references for every available image
5. Lighting with source, direction, quality, and temperature
6. Mood or atmosphere

Example structure: "A wide establishing shot of [environment from image 2], deep focus with foreground and background both sharp, showing [characters from image 1] [specific action at its peak]. [Lighting]. [Mood]."

Before writing, identify: what is the single most dramatic visual event in this shot? Lead with that.

---

**Output format:**
```
**Image Prompt:**
[Single detailed paragraph matching the shot's framing. Reference characters/settings with "from imageN" phrasing only for images explicitly listed as available. Lead with subject and action, then setting, then lighting, then mood. Write flowing prose — not comma-separated keywords.]

**Reference Images:**
- Character: [name] (only if in this shot and listed as available)
- Setting: [name] (only if in this shot and listed as available)

**Negative Prompt:**
[Style-appropriate negatives + inconsistent appearance, wrong features. Never negate elements that the scene description requires.]

**Aspect Ratio:**
1:1

**Generation Mode:**
image_text_to_image
```

If NO reference images are available (documentary/non-narrative), use `text_to_image` mode with no "from imageN" references.
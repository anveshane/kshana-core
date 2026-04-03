**PURPOSE**: Write one image prompt paragraph for a specific shot within a multi-shot scene. The prompt will be fed directly to an image generation model.

---

## Step Zero: Extract These Four Facts From the Motion JSON

Before writing a single word of the prompt, extract and write down:

1. **The referenceImages list for THIS shot** — the exact image numbers listed (e.g., image 1, image 2). These are the ONLY images you may reference. Image numbers not in this list DO NOT EXIST for this shot.
2. **The characters present in THIS shot** — only characters named here appear in the prompt.
3. **The peak visual event** — what is the single most dramatic, specific thing happening RIGHT NOW in this shot? Not before, not after. Not "ships arrive" if the shot shows beams firing. Not "character reacts" if the shot shows their face dissolving into shock at a specific cause.
4. **The shot type** — determines framing, depth of field, and what fills the frame.

---

## Reference Image Rule — Hard Constraint

**You may only reference images explicitly listed as available for THIS specific shot.**

- Reference each available image using "from image N" phrasing (e.g., "the character from image 1", "the environment from image 2").
- Every image in the shot's referenceImages list MUST appear somewhere in the prompt paragraph.
- If image 3 is not in this shot's referenceImages list, you CANNOT write "from image 3". Not even if you saw that image referenced elsewhere. Not even if the setting seems to match.
- If a character image is available but that character does not appear in this specific shot, do not reference that image.
- If no reference images are listed, use `text_to_image` mode with no "from imageN" references.

**Fabricating image numbers is a critical error. If you write "from image 4" and image 4 is not in this shot's list, the prompt is wrong.**

---

## Shot Composition Rules

The shot type from the motion JSON determines framing, camera position, and depth of field. State these explicitly in the prompt paragraph.

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

## Story Faithfulness Rules — Read the Scene Literally

The scene description and the motion JSON for this specific shot are the only source of truth. Copy details from the text. Do not interpret, embellish, or fill gaps with assumptions.

**The failure mode is inventing details that aren't there.** Examples of what NOT to do:
- The scene says "perfectly normal Manhattan morning" → do NOT write "gray afternoon sky"
- The scene says "civilians dissolve into golden particles" → do NOT write "golden particles swirl around the ships" — the particles come FROM people, not from ships
- The scene says "silver-white beams fire down" → do NOT describe only ships arriving and omit the beams

**Before writing, answer these questions from the source material only:**
- What is the single peak action or event in THIS shot? (Not the whole scene — this shot specifically.)
- Who is physically present and what are they doing at this exact moment?
- What is the time of day, weather, and environment described for THIS shot?
- What causes the reaction or event? Name it specifically.

Then write only what those answers contain.

- If the scene says golden particles: write golden particles — not "panic" or "fear."
- If the scene says daytime: use daytime — do not introduce rain, night, or storm.
- If a character is reaching out: show them reaching — do not show arms crossed.
- If something is transforming, dissolving, erupting, or colliding — that transformation IS the shot. Depict it directly and specifically.
- If someone is reacting — to what? Name the cause explicitly. "Her face frozen in horror as silver-white beams lance down into the crowd below" is correct. "Her face frozen in horror" is incomplete.

Only include locations, characters, objects, and atmosphere described in this scene and this specific shot. Do not import elements from other shots.

If a character appears in this shot but needs an appearance change from their reference image (different clothing, injuries, different emotional state), describe those changes explicitly.

---

## Lighting Rules — All Four Components Required

Lighting must appear inside the prompt paragraph. You must include all four:

1. **Source**: natural sunlight, overcast sky, practical lamp, alien energy glow, streetlights, fire
2. **Direction**: overhead, camera-left, from behind (rim), from below
3. **Quality**: harsh/hard (sharp shadows), soft/diffused (gentle gradients), dappled
4. **Temperature**: warm golden, cool blue, neutral white, sickly green

Do not write "dramatic lighting" or "cinematic lighting" — name the actual source, its direction, its quality, and its color temperature.

If the scene describes a specific light source (energy beams, alien glow, emergency lights), that source must appear in the lighting description with all four components.

Match lighting to what the scene describes. Do not add atmospheric elements (storm, fog, night) the scene does not include.

---

## Prompt Construction

Write a single flowing prose paragraph. Do not use bullet points, numbered steps, or keyword lists.

The paragraph must contain, in order:
1. The peak visual event and main subject — the specific action at its most dramatic moment
2. The setting and spatial relationships
3. Shot framing, camera angle, and depth of field (explicit words from the shot type table)
4. "from image N" references for every available image
5. Lighting with source, direction, quality, and temperature — all four
6. Mood or atmosphere

Lead with what is most dramatic and specific. Do not open with the environment when the event is the point.

Example structure: "A wide establishing shot of [environment from image 2], deep focus with foreground and background both sharp, showing [characters from image 1] [specific action at its peak]. [Lighting with all four components]. [Mood]."

---

**Output format:**
```
**Image Prompt:**
[Single detailed paragraph matching the shot's framing. Reference characters/settings with "from imageN" phrasing only for images explicitly listed as available for this shot. Lead with subject and action, then setting, then lighting, then mood. Write flowing prose — not comma-separated keywords.]

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

---

{{FRAME_GENERATION_GUIDE}}

---

## Multi-Frame Output (FLFV/FMLFV shots only)

When the shot's `videoGenerationMode` is `flfv` or `fmlfv`, you must generate MULTIPLE frame prompts in a single JSON object using a `frames` field.

### JSON Structure for Multi-Frame Shots

**FLFV example (first + last frame):**
```json
{
  "shotNumber": 2,
  "frames": {
    "first_frame": {
      "imagePrompt": "Full scene description for the opening frame...",
      "generationMode": "image_text_to_image",
      "references": [
        { "imageNumber": 1, "type": "character", "refId": "investigator" },
        { "imageNumber": 2, "type": "setting", "refId": "pataliputra_alleys" }
      ]
    },
    "last_frame": {
      "imagePrompt": "Description of what changed — character moved deeper into passage, torchlight dimmer...",
      "generationMode": "edit_first_frame",
      "references": []
    }
  },
  "negativePrompt": "...",
  "aspectRatio": "16:9"
}
```

**FMLFV example (first + mid + last frame):**
```json
{
  "shotNumber": 4,
  "frames": {
    "first_frame": {
      "imagePrompt": "Full scene description for the opening frame...",
      "generationMode": "image_text_to_image",
      "references": [
        { "imageNumber": 1, "type": "character", "refId": "kai" },
        { "imageNumber": 2, "type": "setting", "refId": "alley" }
      ]
    },
    "mid_frame": {
      "imagePrompt": "Description of mid-point — character now halfway across the space, expression shifted...",
      "generationMode": "edit_first_frame",
      "references": []
    },
    "last_frame": {
      "imagePrompt": "Description of end state — character reached the far side, lighting changed...",
      "generationMode": "edit_first_frame",
      "references": []
    }
  },
  "negativePrompt": "...",
  "aspectRatio": "16:9"
}
```

### Frame Generation Modes — Choose Per Frame

- **`image_text_to_image`** — Generate independently using character/setting reference images. Use this for the **first frame** (always) and for other frames when the composition is very different from the first frame.

- **`edit_first_frame`** (RECOMMENDED for last_frame/mid_frame) — Generate by **editing the first frame image**. The image prompt should describe ONLY what changed, not the full scene. This produces maximum visual consistency — same composition, lighting, colors, with only the described changes. Use when:
  - Camera angle and framing stay similar
  - Characters moved position, changed expression, or left the frame
  - Objects appeared/disappeared
  - Lighting shifted (e.g., torch extinguished)

- **`edit_previous_shot`** (RECOMMENDED for first_frame of continuation shots) — Generate by **editing the previous shot's last frame**. This maintains visual continuity between consecutive shots in the same scene. The image prompt should describe ONLY what changed from the previous shot's end state. Use when:
  - The camera angle is similar or slightly shifted from the previous shot
  - The scene and characters are the same (continuation of action)
  - You want smooth visual flow between shots (same lighting, colors, composition)
  - Do NOT use for: establishing shots of new locations, dramatic camera angle changes, or the first shot of a scene

- **`text_to_image`** — Generate from text only, no references. Use for frames with NO characters visible (e.g., empty room, landscape).

### Rules

1. **first_frame of shot 1** (first shot in scene) ALWAYS uses `image_text_to_image` with full character/setting references
2. **first_frame of shot 2+** (continuation shots) PREFER `edit_previous_shot` for visual continuity — unless the camera angle or location changes dramatically
3. **last_frame** and **mid_frame** PREFER `edit_first_frame` — it keeps visual consistency within the shot
4. Only use `image_text_to_image` for continuation shots if the camera angle changed dramatically or it's a new location
5. The `edit_first_frame` and `edit_previous_shot` prompts should describe the DELTA (what changed), not the full scene
6. For `edit_first_frame` and `edit_previous_shot`, the `references` array should be empty (the base image IS the reference)

### Single-Frame Shots (i2v, t2v)

For `i2v` and `t2v` shots, do NOT use the `frames` field. Use the standard flat format:

```json
{
  "imagePrompt": "...",
  "negativePrompt": "...",
  "aspectRatio": "16:9",
  "generationMode": "image_text_to_image",
  "references": [...]
}
```
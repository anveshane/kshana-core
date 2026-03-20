**PURPOSE**: Generate an image prompt for a specific shot within a multi-shot scene. Each shot has its own framing (establishing wide, close-up, medium, reaction) and uses only the reference images relevant to that shot. The resulting image will be used as the source frame for video generation of that shot.

**This works like `scene_image_prompt` but tailored to a specific shot's framing.**

**The instruction will include shot details**: shot number, shot type, camera work, and which characters/settings appear. Use this information to compose the image appropriately.

---

## CRITICAL: Reference Image Rule (Read First)

**Before anything else, count the reference images listed as available for this specific shot.**

- If 1 image is listed: you may only reference "image 1." There is no image 2, image 3, etc.
- If 2 images are listed: you may reference "image 1" and "image 2" only.
- **Never reference an image number that was not explicitly listed as available.** Do not invent a "NYC invasion setting" reference if only a character image was provided. Do not fabricate labels.
- If no reference images are listed: use `text_to_image` mode with no "from imageN" references.

**Fabricating a reference that wasn't provided is a hard failure.** When in doubt, use fewer references, not more.

---

## Step 1 — Identify the Central Story Beat (Most Important Step)

Before writing anything, answer: **What is the single most dramatic or defining visual event happening in this shot?**

- What is the **exact visual action** at its peak — not the setup, not the aftermath, the event itself?
- If something is transforming, dissolving, erupting, or colliding — that transformation IS the shot.
- If someone is reacting — to what? That reaction IS the shot.

**Depict the event itself, not the conditions around it.**

If the scene says people dissolve into golden particles as silver-white beams strike them — the dissolving particles are the shot, not just ships hovering and casting shadows. If a character is shouting — show the open mouth, the tension, not a neutral face. If an explosion is happening — show the explosion mid-burst.

**The scene description is ground truth. Copy the visual, do not substitute it.**
- If the scene says golden particles: write golden particles — do not replace with "panic" or "fear."
- If the scene says daytime: use daytime — do not introduce rain, night, or storm.
- If a character is reaching out: show them reaching — do not show arms crossed.

**Critical: Your negative prompt must never block story-required elements.** If the scene requires action, chaos, energy beams, or transformation, do not negate those things. Only negate elements that are absent from or wrong for this scene.

---

## Step 2 — Determine Shot Composition

Use the shot type from the motion JSON to set framing, depth of field, and camera position.

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

**Rules:**
- A wide establishing shot must use deep focus — do not write shallow depth of field.
- A close-up must show the face filling the frame — do not describe the character standing in a vast environment.
- **Always state the depth of field explicitly** in the prompt text. Example: "deep focus with foreground and background both sharp" or "shallow depth of field, face razor-sharp, background strongly blurred."
- **If the motion JSON specifies a camera angle** (e.g., "slightly low angle looking up," "high angle," "dutch tilt"), that angle must appear in the final prompt prose — not in planning notes only.

---

## Step 3 — Scope Reference Images

**Only use the reference images explicitly listed as available for this shot.** Reference images by their number in the prose: "the character from image 1," "the setting from image 2." Unreferenced images are ignored by the model.

- For close-ups of a single character: reference only that character's image.
- For wide/establishing shots with multiple characters and a setting: reference all applicable images that were listed as available.
- **Do not reference image 3 if only image 1 and image 2 were provided.** Never fabricate a reference that wasn't in the provided list.

---

## Step 4 — Specify Lighting in the Prose

Lighting must appear inside the image prompt paragraph — not in a separate list or planning notes. It must include all four components:

1. **Source**: natural sunlight, overcast sky, practical lamp, alien energy glow, streetlights, fire
2. **Direction**: overhead, camera-left, from behind (rim), from below
3. **Quality**: harsh/hard (sharp shadows), soft/diffused (gentle gradients), dappled
4. **Temperature**: warm golden, cool blue, neutral white, sickly green

Do not write "dramatic lighting" or "cinematic lighting" — name the actual source. Do not leave the direction unspecified.

Match lighting to what the scene actually describes. Do not add elements (streetlights, night atmosphere) that the source scene does not include.

Example: "Harsh midday natural sunlight from overhead, slightly camera-left, casting sharp geometric shadows across the concrete — cold white light with no warmth."

---

## Step 5 — Only Include What This Scene and Shot Describes

Only include locations, characters, objects, and atmosphere described in **this scene and this specific shot**. Do not introduce elements from other scenes. Each shot is self-contained.

If the shot is a wide establishing of an environment, do not introduce characters who are not present in this shot. If the shot is a close-up of a character, do not describe the vast environment behind them.

If a character appears in this shot but needs an appearance change from their reference image (different clothing, injuries, different emotional state), describe those changes explicitly in the prompt prose.

---

## Step 6 — Write the Prompt as Flowing Prose

All analysis from Steps 1–5 must be expressed in the image prompt paragraph — not left as bullet points or planning notes. The prompt is a single detailed paragraph that:

- Leads with the subject and the active story beat (what is literally happening right now)
- Establishes the setting and spatial relationships
- States the shot framing, camera angle, and depth of field explicitly
- Describes lighting with source, direction, quality, and temperature
- Closes with mood or atmosphere

Write prose, not keywords. "People dissolving into golden particles as silver-white beams strike from above" — not "people, beams, dissolving, panic."

**The paragraph must be complete and detailed.** A single word, single letter, or incomplete sentence is not a valid prompt. Every output must include framing, subject, action, lighting, and atmosphere at minimum.

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
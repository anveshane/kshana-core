**PURPOSE**: Generate an image prompt for a specific shot within a multi-shot scene. Each shot has its own framing (establishing wide, close-up, medium, reaction) and uses only the reference images relevant to that shot. The resulting image will be used as the source frame for video generation of that shot.

**CRITICAL: Your entire job is to write the final image prompt paragraph.** Do not output planning notes, bullet points, reasoning, or template placeholders. Every insight from your analysis must be expressed in the final prose paragraph — not in thinking steps.

---

## CRITICAL: Reference Image Rule (Read First)

**Count the reference images listed as available for this specific shot.**

- If 1 image is listed: reference "image 1" in the prose. That is the only image available.
- If 2 images are listed: reference "image 1" and "image 2" in the prose.
- **Never reference an image number not explicitly listed as available.** If only a character image was provided, do not invent a setting reference.
- If no reference images are listed: use `text_to_image` mode with no "from imageN" references.

**Every available reference image MUST appear in the prompt paragraph using "from image N" phrasing.** If you identified that image 2 is the setting for this shot, that phrase "from image 2" must appear in the final paragraph — not just in your reasoning.

**Fabricating a reference that wasn't provided is a hard failure.**

---

## Step 1 — Identify the Central Story Beat

Before writing, answer internally: **What is the single most dramatic or defining visual event happening in this shot?**

- What is the **exact visual action** at its peak — not the setup, not the aftermath, the event itself?
- If something is transforming, dissolving, erupting, or colliding — that transformation IS the shot.
- If someone is reacting — to what? That reaction IS the shot.

**The scene description is ground truth. Copy the visual, do not substitute it.**
- If the scene says golden particles: write golden particles — do not replace with "panic" or "fear."
- If the scene says daytime: use daytime — do not introduce rain, night, or storm.
- If a character is reaching out: show them reaching — do not show arms crossed.

**Your negative prompt must never block story-required elements.** If the scene requires action, chaos, energy beams, or transformation, do not negate those things. Only negate elements absent from or wrong for this scene.

---

## Step 2 — Determine Shot Composition

Use the shot type from the motion JSON to set framing, depth of field, and camera position. **These must appear as explicit words in the final prose paragraph.**

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

**Rules for the prose:**
- A wide establishing shot: write "deep focus, foreground and background both sharp" — not shallow.
- A close-up: write that the face fills the frame — do not describe the character standing in a vast environment.
- **State the depth of field explicitly in the prose.** "deep focus with foreground and background both sharp" or "shallow depth of field, face razor-sharp, background strongly blurred."
- **If the motion JSON specifies a camera angle** (e.g., "slightly low angle looking up," "high angle," "dutch tilt"), that angle must appear in the final prose paragraph.

---

## Step 3 — Scope Reference Images to This Shot

**Only use reference images explicitly listed as available for this shot.**

- For close-ups of a single character: reference only that character's image.
- For wide/establishing shots with multiple characters and a setting: reference all applicable available images.
- **Do not reference image 3 if only image 1 and image 2 were provided.**

**Translate your reference decisions into the prose.** If you decide the character from image 1 is present, write "the character from image 1" in the paragraph. If the setting is from image 2, write "the environment from image 2." The word "image N" must appear in the paragraph text for every available reference.

---

## Step 4 — Specify Lighting in the Prose

Lighting must appear **inside the image prompt paragraph** — not in a separate list or planning notes. Include all four components:

1. **Source**: natural sunlight, overcast sky, practical lamp, alien energy glow, streetlights, fire
2. **Direction**: overhead, camera-left, from behind (rim), from below
3. **Quality**: harsh/hard (sharp shadows), soft/diffused (gentle gradients), dappled
4. **Temperature**: warm golden, cool blue, neutral white, sickly green

Do not write "dramatic lighting" or "cinematic lighting" — name the actual source. Do not leave the direction unspecified.

Match lighting to what the scene actually describes. Do not add elements (streetlights, night atmosphere) that the source scene does not include.

Example: "Harsh midday natural sunlight from overhead, slightly camera-left, casting sharp geometric shadows — cold white light with no warmth."

---

## Step 5 — Only Include What This Scene and Shot Describes

Only include locations, characters, objects, and atmosphere described in **this scene and this specific shot**. Do not introduce elements from other scenes. Each shot is self-contained.

If the shot is a wide establishing of an environment, do not introduce characters who are not present in this shot. If the shot is a close-up of a character, do not describe the vast environment behind them.

If a character appears in this shot but needs an appearance change from their reference image (different clothing, injuries, different emotional state), describe those changes explicitly in the prompt prose.

---

## Step 6 — Write the Prompt as Flowing Prose

**Everything you identified in Steps 1–5 must appear in the final image prompt paragraph.** Do not leave any element in your planning notes only.

The prompt is a single detailed paragraph that:

- Leads with the subject and the active story beat (what is literally happening right now)
- Establishes the setting and spatial relationships
- States the shot framing, camera angle, and depth of field explicitly
- References all available images with "from image N" phrasing
- Describes lighting with source, direction, quality, and temperature
- Closes with mood or atmosphere

Write prose, not keywords. "People dissolving into golden particles as silver-white beams strike from above" — not "people, beams, dissolving, panic."

**The paragraph must be complete and detailed.** Every output must include framing, subject, action, lighting, and atmosphere at minimum.

**Before finalizing, verify:**
- Does the prose include "image 1" (and "image 2," etc.) for every available reference? If not, add them.
- Does the prose explicitly state the depth of field? If not, add it.
- Does the prose describe the actual narrative event from the scene? If not, rewrite the lead sentence.
- Is this a single flowing paragraph, not a template or bullet list? If not, convert it.

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
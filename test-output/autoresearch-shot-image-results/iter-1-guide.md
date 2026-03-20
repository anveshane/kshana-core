**PURPOSE**: Generate an image prompt for a specific shot within a multi-shot scene. Each shot has its own framing (establishing wide, close-up, medium, reaction) and uses only the reference images relevant to that shot. The resulting image will be used as the source frame for video generation of that shot.

**This works like `scene_image_prompt` but tailored to a specific shot's framing.**

**The instruction will include shot details**: shot number, shot type, camera work, and which characters/settings appear. Use this information to compose the image appropriately.

---

## Step 1 — Extract the Specific Story Beat

Before writing anything, identify **what literally happens in this shot** from the scene description:
- What is the **exact visual event** (not just the mood — the concrete action, transformation, or tableau)?
- Who is present, and what are they doing or feeling?
- What **signature visuals** define this moment (e.g., bodies dissolving into golden particles, not just "people reacting")?

**Never substitute generic action for the source's specific visual.** If the scene says people dissolve into glowing particles, write that. Do not replace it with "people freeze in panic." If the scene describes a normal morning, do not introduce rain or night. The scene description is the ground truth — depict what it says.

---

## Step 2 — Determine Shot Composition

Use the shot type to set framing, depth of field, and camera position:

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

**Do not contradict the shot type in your description.** A wide establishing shot must use deep focus — do not describe shallow depth of field. A close-up must show the face filling the frame — do not describe the character standing in a vast environment.

---

## Step 3 — Scope Reference Images

**Only reference images that are explicitly listed as available for this shot.** Count how many reference images are provided, and only use those numbers (image 1, image 2, etc.). Do not reference "image 3" if only two images are available. Do not fabricate or assume references.

- For close-ups of a single character: reference only that character's image
- For wide/establishing shots with multiple characters and a setting: reference all applicable images
- If no reference images are listed as available: use `text_to_image` mode with no "from imageN" references

---

## Step 4 — Specify Lighting Precisely

Lighting must be described with all four components:
- **Source**: natural sunlight, overcast sky, practical lamp, alien energy glow, streetlights, fire
- **Direction**: overhead, camera-left, from behind (rim), from below
- **Quality**: harsh/hard (sharp shadows), soft/diffused (gentle gradients), dappled
- **Temperature**: warm golden, cool blue, neutral white, sickly green

Match lighting to what the scene actually describes. Do not add lighting elements (streetlights, night atmosphere) that aren't present in the source. If the scene describes daytime, use daytime lighting.

Example: "Harsh midday sunlight from overhead, slightly camera-left, casting sharp geometric shadows across the concrete — cold white light with no warmth."

---

## Step 5 — Do Not Add Elements from Other Scenes

Only include locations, characters, objects, and atmosphere described in **this scene and shot**. Do not introduce elements from other scenes as comparisons or flavoring (e.g., "reminiscent of the NYC invasion"). Each shot is self-contained.

---

**Output format:**
```
**Image Prompt:**
[Single detailed paragraph matching the shot's framing. Reference characters/settings with "from imageN" phrasing. Lead with subject and action, then setting, then lighting, then mood. Write flowing prose — not comma-separated keywords.]

**Reference Images:**
- Character: [name] (only if in this shot and listed as available)
- Setting: [name] (only if in this shot and listed as available)

**Negative Prompt:**
[Style-appropriate negatives + inconsistent appearance, wrong features]

**Aspect Ratio:**
1:1

**Generation Mode:**
image_text_to_image
```

If NO reference images are available (documentary/non-narrative), use `text_to_image` mode with no "from imageN" references.
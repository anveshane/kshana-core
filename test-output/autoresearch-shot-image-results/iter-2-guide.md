**PURPOSE**: Generate an image prompt for a specific shot within a multi-shot scene. Each shot has its own framing (establishing wide, close-up, medium, reaction) and uses only the reference images relevant to that shot. The resulting image will be used as the source frame for video generation of that shot.

**This works like `scene_image_prompt` but tailored to a specific shot's framing.**

**The instruction will include shot details**: shot number, shot type, camera work, and which characters/settings appear. Use this information to compose the image appropriately.

---

## Step 1 — Extract the Specific Story Beat

Before writing anything, identify **what literally happens in this shot** from the scene description:
- What is the **exact visual event** (not just the mood — the concrete action, transformation, or tableau)?
- Who is present, and what are they doing or feeling **in this specific shot**?
- What **signature visuals** define this moment?

**Copy the source, do not interpret it.** If the scene says people dissolve into golden particles, write that exact visual. Do not replace it with people "freezing in panic" or "reacting in fear." If the scene describes a normal morning, do not introduce rain or night. If a character is gesturing emphatically, do not show them with arms crossed. The scene description is the ground truth — depict what it says, not a generic version of it.

---

## Step 2 — Determine Shot Composition

Use the shot type from the motion JSON to set framing, depth of field, and camera position. Also note any explicit camera angle described in the shot details (low angle, dutch tilt, etc.) and include it.

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

**Always state the depth of field explicitly** in the prompt, even if it seems implied by the shot type. Example: "deep focus with foreground and background both sharp" or "shallow depth of field, face razor-sharp, background strongly blurred."

**If the motion JSON specifies a camera angle** (e.g., "slightly low angle looking up," "high angle," "dutch tilt"), include that angle in the prompt. Do not omit explicit angle information from the shot details.

---

## Step 3 — Scope Reference Images

**Count the reference images listed as available for this shot. Use only those numbers.** If two images are listed, reference only "image 1" and "image 2." Never reference "image 3" if only two images are available. Never fabricate or assume references not explicitly provided.

- For close-ups of a single character: reference only that character's image
- For wide/establishing shots with multiple characters and a setting: reference all applicable images
- If no reference images are listed as available: use `text_to_image` mode with no "from imageN" references

**Before writing the prompt, count the available images and write that number down mentally.** Only use reference numbers up to that count.

---

## Step 4 — Specify Lighting Precisely

Lighting must include all four components explicitly named:
1. **Source**: natural sunlight, overcast sky, practical lamp, alien energy glow, streetlights, fire
2. **Direction**: overhead, camera-left, from behind (rim), from below
3. **Quality**: harsh/hard (sharp shadows), soft/diffused (gentle gradients), dappled
4. **Temperature**: warm golden, cool blue, neutral white, sickly green

All four must appear. Do not write "dramatic lighting" or "cinematic lighting" — those are not descriptions. Do not leave the source unnamed (e.g., "harsh directional light" without stating what is casting it).

Match lighting to what the scene actually describes. Do not add lighting elements (streetlights, night atmosphere) that aren't present in the source. If the scene describes daytime, use daytime lighting.

Example: "Harsh midday natural sunlight from overhead, slightly camera-left, casting sharp geometric shadows across the concrete — cold white light with no warmth."

---

## Step 5 — Do Not Add Elements from Other Scenes

Only include locations, characters, objects, and atmosphere described in **this scene and shot**. Do not introduce elements from other scenes as comparisons or flavoring. Each shot is self-contained.

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
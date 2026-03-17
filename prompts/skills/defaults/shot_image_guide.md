**PURPOSE**: Generate an image prompt for a specific shot within a multi-shot scene. Each shot has its own framing (establishing wide, close-up, medium, reaction) and uses only the reference images relevant to that shot. The resulting image will be used as the source frame for video generation of that shot.

**This works like `scene_image_prompt` but tailored to a specific shot's framing.**

**The instruction will include shot details**: shot number, shot type, camera work, and which characters/settings appear. Use this information to compose the image appropriately.

**CRITICAL — Narrative Content from Scene Description:**
The scene description is the **narrative source** — it contains the story beats, character actions, emotions, and dramatic context. Each shot must depict a **specific story moment** from the scene description. The motion JSON provides framing and composition guidance, but the scene description provides **what is actually happening**. Do NOT generate generic compositions like "wide interior shot" or "close-up on hands" — include the specific narrative details (who is doing what, why, and the emotional tone).

**Shot-specific composition rules:**

| Shot Type | Composition |
|-----------|-------------|
| **extreme_wide** | Vast environment, character tiny or absent, establishes scale |
| **wide / establishing** | Full environment with characters head-to-toe, establishes location and context |
| **medium_wide** | Character from knees up, some environment visible, good for physical action |
| **medium** | Waist-up of character(s), conversational distance, balanced environment context |
| **medium_close_up** | Chest and head, intimate but not intense, captures expression and gesture |
| **close_up** | Face fills frame, maximum emotional impact, shallow depth of field |
| **extreme_close_up** | Single feature (eyes, hands, object), very intense, reveals key details |
| **low_angle** | Camera looking up at subject — appears powerful, dominant, imposing |
| **high_angle** | Camera looking down at subject — appears smaller, vulnerable |
| **dutch_angle** | Tilted frame, creates unease and tension |
| **birds_eye** | Directly above, unusual perspective, abstract/removed feel |
| **reaction** | Character responding — focus on facial expression and body language |
| **over_the_shoulder** | From behind one character looking at another, foreground character blurred |
| **two_shot** | Two characters in frame together, showing their spatial relationship |
| **pov** | Point-of-view — what a character sees, subjective perspective |
| **insert** | Detail shot of object or action (hands, letter, clock, weapon) |
| **cutaway** | Brief shot of related element outside the main action |
| **tracking** | Camera follows moving subject, dynamic composition |

**Reference image handling:**
- Use ONLY the character/setting references listed for this specific shot
- For close-ups: only the featured character's reference
- For establishing: all character + setting references
- Use the same "from image1", "from image2", "from image3" referencing as scene_image_prompt

**Output format** (same as scene_image_prompt):
```
**Image Prompt:**
[Single detailed paragraph matching the shot's framing. Reference characters/settings with "from imageN" phrasing.]

**Reference Images:**
- Character: [name] (only if in this shot)
- Setting: [name] (only if in this shot)

**Negative Prompt:**
[Style-appropriate negatives + inconsistent appearance, wrong features]

**Aspect Ratio:**
1:1

**Generation Mode:**
image_text_to_image
```

If NO reference images are available (documentary/non-narrative), use `text_to_image` mode with no "from imageN" references, same as scene_image_prompt.

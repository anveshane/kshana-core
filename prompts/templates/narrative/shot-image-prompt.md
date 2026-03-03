# Shot Image Prompt Template

Generate an image prompt for a specific shot within a multi-shot scene breakdown. This image will be used as the source frame for video generation of this shot.

## Shot Information

{{SHOT_CONTENT}}

## Shot-Specific Composition

The image must match the shot's framing. Different shot types require different compositions:

| Shot Type | Composition |
|-----------|-------------|
| **extreme_wide** | Vast environment, character tiny or absent, establishes scale |
| **wide / establishing** | Full environment, characters head-to-toe, establishes location |
| **medium_wide** | Character from knees up, physical action with environment |
| **medium** | Waist-up of character(s), conversational distance |
| **medium_close_up** | Chest and head, intimate, expression and gesture |
| **close_up** | Face fills frame, maximum emotional impact, shallow DOF |
| **extreme_close_up** | Single feature (eyes, hands, object), intense detail |
| **low_angle** | Camera below subject — powerful, dominant, imposing |
| **high_angle** | Camera above subject — smaller, vulnerable |
| **dutch_angle** | Tilted frame — unease, tension |
| **birds_eye** | Directly above — abstract, pattern view |
| **reaction** | Character responding — facial expression and body language |
| **over_the_shoulder** | Behind one character looking at another |
| **two_shot** | Two characters together, showing relationship |
| **pov** | Point-of-view — what a character sees |
| **insert** | Detail shot of object or action |
| **cutaway** | Brief shot of related element outside main action |
| **tracking** | Camera follows moving subject, dynamic composition |

## Reference Image Rules

- Use ONLY the character/setting references relevant to THIS shot
- For close-ups: only the featured character's reference
- For establishing/wide shots: all character + setting references
- Reference images as "from image1", "from image2", "from image3" based on the order listed in Reference Images section

## Output Format

When reference images EXIST:
```
**Image Prompt:**
[Single detailed paragraph matching the shot's framing. Use "from image1/image2/image3" to reference characters and settings.]

**Reference Images:**
- Character: [name]
- Setting: [name]

**Negative Prompt:**
[Style-appropriate negatives + inconsistent appearance, wrong features]

**Aspect Ratio:**
1:1

**Generation Mode:**
image_text_to_image
```

When NO reference images exist:
```
**Image Prompt:**
[Single detailed paragraph with all visual details self-contained]

**Negative Prompt:**
[Style-appropriate negatives]

**Aspect Ratio:**
1:1

**Generation Mode:**
text_to_image
```

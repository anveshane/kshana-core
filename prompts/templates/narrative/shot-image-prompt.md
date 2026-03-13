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

The establishing image is the spatial anchor for this scene. All per-shot images must appear to exist within the same physical space shown in the establishing image.

### Qwen Edit Slot Assignment (Per-Shot Images)

- **image1** (primary) = **establishing image** — the spatial anchor. This ensures the shot's environment matches the scene.
- **image2** = **character reference** — the featured character's face/appearance for accuracy.
- **image3** = secondary character reference OR setting reference (if only one character in shot).

### Framing Relative to Establishing Shot

The prompt must describe framing RELATIVE to the establishing shot:
- "Zooming into the character at the left of the space shown in image1..."
- "A close-up of the figure seated at the center desk in image1, with the face and features from image2..."
- "The right side of the room from image1, focusing on the bookshelf area..."

This ensures the generated image looks like a different camera angle within the SAME physical space, not a new environment.

### Shot Type Rules
- **Close-ups**: image1=establishing, image2=featured character ref
- **Medium shots**: image1=establishing, image2=character ref, image3=secondary character or setting ref
- **Wide/establishing shots**: image1=establishing, image2=character ref 1, image3=character ref 2

## Rendering Style (Cinematic Realism)

When the project uses `cinematic_realism` style, every shot image prompt MUST follow these rendering requirements:

1. **Rendering declaration sentence**: End the prompt with an explicit rendering statement, e.g.: "The image is rendered in a photorealistic cinematic style with natural film grain, shallow depth of field, and 8K resolution."

2. **Natural lighting behavior**: Describe how light physically behaves in the shot — reflections, shadows, light falloff. Instead of "dramatic lighting", write "a single warm practial light from the desk lamp illuminates the character's face from the left while the background falls into soft shadow, rim light from the window outlining the shoulder."

3. **Material textures and physical properties**: Include specific tactile details visible at the shot's framing distance: for close-ups, describe "visible pores, fine hair, the weave of cotton fabric"; for medium shots, describe "the drape and fold of clothing fabric, wood grain on furniture, scuff marks on leather shoes."

4. **Negative prompt additions**: Always append to the negative prompt: "3d render, CGI, computer graphics, video game, plastic skin, smooth textures, artificial lighting, flat colors"

These requirements ensure each shot maintains photorealistic quality consistent with the establishing image.

## Output Format

When reference images EXIST:
```
**Image Prompt:**
[Single detailed paragraph matching the shot's framing. Describe composition RELATIVE to the establishing shot in image1. Use "from image1" for the spatial environment, "from image2" for character appearance, "from image3" for secondary reference.]

**Reference Images:**
- Establishing: Scene [N] [path/to/establishing/scene_N.png]
- Character: [name] [path/to/character_ref.png]
- Character: [name] [path/to/character_ref.png]

**Negative Prompt:**
[Style-appropriate negatives + inconsistent appearance, wrong features, different room, different lighting]

**Aspect Ratio:**
1:1

**Generation Mode:**
image_text_to_image
```

**IMPORTANT**: The establishing image MUST be listed first (it becomes image1). Always include the actual file path in square brackets after each reference name. Use `list_project_files` to find the exact paths. The path should be relative to the project directory (e.g., `assets/images/0jZCrE-k_Establishing_Scene1_00001_.png`). This ensures reliable image resolution during generation.

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

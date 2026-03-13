# Establishing Image Prompt Template

Generate a wide establishing shot for this scene that serves as the spatial anchor for all per-shot images. This image defines the physical space — every shot derived from this scene must appear to exist within this same environment.

## Scene Information

{{SCENE_CONTENT}}

## Purpose

The establishing image is a **wide shot** showing:
- The full physical space of the scene
- All characters positioned within the environment
- The lighting, color palette, and atmosphere
- Enough spatial detail that close-up shots can be "zoomed in" from this image

This image is NOT used directly in the final video. It is used as the **primary reference** (image1) when generating per-shot images, ensuring every shot shares the same physical space.

## Composition Requirements

- **Framing**: Wide or extreme wide — show the full environment with all characters placed
- **Aspect Ratio**: 1:1 (square — matches per-shot image format)
- **Character Placement**: All characters in their approximate positions for the scene
- **Environment**: Full setting visible with key props, lighting, and atmosphere
- **No motion blur**: Static composition, as if a production still

## Qwen Edit Slot Assignment

When reference images are available, assign them as follows:

### Scenes with 1-2 characters (single pass):
- **image1** = setting reference image (primary environment)
- **image2** = character reference 1 (main character in scene)
- **image3** = character reference 2 (secondary character, if present)

### Scenes with 3+ characters (multi-pass):
Qwen Edit supports maximum 3 image slots. For scenes with more than 2 characters, generate in passes:

**Pass 1**: Setting + characters 1-2
- image1 = setting_ref, image2 = character_ref_1, image3 = character_ref_2
- Prompt describes the full scene with all character positions, but only characters 1-2 are rendered with face accuracy

**Pass 2**: Use Pass 1 result + characters 3-4
- image1 = Pass 1 result (intermediate establishing image), image2 = character_ref_3, image3 = character_ref_4
- Prompt describes where the additional characters appear in the existing composition from image1

Each pass produces an intermediate image; the final pass produces the establishing image.

## Prompt Writing Rules

- Describe the scene as a **wide production still** — no action, no motion
- Place characters in specific spatial positions: "on the left side", "seated at the center table", "standing near the window on the right"
- Use "from image1" for the setting/environment, "from image2" for character 1's appearance, "from image3" for character 2's appearance
- Include atmospheric details: lighting direction, color temperature, shadows, ambient elements
- DO NOT describe close-up details or facial expressions — this is a wide shot

## Rendering Style (Cinematic Realism)

When the project uses `cinematic_realism` style, every establishing image prompt MUST follow these rendering requirements:

1. **Rendering declaration sentence**: End the prompt with an explicit rendering statement, e.g.: "The image is rendered in a photorealistic documentary style with 8K resolution, natural film grain, and a 1:1 aspect ratio at 1024x1024 resolution."

2. **Natural lighting behavior**: Describe HOW light interacts with the scene — not just what type of light. Instead of "golden hour lighting", write "warm golden sunlight streams through the doorway at a low angle, casting long shadows across the flagstone floor while the upper walls remain in cool blue shadow."

3. **Material textures and physical properties**: Ground the scene in physical reality by naming specific textures: "rough-hewn oak beams", "cracked plaster walls revealing old brick beneath", "polished marble floor reflecting the overhead chandelier light", "worn leather armchair with visible creases."

4. **Negative prompt additions**: Always append to the negative prompt: "3d render, CGI, computer graphics, video game, plastic skin, smooth textures, artificial lighting, flat colors"

These requirements ensure the establishing image looks like a real photograph rather than a 3D-rendered graphic.

## Output Format

When reference images EXIST:
```
**Image Prompt:**
[Single detailed paragraph describing the wide establishing shot. Use "from image1/image2/image3" to reference settings and characters.]

**Reference Images:**
- Setting: [name] [path/to/setting_ref.png]
- Character: [name] [path/to/character_ref.png]
- Character: [name] [path/to/character_ref.png]

**Negative Prompt:**
[Style-appropriate negatives + inconsistent appearance, wrong features, motion blur, tight framing]

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
[Style-appropriate negatives + motion blur, tight framing]

**Aspect Ratio:**
1:1

**Generation Mode:**
text_to_image
```

**IMPORTANT**: Always include the actual file path in square brackets after each reference name. Use `list_project_files` to find the exact paths. The path should be relative to the project directory.

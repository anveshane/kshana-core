# FLUX 2 Klein: Image Edit Prompting Skill

You craft multi-reference edit prompts for FLUX 2 Klein. The model combines 1-4 reference images (characters, settings) into a single coherent output based on your prompt.

## How FLUX 2 Klein Works

- **No prompt upsampling.** What you write is what you get — be descriptive.
- **Write like a novelist, not a search engine.** Flowing prose works best, not comma-separated keywords.
- **Reference images by number.** You MUST explicitly reference images as `image 1`, `image 2`, etc. If you don't reference an image, the model will likely ignore it.
- **Word order matters.** The model pays more attention to what comes first. Front-load the most important elements.
- **Lighting is the highest-impact element.** Describe light source, quality, direction, temperature, and how it interacts with surfaces.

## Critical: Image Reference Format

Every reference image MUST be referenced in the prompt using `image N`:

```
The woman from image 1 stands in the doorway of the house shown in image 2.
```

Examples:
- "the person from image 1"
- "the building shown in image 2"
- "the environment from image 3"
- "the character from image 4"

**Unreferenced images are ignored by the model.**

## Prompt Structure

Write flowing prose following this priority order:

```
[Subject from image N + action/framing] → [Setting from image N] → [Spatial relationships] → [Lighting] → [Mood/atmosphere]
```

### Subject & Framing First
Lead with the main subject, what they're doing, and how they're framed:
- "A close-up of the young woman from image 1, her expression thoughtful as she gazes out the window"
- "The man from image 1 and the woman from image 2 sit across from each other at a table in the café from image 3"
- "A wide shot showing the character from image 1 walking towards the building from image 2"

### Setting & Spatial Relationships
Describe where characters are positioned relative to the environment:
- "standing in the doorway of the house from image 2"
- "seated at the far end of the room shown in image 3, near the window"
- "the blurred interior of the room from image 2 visible in the background"

### Lighting (Highest Impact)
Describe lighting like a photographer. Instead of "good lighting," write specific details:
- **Source:** natural, artificial, ambient — "soft natural light from a large window camera-left"
- **Quality:** soft, harsh, diffused, direct — "diffused, creating gentle shadows that define the subject's features"
- **Direction:** side, back, overhead, fill — "rim lighting from behind, separating the subject from the dark background"
- **Temperature:** warm, cool, golden, blue — "warm golden tones on the skin, cool blue shadows"
- **Interaction:** catches, filters, reflects — "light catches the texture of her wool sweater"

### Mood & Style
End with mood and optional style annotations:
- "creating a sense of quiet intimacy and shared history"
- "Style: intimate documentary portrait. Mood: contemplative, vulnerable."
- "Shot on 35mm film with shallow depth of field — subject razor-sharp, background softly blurred."

## Prompt Length

- **Short (10-30 words):** Quick concepts, style exploration
- **Medium (30-80 words):** Most production work
- **Long (80-300+ words):** Complex multi-reference compositions

Every sentence should add visual information. Avoid filler.

## Multi-Reference Patterns

### Character + Setting (2 images)
```
The [character description] from image 1 [action] in the [setting] from image 2. [Lighting]. [Mood].
```

### Two Characters + Setting (3 images)
```
The [character] from image 1 and the [character] from image 2 [interaction] in the [setting] from image 3. [Spatial arrangement]. [Lighting]. [Mood].
```

### Multiple Characters + Setting (4 images)
```
The [character] from image 1, the [character] from image 2, and the [character] from image 4 are gathered in the [setting] from image 3. [Each character's position]. [Lighting]. [Mood].
```

## What NOT to Do

- Don't use comma-separated keywords — write prose: "woman, garden, sunlight" → "A woman walks through a sunlit garden"
- Don't forget to reference images by number — the model ignores unreferenced images
- Don't use vague instructions: "Make it better", "Improve the lighting", "Fix the image"
- Don't bury the subject in description — lead with who and what, not the setting
- Don't describe what images look like — let the reference images provide visual details, your prompt describes the composition and transformation

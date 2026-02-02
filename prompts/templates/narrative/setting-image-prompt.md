# Setting Image Prompt Template

Generate a comprehensive image generation prompt for a setting/location reference image.

## Setting Information

{{SETTING_CONTENT}}

## MANDATORY Environmental Specifications

The prompt MUST include ALL of the following details. If the source setting description lacks any detail, you must infer reasonable values based on the story context.

### 1. Environment Type (ALL REQUIRED)

- **Location Category**: (interior, exterior, urban, rural, natural, industrial, etc.)
- **Specific Type**: (e.g., "Victorian manor library", "neon-lit Tokyo alley", "ancient temple courtyard")
- **Time Period**: Historical era or contemporary context
- **Scale**: (intimate space, medium room, vast landscape, etc.)

### 2. Atmosphere (ALL REQUIRED)

- **Time of Day**: Specific (e.g., "golden hour sunset", "overcast midday", "late night with artificial lighting")
- **Weather**: If applicable (clear, foggy, rainy, snowy, etc.)
- **Lighting Direction**: (front-lit, backlit, side-lit, diffuse, dramatic shadows)
- **Lighting Quality**: (harsh, soft, dappled, artificial vs natural)
- **Color Temperature**: (warm golden, cool blue, neutral, mixed)

### 3. Architecture & Environment (ALL REQUIRED)

- **Key Structures**: Main architectural or natural features
- **Materials**: Primary materials visible (stone, wood, glass, concrete, vegetation, etc.)
- **Scale Indicators**: Elements that convey the space's size
- **Depth Layers**: Foreground, midground, background elements

### 4. Mood & Style (ALL REQUIRED)

- **Emotional Tone**: (ominous, peaceful, chaotic, mysterious, welcoming, etc.)
- **Color Palette**: Dominant colors (3-5 colors)
- **Textures**: Notable surface qualities
- **Condition**: (pristine, weathered, abandoned, lived-in, etc.)

### 5. Technical Specifications (REQUIRED)

- **Aspect Ratio**: 16:9 (landscape orientation for establishing shots)
- **Shot Type**: Wide establishing shot
- **Depth of Field**: Deep focus to show full environment
- **Perspective**: (eye-level, low angle, high angle, aerial)

## Style Configuration

Style: {{STYLE_NAME}}
Style Modifiers: {{STYLE_MODIFIERS}}

## Output Format

Generate the prompt in this exact structure:

```
**Image Prompt:**
[Complete detailed prompt incorporating ALL mandatory elements above, style modifiers, and technical specs. Single paragraph, no line breaks.]

**Negative Prompt:**
{{STYLE_NEGATIVE_PROMPT}}, people, characters, figures, silhouettes, text, signage (unless specified), anachronistic elements, modern objects in historical settings, watermarks

**Aspect Ratio:**
16:9
```

## Example Output

**Image Prompt:**
A wide establishing shot of a Victorian manor library interior at golden hour, warm amber sunlight streaming through tall arched windows casting long shadows across polished mahogany floors. Floor-to-ceiling dark wood bookshelves filled with leather-bound volumes, a grand marble fireplace with ornate carved mantel in the midground, plush burgundy velvet armchairs, Persian rugs, brass reading lamps. Dust motes floating in light beams, rich warm color palette of burgundy, mahogany brown, and gold. Weathered grandeur, lived-in elegance, mysterious atmosphere. Eye-level perspective, deep focus, cinematic, photorealistic, dramatic lighting, high detail, film quality, 8k.

**Negative Prompt:**
anime, cartoon, illustration, drawing, sketch, 2d, cel shaded, people, characters, figures, silhouettes, text, modern furniture, anachronistic elements, watermarks

**Aspect Ratio:**
16:9

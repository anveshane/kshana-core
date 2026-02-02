# Character Image Prompt Template

Generate a comprehensive image generation prompt for a character reference image.

## Character Information

{{CHARACTER_CONTENT}}

## MANDATORY Visual Specifications

The prompt MUST include ALL of the following details. If the source character description lacks any detail, you must infer reasonable values based on the character's role and story context.

### 1. Physical Attributes (ALL REQUIRED)

- **Age**: Exact or approximate age (e.g., "mid-30s", "elderly around 70")
- **Ethnicity**: Specific ethnic background (e.g., "South Asian", "East African", "Northern European")
- **Height**: Relative description (e.g., "tall", "average height", "petite")
- **Weight/Build**: Body type (e.g., "athletic", "slender", "heavyset", "muscular")
- **Skin Tone**: Specific shade (e.g., "warm brown", "pale with freckles", "olive complexion")

### 2. Facial Features (ALL REQUIRED)

- **Face Shape**: (oval, square, round, heart-shaped, etc.)
- **Hair**: Color, texture, length, and specific style (e.g., "jet black straight hair in a low ponytail")
- **Eyes**: Color, shape, notable features (e.g., "deep brown almond-shaped eyes")
- **Nose**: Shape (straight, aquiline, button, etc.)
- **Mouth/Lips**: Shape, expression tendency (e.g., "full lips, often in a slight smile")
- **Distinguishing Features**: Scars, birthmarks, wrinkles, glasses, facial hair, etc.

### 3. Attire & Accessories (ALL REQUIRED)

- **Primary Outfit**: Main clothing items with colors and materials
- **Color Palette**: Dominant colors associated with this character
- **Accessories**: Jewelry, hats, bags, weapons, tools, etc.
- **Style Keywords**: (e.g., "professional", "bohemian", "military", "casual urban")

### 4. Pose & Expression (REQUIRED)

- **Pose**: Neutral pose for reference (typically 3/4 view or front-facing)
- **Expression**: Default/characteristic expression
- **Hands**: Position and any items held

### 5. Technical Specifications (REQUIRED)

- **Aspect Ratio**: 3:4 (portrait orientation for character reference)
- **Background**: Neutral solid color or simple gradient
- **Lighting**: Soft, even studio lighting for clear feature visibility

## Style Configuration

Style: {{STYLE_NAME}}
Style Modifiers: {{STYLE_MODIFIERS}}

## Output Format

Generate the prompt in this exact structure:

```
**Image Prompt:**
[Complete detailed prompt incorporating ALL mandatory elements above, style modifiers, and technical specs. Single paragraph, no line breaks.]

**Negative Prompt:**
{{STYLE_NEGATIVE_PROMPT}}, multiple people, busy background, motion blur, cropped face, text, watermarks, distorted features, inconsistent lighting

**Aspect Ratio:**
3:4
```

## Example Output

**Image Prompt:**
A portrait of a South Asian woman in her mid-30s, athletic build, warm brown skin tone, oval face with deep brown almond-shaped eyes, aquiline nose, full lips with a determined expression. Jet black wavy hair falling past her shoulders. Wearing a crisp white button-up shirt with rolled sleeves, dark navy blazer, small gold hoop earrings. Standing in a confident 3/4 pose, arms relaxed at sides. Neutral gray background, soft studio lighting, cinematic, photorealistic, dramatic lighting, high detail, film quality, 8k, professional photography.

**Negative Prompt:**
anime, cartoon, illustration, drawing, sketch, 2d, cel shaded, multiple people, busy background, motion blur, cropped face, text, watermarks, distorted features, inconsistent lighting

**Aspect Ratio:**
3:4

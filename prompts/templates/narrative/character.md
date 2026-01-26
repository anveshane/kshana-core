# Character Description Generation

Create a detailed character description for image generation.

## Story Context

{{STORY_CONTENT}}

## Character Name

{{CHARACTER_NAME}}

## Task

Create a comprehensive character description that will be used to:
1. Generate a consistent reference image
2. Include the character in scene images with visual continuity

### Required Elements

#### Physical Appearance
- Age and general build
- Face shape and features
- Hair color, style, and length
- Eye color and notable features
- Skin tone
- Height (relative terms: tall, average, short)

#### Distinctive Features
- Any scars, birthmarks, or unique features
- Accessories always worn (glasses, jewelry, etc.)
- Signature expressions or mannerisms

#### Clothing & Style
- Default outfit/costume
- Color palette for their wardrobe
- Style descriptors (casual, formal, rugged, elegant, etc.)

#### Character Essence
- Personality in one line
- How they carry themselves
- Emotional range typically displayed

## Output Format

```markdown
# Character: {{CHARACTER_NAME}}

## Role
[Their role in the story]

## Physical Appearance
- **Age**: [Age or age range]
- **Build**: [Body type]
- **Height**: [Relative height]
- **Face**: [Face shape and key features]
- **Hair**: [Color, style, length]
- **Eyes**: [Color, shape, expression]
- **Skin**: [Tone and any notable features]

## Distinctive Features
- [Feature 1]
- [Feature 2]

## Default Appearance
- **Clothing**: [Primary outfit description]
- **Colors**: [Character's color palette]
- **Accessories**: [Regular accessories]

## Visual Reference Notes
[A paragraph describing how to consistently render this character in images]

## Image Generation Prompt
[A ready-to-use prompt for generating this character's reference image]
```

## Guidelines

- Be specific enough for AI image generation consistency
- Avoid overly complex or contradictory descriptions
- Focus on visually distinctive elements
- Consider how the character will appear at different distances
- Include enough detail for medium shots and close-ups

# Setting Description Generation

Create a detailed setting/location description for image generation.

## Story Context

{{STORY_CONTENT}}

## Setting Name

{{SETTING_NAME}}

## Task

Create a comprehensive setting description that will be used to:
1. Generate a consistent reference image
2. Provide background context for scene images

### Required Elements

#### Location Type
- Interior or exterior
- Natural or man-made
- Scale (intimate space, vast landscape, etc.)

#### Physical Description
- Key architectural or natural features
- Layout and spatial relationships
- Notable objects or landmarks

#### Atmosphere
- Time of day for typical scenes
- Weather and seasonal elements
- Lighting conditions
- Color palette and mood

#### Story Context
- What happens here in the story
- Emotional significance of the location

## Output Format

```markdown
# Setting: {{SETTING_NAME}}

## Type
[Interior/Exterior] - [Natural/Urban/etc.]

## Description
[2-3 paragraph vivid description of the location]

## Key Features
- [Feature 1]
- [Feature 2]
- [Feature 3]

## Atmosphere
- **Time**: [Typical time of day]
- **Lighting**: [Lighting conditions]
- **Weather**: [Weather/seasonal elements]
- **Mood**: [Emotional atmosphere]
- **Colors**: [Dominant color palette]

## Story Significance
[How this setting relates to the story]

## Visual Reference Notes
[Notes for consistent rendering across scenes]

## Image Generation Prompt
[A ready-to-use prompt for generating this setting's reference image]
```

## Guidelines

- Focus on visually striking and memorable elements
- Consider how characters will interact with the space
- Include both wide-shot and detail elements
- Think about lighting for consistent scene generation
- Balance specificity with flexibility for different scenes

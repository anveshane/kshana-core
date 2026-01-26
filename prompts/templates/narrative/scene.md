# Scene Description Generation

Create a detailed scene description for image and video generation.

## Story Context

{{STORY_CONTENT}}

## Available Characters

{{CHARACTERS_CONTENT}}

## Available Settings

{{SETTINGS_CONTENT}}

## Scene Number

{{SCENE_NUMBER}}

## Task

Create a comprehensive scene description that specifies:
1. Which characters appear and where
2. Which setting is used
3. The action and emotion of the scene
4. Visual direction for image generation

### Required Elements

#### Scene Header
- Scene number and title
- Setting (must match an available setting)
- Time of day and lighting

#### Characters Present
- List all characters in the scene (must match available characters)
- Their positions and relationships in frame

#### Action & Dialogue
- What happens in this scene
- Key dialogue (if any)
- Emotional beats

#### Visual Direction
- Camera angle and framing
- Key visual elements
- Motion and blocking
- Mood and atmosphere

## Output Format

```markdown
# Scene {{SCENE_NUMBER}}: [Scene Title]

## Setting
**Location**: [Setting name from available settings]
**Time**: [Time of day]
**Lighting**: [Lighting description]

## Characters
- [Character 1 name]: [Position and state]
- [Character 2 name]: [Position and state]

## Action

[Detailed description of what happens in this scene]

## Dialogue (if any)

> **[Character]**: "[Line]"

> **[Character]**: "[Line]"

## Visual Direction

- **Shot Type**: [Wide/Medium/Close-up]
- **Camera Angle**: [Eye-level/Low/High/Dutch]
- **Framing**: [Description of composition]
- **Focus**: [What draws the eye]
- **Motion**: [Camera movement, character movement]

## Emotional Beat
[The emotional purpose of this scene]

## Transition
[How this scene connects to the next]

## Image Generation Prompt
[A ready-to-use prompt combining setting, characters, and action]
```

## Guidelines

- Every character mentioned must be from the available characters list
- The setting must be from the available settings list
- Consider visual continuity with adjacent scenes
- Include enough detail for AI image generation
- Keep dialogue minimal and impactful
- Focus on the single most important moment to capture

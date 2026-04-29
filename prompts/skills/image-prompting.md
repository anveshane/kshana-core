---
name: image-prompting
description: How to write or edit a shot's image prompt — composition, lighting, character/setting reference handling, style cues, and the format the generator expects. Load this before writing or modifying any imagePrompt field in prompts/images/shots/*.json or character/setting reference prompts.
---

# Image Prompting Skill

You create detailed visual descriptions that serve as prompts for image generation. Your output translates narrative content into specifications that produce high-quality, consistent images.

## Your Role

You transform story elements (characters, settings, scenes) into precise image prompts. You understand both what makes a good image and how to describe it for generation.

## Your Approach

1. **Read the source material**: Understand what you're visualizing
2. **Extract visual elements**: Identify everything that should appear
3. **Add technical direction**: Composition, lighting, style
4. **Output complete prompts**: Ready for image generation

## Types of Image Prompts

### Character Reference
Full-body or portrait reference for establishing a character's look:
- Complete physical description
- Specific clothing and accessories
- Pose and expression
- Lighting and background
- Style notes

### Setting Reference
Establishing shot of a location:
- Environment and architecture
- Time of day and weather
- Atmospheric conditions
- Key visual details
- Mood and tone

### Scene Image
A specific moment from the story:
- Characters in context
- Action and interaction
- Composition and framing
- Emotional content
- Narrative purpose

## Prompt Structure

A complete image prompt includes:

### Subject Description
Who/what is in the image:
- Characters with full visual details
- Objects and elements
- Relationships and positions

### Environment Description
The setting and context:
- Location and background
- Time of day
- Weather and atmosphere
- Depth and scope

### Technical Direction
How the image should be captured:
- Shot type (close-up, wide, medium)
- Angle (eye level, low, high)
- Composition guidance
- Lighting direction and quality
- Depth of field

### Style Direction
The visual aesthetic:
- Art style (photorealistic, stylized, etc.)
- Color palette
- Mood and tone
- Reference style if applicable

## Example Prompts

### Character Reference
```
Full body portrait of Detective Sarah Chen, Asian woman in her late 30s with sharp angular features and intelligent dark eyes. She has black hair pulled back in a practical bun with a few loose strands framing her face. She wears a fitted gray wool coat over a crisp white blouse, dark slacks, and sensible black leather shoes. Her posture is alert and confident, one hand in coat pocket. She stands in soft studio lighting against a neutral gradient background. Photorealistic style, professional portrait composition, warm color temperature.
```

### Setting Reference
```
Interior of a 1940s detective's office at night. Warm incandescent lighting from a green glass desk lamp casts pools of light and deep shadows. Oak desk cluttered with case files and a manual typewriter. Venetian blinds half-closed with city lights visible through gaps. Brick wall visible, a trench coat hangs on a wooden coat rack. Frosted glass door with "Private Investigator" lettered in gold. Noir atmosphere, warm amber tones contrasting with cool blue city light from window. Photorealistic style, wide shot establishing the space.
```

### Scene Image
```
Medium shot of Detective Sarah Chen sitting at her cluttered oak desk, leaning forward with hands clasped, listening intently. Warm incandescent side lighting from desk lamp creates dramatic shadows across her face. Her gray wool coat is draped over the chair behind her, revealing her white blouse. Case files spread before her, coffee cup steaming nearby. Through half-closed venetian blinds behind her, city lights twinkle in the darkness. Expression is focused, slightly concerned. Noir atmosphere, cinematic composition with rule of thirds, shallow depth of field keeping background soft. Photorealistic style.
```

## Consistency Requirements

When creating prompts for the same project:

### Character Consistency
- Use identical physical descriptions
- Same clothing (unless narrative change)
- Consistent distinctive features
- Reference character name for recognition

### Setting Consistency
- Same architectural details
- Consistent lighting style
- Matching color palette
- Key elements appear repeatedly

### Style Consistency
- Same art style throughout
- Consistent color grading
- Matching atmosphere
- Unified visual language

## Working from Source Material

When you receive a scene description:

1. **Extract characters**: Who appears, their descriptions
2. **Identify setting**: Where it takes place
3. **Capture action**: What's happening in this moment
4. **Note emotion**: The feeling of the scene
5. **Determine composition**: How to frame it effectively

## Technical Considerations

### Shot Selection
Match the narrative moment:
- Intimate dialogue → medium or close-up
- Action and movement → wide or medium wide
- Establishing location → wide or extreme wide
- Emotional peak → close-up
- Revelation → whatever emphasizes the reveal

### Lighting
Match the mood:
- Warm light → comfort, intimacy
- Cool light → tension, detachment
- High contrast → drama, noir
- Soft even light → neutrality, clarity
- Dramatic shadows → mystery, menace

### Composition
Guide the eye:
- Rule of thirds for subjects
- Leading lines to focus
- Negative space for isolation
- Symmetry for stability
- Asymmetry for tension

## Output Format

Return prompts in a clear format:

```
## Image Prompt: [Name/Scene Number]

[Complete prompt text, 2-4 sentences covering subject, environment, technical direction, and style]

**Purpose**: [What this image is for - reference, scene, establishing shot]
**Key Elements**: [Most important things to appear]
```

## Tips

- Be specific about everything visible
- Include lighting direction and quality
- Specify the shot type and composition
- Include style guidance for consistency
- Reference existing character/setting descriptions exactly
- Layer descriptions: subject → environment → technical → style

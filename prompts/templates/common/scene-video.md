# Scene Video Generation

Generate a video clip from a scene image.

## Scene Information

{{SCENE_CONTENT}}

## Source Image

Image Path: {{SCENE_IMAGE_PATH}}

## Motion Guidelines

Based on the scene description, determine appropriate motion:

### Camera Motion
- **Static**: For contemplative or dialogue-heavy scenes
- **Slow Pan**: For establishing shots or revealing information
- **Slow Zoom**: For emphasis or emotional moments
- **Tracking**: For following character movement

### Subject Motion
- Analyze the scene action to determine subject motion
- Keep motion subtle and natural
- Avoid jarring or unrealistic movements

## Video Parameters

- Duration: {{SCENE_DURATION}} seconds (default: 4-6 seconds)
- Frame Rate: 24fps (cinematic) or 30fps (smooth)
- Resolution: Match source image aspect ratio

## Motion Prompt

Construct a motion prompt that describes:
1. Camera movement type and direction
2. Subject motion (if any)
3. Environmental motion (wind, water, particles)
4. Transition hints for continuity with adjacent scenes

## Quality Checklist

- [ ] Motion matches scene mood
- [ ] No visual artifacts or glitches
- [ ] Smooth start and end for editing
- [ ] Character features remain consistent

# Scene Video Generation (LTX-2)

Generate a video clip from a scene image using LTX-2.

## Scene Information

{{SCENE_CONTENT}}

## Source Image

Image Path: {{SCENE_IMAGE_PATH}}

## LTX-2 Prompt Guidelines

Write a single flowing paragraph in present tense that describes the scene chronologically — how it starts, what action unfolds, and how it resolves.

### Key Principles
- **Present tense**: "a woman walks" not "a woman walking"
- **Show, don't label**: Describe physical manifestations of emotion, not the emotion itself
- **Explicit camera work**: Weave camera movement into the description naturally ("slow pan right reveals", "camera tracks alongside")
- **Match detail to scale**: More detail for close-ups, broader environment for wide shots
- **Include environment**: Wind, water, light changes, atmospheric effects add life
- **Keep it achievable**: Motion must fit within the clip duration

### Elements to Include
1. Camera movement type, direction, and speed
2. Subject/character action and physical changes
3. Environmental motion (wind, water, particles, light)
4. Background details, lighting, and textures in motion

## Video Parameters

- Duration: {{SCENE_DURATION}} seconds (default: 4-6 seconds)
- Frame Rate: 24fps
- Model: LTX-2

## Quality Checklist

- [ ] Prompt is a single flowing paragraph
- [ ] Written in present tense with chronological flow
- [ ] Camera work is explicitly described
- [ ] Motion is subtle and achievable for the duration
- [ ] No text, logos, or chaotic motion
- [ ] Character features remain consistent

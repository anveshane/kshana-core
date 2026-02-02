# Video Generation Phase

This phase generates video clips from each approved scene image.

## Phase Goal

Create animated video clips for each scene that bring the static images to life.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Scene files are in `scenes/scene_[N].md`. Scene images are tracked in `project.json` under the scenes array with their `imageArtifactId` properties.

## Artifacts in This Phase

- **Scene Videos**: Animated video clips for each scene

## Image-to-Video Generation

Each video clip is generated from its corresponding scene image:
1. The scene image serves as the starting frame
2. Motion is added based on the scene description
3. The video captures the action/moment described

## Workflow

For each approved scene image:
1. Review the scene description for action details
2. Determine appropriate motion:
   - Camera movement (pan, zoom, dolly)
   - Character movement
   - Environmental motion (wind, water, etc.)
3. Construct the video generation prompt
4. Generate the video clip
5. Present to user for approval
6. Allow regeneration if needed

## Video Guidelines

### Motion Types
- **Subtle motion**: For emotional/quiet scenes (slow camera push, gentle movement)
- **Dynamic motion**: For action scenes (faster camera movement, character action)
- **Static with life**: Minimal movement but environmental animation (breathing, blinking, wind)

### Duration
- Typical scene clip: 3-8 seconds
- Adjust based on scene importance and content
- Consider how clips will flow together

### Technical Considerations
- Maintain visual quality from the source image
- Avoid jarring or unnatural movements
- Ensure motion matches the scene's emotional tone

## User Approval

This is an EXPENSIVE phase. For each video:
1. Show the source image and motion prompt
2. Confirm before generation
3. Play the generated video for review
4. Allow approval, rejection with feedback, or regeneration

## Handling Rejections

When a scene video is rejected:
1. Capture user's feedback on the motion
2. Adjust the video generation parameters
3. May need to regenerate from same image or re-generate image
4. Present the new version

## Quality Criteria

Before completing this phase:
- [ ] All scenes have approved video clips
- [ ] Motion is appropriate for each scene
- [ ] Visual quality is maintained
- [ ] Clips flow naturally (similar pacing/style)
- [ ] No jarring artifacts or glitches

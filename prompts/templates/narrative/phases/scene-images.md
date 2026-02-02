# Scene Image Generation Phase

This phase generates images for each scene using the approved reference images.

## Phase Goal

Create scene images that visually tell each moment of the story while maintaining character and setting consistency.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Scene files are in `scenes/scene_[N].md`. Character and setting reference images are tracked in `project.json` under characters and settings arrays with their `referenceImagePath` properties.

## Artifacts in This Phase

- **Scene Images**: One image per scene capturing the key visual moment

## Reference-Based Generation

Each scene image should:
1. Match characters to their reference images
2. Match settings to their reference images
3. Capture the specific action or moment described
4. Maintain the project's visual style

## Workflow

For each approved scene:
1. Identify which character references to use
2. Identify which setting reference to use
3. Construct an image prompt that combines:
   - Scene action/moment description
   - Character visual details (from references)
   - Setting visual details (from reference)
   - Style modifiers
4. Generate the scene image
5. Present to user with the scene description for context
6. Allow approval, rejection, or regeneration

## Image Composition Guidelines

### Character Positioning
- Place characters according to scene description
- Maintain character proportions from references
- Show appropriate character expressions/poses

### Setting Integration
- Background should match setting reference
- Lighting should be consistent with setting
- Include relevant props from setting description

### Storytelling
- The image should "tell" what's happening
- Capture emotion and drama
- Consider the viewer's eye flow

## User Approval

This is an EXPENSIVE phase. For each scene image:
1. Show the scene description and image prompt
2. Confirm before generation
3. Display the generated image alongside scene details
4. Allow approval, rejection with feedback, or regeneration

## Handling Rejections

When a scene image is rejected:
1. Capture user's feedback
2. Adjust the image prompt accordingly
3. Regenerate with refined parameters
4. Present the new version

## Quality Criteria

Before completing this phase:
- [ ] All scenes have approved images
- [ ] Characters are visually consistent across scenes
- [ ] Settings are visually consistent across scenes
- [ ] Each image captures its scene's key moment
- [ ] Visual style is maintained throughout

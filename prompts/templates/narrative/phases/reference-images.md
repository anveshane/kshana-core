# Reference Image Generation Phase

This phase generates reference images for all characters and settings to ensure visual consistency.

## Phase Goal

Create reference images that will be used to maintain visual consistency when generating scene images.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Character files are in `characters/[name].md` and setting files are in `settings/[name].md`. Read each one to generate appropriate reference images.

## Artifacts in This Phase

- **Character Images**: Reference images for each character
- **Setting Images**: Reference images for each setting

## Why Reference Images Matter

Reference images serve as the visual "source of truth" for:
- Consistent character appearance across all scenes
- Consistent setting/environment appearance
- Establishing the visual style and tone

## Workflow

### 1. Character Reference Images
For each approved character:
1. Construct an image prompt from the character description
2. Apply the project's style modifiers
3. Generate the reference image
4. Present to user for approval
5. Allow regeneration if needed

### 2. Setting Reference Images
For each approved setting:
1. Construct an image prompt from the setting description
2. Apply the project's style modifiers
3. Generate the reference image
4. Present to user for approval
5. Allow regeneration if needed

## Image Generation Guidelines

### Character References
- Use neutral poses (standing, 3/4 view)
- Clear facial features and details
- Simple background to focus on character
- Full body or portrait as appropriate

### Setting References
- Wide shot to capture full environment
- Proper lighting for the location
- Key props and details visible
- Appropriate atmosphere and mood

## User Approval

This is an EXPENSIVE phase. Before generating each image:
1. Show the user the image prompt that will be used
2. Confirm they want to proceed with generation
3. Display the generated image
4. Allow approval, rejection, or regeneration request

## Quality Criteria

Before completing this phase:
- [ ] All characters have approved reference images
- [ ] All settings have approved reference images
- [ ] Images match the written descriptions
- [ ] Visual style is consistent across all references
- [ ] User has approved all reference images

### Scene Image Generation Phase

**REQUIRED CONTEXT**: Use the registered scenes from `read_project`.
Each scene has a description and references to characters/settings with reference images.

IMPORTANT: Each scene image prompt requires user approval before the image is generated.

## Workflow

For each scene (ONE at a time):
1. Generate the scene image prompt using `generate_content`:
   ```
   generate_content(content_type: "scene_image_prompt", scene_number: 1)
   ```
   This automatically uses:
   - The scene description
   - Character reference images for consistency
   - Setting reference images for consistency
   - Project style settings

2. The prompt will be shown to the user for approval
3. After approval, the image is generated automatically using the reference images
4. Update scene with imageArtifactId using `update_project` action: 'update_scene_approval'

## Scene Image Prompt Guidelines

The generated prompts will include:
- Complete scene composition from the scene description
- Character appearances matched to their reference images
- Setting atmosphere matched to setting reference images
- Appropriate camera angle and framing
- Lighting and mood consistent with the scene

## After EACH Approval (MANDATORY):

```
// 1. Register the approval
update_project(action: 'update_scene_approval', data: { scene_number: 1, imageArtifactId: '...' })

// 2. Update todo
TodoWrite(merge: true, todos: [
  { id: 'scene-img-1', status: 'completed' },
  { id: 'scene-img-2', status: 'in_progress' }
])

// 3. Generate next scene image prompt
generate_content(content_type: "scene_image_prompt", scene_number: 2)
```

## Phase Completion

After all scene images are approved:
1. Mark final todo as completed
2. Mark phase complete: `update_project(action: 'update_planner_stage', data: { phase: 'scene_images', stage: 'complete' })`
3. **IMMEDIATELY** transition: `update_project(action: 'transition_phase', data: { next_phase: 'video' })`

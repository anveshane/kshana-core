### Scene Image Generation Phase

**REQUIRED CONTEXT**: Use the registered scenes from `read_project`.
Each scene has a description and references to characters/settings with reference images.
DO NOT re-read $story or earlier phase outputs - use the approved scene descriptions and reference images.

IMPORTANT: Each scene image requires user approval before generation.

For each scene:
1. Get scene description from `read_project` (scenes array)
2. Get character/setting reference images for characters and settings in that scene
3. Use Task(subagent_type: 'image-generator', task: "Generate scene image for [scene title]") with the scene's visual description and reference images
4. The prompt will be shown to the user for approval
5. After approval, generate the image using character/setting references for consistency
6. Update scene with imageArtifactId using `update_project` action: 'update_scene_approval'

Scene image prompts should:
- Describe the complete scene composition
- Reference character appearances from their reference images
- Match the setting atmosphere
- Include camera angle and framing
- Specify lighting and mood

Process ONE scene at a time. Wait for user approval before moving to the next.

After all scene images are approved:
1. Update planner stage to 'complete'
2. Transition to the video generation phase

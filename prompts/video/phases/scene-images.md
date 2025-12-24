### Scene Image Generation Phase

IMPORTANT: Each scene image requires user approval before generation.

For each scene:
1. Read the scene description and gather character/setting references
2. Use Task(subagent_type: 'image-generator') to craft a scene image prompt
3. The prompt will be shown to the user for approval
4. After approval, generate the image using character/setting references for consistency
5. Update scene with imageArtifactId using `update_project` action: 'update_scene_approval'

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

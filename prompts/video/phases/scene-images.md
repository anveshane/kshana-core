### Scene Image Generation Phase

**REQUIRED CONTEXT**: Use the registered scenes from `read_project`.
Each scene has a description and references to characters/settings with reference images.
DO NOT re-read $story or earlier phase outputs - use the approved scene descriptions and reference images.

**OPTIONAL CONTEXT**: `$highlights` - If available (from YouTube transcript workflow), use the extracted visual highlights to enhance image prompts with:
- **Camera angles**: wide shot, close-up, over-the-shoulder, bird's eye, etc.
- **Composition**: rule of thirds, centered subject, leading lines, depth layers
- **Lighting**: soft morning light, dramatic shadows, natural daylight, warm interior
- **Color palette**: warm earth tones, cool blues, high contrast, desaturated
- **Emotional tone**: for mood and atmosphere guidance

Match each scene to its corresponding highlight (if available) for consistent visual direction.

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
- Include camera angle and framing (use `$highlights` visual hints if available)
- Specify lighting and mood (use `$highlights` emotional tone if available)
- Include color palette suggestions from highlights when present

Process ONE scene at a time. Wait for user approval before moving to the next.

After all scene images are approved:
1. Update planner stage to 'complete'
2. Transition to the video generation phase

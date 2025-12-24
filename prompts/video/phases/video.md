### Video Generation Phase

IMPORTANT: This is an expensive operation. Get user approval before starting.

For each scene:
1. Read the scene image and description
2. Use Task(subagent_type: 'video-assembler') to plan the video clip
3. The plan will be shown to the user for approval
4. After approval, generate the video clip from the scene image
5. Update scene with videoArtifactId using `update_project` action: 'update_scene_approval'

Video clips should include:
- Subtle camera movement (pan, zoom, etc.)
- Motion appropriate to the scene action
- Duration matching the scene's pacing (typically 3-6 seconds)

Process ONE scene at a time. Wait for user approval before moving to the next.

After all scene videos are generated:
1. Update planner stage to 'complete'
2. Transition to the final video assembly phase

### Video Generation Phase

**REQUIRED CONTEXT**: Use the registered scenes with their approved images from `read_project`.
Each scene has an imageArtifactId pointing to the approved scene image.
DO NOT re-read earlier phase outputs - use the approved scene data and images.

IMPORTANT: This is an expensive operation. Get user approval before starting.

For each scene:
1. Get scene data from `read_project` (scenes array with imageArtifactId)
2. Use Task(subagent_type: 'video-assembler', task: "Generate video for [scene title]") with the scene's image and description
3. The plan will be shown to the user for approval
4. After approval, generate the video clip from the scene image
5. Update scene with videoArtifactId using `update_project` action: 'update_scene_approval'

Video clips should include:
- Static camera by default; no movement unless explicitly requested
- Motion appropriate to the scene action only when explicitly requested
- Duration matching the scene's pacing (typically 3-6 seconds)

Process ONE scene at a time. Wait for user approval before moving to the next.

After all scene videos are generated:
1. Mark phase complete: `update_project(action: 'update_phase', data: { phase: 'video', status: 'completed' })`
2. Transition to the final video assembly phase: `update_project(action: 'transition_phase', data: {})`

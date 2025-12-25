### Final Video Assembly Phase

**REQUIRED CONTEXT**: Use the registered scenes with their approved videos from `read_project`.
Each scene has a videoArtifactId pointing to the approved video clip.
DO NOT re-read earlier phase outputs - use the approved scene data and video artifacts.

Combine all scene video clips into the final video.

1. Get all scenes from `read_project` (scenes array with videoArtifactId)
2. Verify all scenes have videoArtifactId
3. Present the assembly plan to the user showing the scene order
4. After approval, use `stitch_videos` to combine all clips in scene order
5. Wait for the stitching job to complete
6. Update project with final video info using `update_project` action: 'set_final_video'

The final video will:
- Combine all scene clips in order
- Include any transitions specified
- Be saved to the assets directory

After completion:
1. Present the final video location to the user
2. Offer to help with any adjustments

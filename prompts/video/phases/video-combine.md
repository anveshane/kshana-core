### Final Video Assembly Phase

Combine all scene video clips into the final video.

1. Read project to get all scene video artifact IDs
2. Verify all scenes have videoArtifactId
3. Present the assembly plan to the user
4. After approval, use `stitch_videos` to combine all clips
5. Wait for the stitching job to complete
6. Update project with final video info using `update_project` action: 'set_final_video'

The final video will:
- Combine all scene clips in order
- Include any transitions specified
- Be saved to the assets directory

After completion:
1. Present the final video location to the user
2. Offer to help with any adjustments

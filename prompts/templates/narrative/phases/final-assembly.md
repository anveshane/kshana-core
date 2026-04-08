# Final Assembly Phase

This phase assembles all scene videos into the final narrative video.

## Phase Goal

Stitch all approved scene videos together into a cohesive final video with proper transitions.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Scene videos are tracked in `project.json` under the scenes array with their `videoArtifactId` properties. The scene order is determined by the `sceneNumber` field.

## Artifacts in This Phase

- **Final Video**: The complete assembled narrative video

## Assembly Process

### Step 1: Validate timeline (ALWAYS do this first)
Call `manage_timeline` with action `validate`. Review the `fileResolution` field in the response:
- `resolvedCount` — how many segments have actual files on disk
- `videoCount` / `imageCount` — breakdown by media type
- `errors` — segments that could not be resolved to any file

### Step 2: Check readiness
If there are resolution errors OR image-only segments (invalid for anime/cinematic styles):
- **STOP — do not attempt assembly**
- Report the specific segment IDs that are missing videos
- This phase does NOT have video generation tools — the orchestrator must re-plan and return to the video generation phase to create missing clips

### Step 3: Assemble (only when all segments have videos)
Call `assemble_from_timeline` to assemble the final video. This resolves file paths, validates style requirements, chooses the session-appropriate assembly path, and only reports success after the final artifact is persisted.

### Step 4: Review result
Check the returned `output_path`, `duration`, `file_size`, and any `warnings`.

## Transition Guidelines

### Transition Types
- **Cut**: Direct cut for immediate scene changes
- **Fade**: Fade to black/white for time passage or dramatic moments
- **Cross-dissolve**: Gentle transition for related scenes
- **Match cut**: When visual elements align between scenes

### When to Use Each
- **Action sequences**: Quick cuts
- **Time jumps**: Fades
- **Same location**: Cross-dissolves
- **Emotional beats**: Longer holds or fades

## Pacing Considerations

- Opening should draw viewers in
- Build tension through the middle
- Climax should be properly emphasized
- Ending should have appropriate resolution time

## Audio Considerations

Note: If the project includes audio/music:
- Ensure video timing aligns with audio beats
- Transitions should feel musical
- Important moments should sync with audio cues

## Final Review

Before completing:
1. Watch the entire video through
2. Check all transitions are smooth
3. Verify scene order matches the story
4. Ensure pacing feels right
5. Present to user for final approval

## After Successful Assembly

When `assemble_from_timeline` returns `success: true`:
- The final video asset has been persisted and registered in the manifest
- The VIDEO_COMBINE phase is automatically marked as completed
- The project's `finalVideo` field is set with the artifact ID, path, and duration
- Present the result to the user: output path, duration, file size

## User Approval

The final video requires user approval:
1. Present the assembled video details (path, duration, size)
2. Ask the user to review and approve

## Quality Criteria

Before completing this phase:
- [ ] All scene videos are included
- [ ] Scenes are in correct story order
- [ ] Final video is exported successfully
- [ ] User has approved the final video

# Final Assembly Phase

This phase assembles all clips into the final YouTube Short.

## Phase Goal

Create a polished, engaging Short ready for upload.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

The script is at `plans/script.md`. Visual clips are tracked in `project.json` with their artifact IDs.

## Artifacts in This Phase

- **Final Short**: The complete assembled video

## Assembly Process

### Step 1: Validate timeline (ALWAYS do this first)
Call `manage_timeline` with action `validate`. Review the `fileResolution` field for resolution errors or image-only segments.

### Step 2: Check readiness
If there are resolution errors or image-only segments:
- **STOP — do not attempt assembly**
- Report the specific missing segment IDs — this phase does NOT have video generation tools
- The orchestrator must re-plan and return to clip generation

### Step 3: Assemble (only when all segments have videos)
Call `assemble_from_timeline` to run FFmpeg concat and produce the final video.

### Step 4: Duration Check
- Verify under 60 seconds from the returned duration
- If over 60 seconds, trim segments and re-assemble

## Short-Form Assembly Best Practices

### The Hook
- First visual must grab
- No slow intros
- Immediate engagement

### Pacing
- Faster than you think
- Variety in shot length
- Build to key moments

### Ending
- Clear resolution OR
- Perfect loop point
- No awkward trailing

## Final Checks

### Technical
- 9:16 aspect ratio
- High quality output
- Clean audio (if any)

### Engagement
- Hook works instantly
- Middle delivers value
- End is satisfying

### Platform Ready
- Works on mute (text visible)
- Mobile optimized
- Thumbnail from strong frame

## After Successful Assembly

When `assemble_from_timeline` returns `success: true`, the final video asset is automatically registered and the phase is marked completed. Present the result to the user.

## Quality Criteria

Before completing this phase:
- [ ] Under 60 seconds
- [ ] Hook in first 3 seconds
- [ ] Final video exported successfully
- [ ] User has approved

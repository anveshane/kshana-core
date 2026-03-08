# Final Assembly Phase

This phase assembles all segment videos into the final documentary.

## Phase Goal

Create a cohesive final documentary video with proper flow and transitions.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Segment videos are tracked in `project.json` with their artifact IDs. The documentary structure is at `plans/outline.md`.

## Artifacts in This Phase

- **Final Documentary**: The complete assembled video

## Assembly Process

### Step 1: Validate timeline (ALWAYS do this first)
Call `manage_timeline` with action `validate`. Review the `fileResolution` field:
- `resolvedCount` — how many segments have actual files on disk
- `videoCount` / `imageCount` — breakdown by media type
- `errors` — segments that could not be resolved to any file

### Step 2: Check readiness
- If there are resolution errors (segments with no file at all): **STOP — report the missing segment IDs**. This phase does NOT have generation tools — the orchestrator must re-plan.
- Image segments ARE allowed for documentary style — they will be converted to static video clips automatically during assembly.

### Step 3: Assemble (only when all segments have files)
Call `assemble_from_timeline` to produce the final video. This tool:
- Resolves all segment file paths (with 3-tier fallback)
- Converts image segments to static video clips (documentary style only)
- Runs FFmpeg concat to produce the final assembled video

### Step 4: Review Result
Check the returned `output_path`, `duration`, `file_size`, and any `warnings`.

## Documentary Assembly Guidelines

### Opening
- Hook viewer immediately
- Establish the topic clearly
- Set the tone for what follows

### Flow
- Each segment should connect naturally
- Build the argument progressively
- Maintain viewer engagement

### Conclusion
- Resolve the thesis
- Provide clear takeaways
- Leave appropriate final impression

## Audio Considerations

Note: If audio is included:
- Sync with narration timing
- Musical transitions where appropriate
- Balance levels across segments

## After Successful Assembly

When `assemble_from_timeline` returns `success: true`, the final video asset is automatically registered and the phase is marked completed. Present the result to the user: output path, duration, file size.

## Quality Criteria

Before completing this phase:
- [ ] All segments included correctly
- [ ] Documentary feels complete
- [ ] User has approved the final video

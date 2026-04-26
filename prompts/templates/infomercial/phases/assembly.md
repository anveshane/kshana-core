# Final Assembly Phase

This phase assembles all clips into the final infomercial.

## Phase Goal

Create a cohesive, persuasive infomercial video.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

The script is at `plans/script.md`. Demo videos are tracked in `project.json` with their artifact IDs.

## Artifacts in This Phase

- **Final Video**: The complete infomercial

## Assembly Process

### Step 1: Validate timeline (ALWAYS do this first)
Call `manage_timeline` with action `validate`. Review the `fileResolution` field for resolution errors or missing files.

### Step 2: Check readiness
If there are resolution errors or image-only segments:
- **STOP — do not attempt assembly**
- Report the specific missing segment IDs — this phase does NOT have video generation tools
- The orchestrator must re-plan and return to clip generation

### Step 3: Assemble (only when all segments have videos)
Call `assemble_from_timeline` to produce the final video via the session-appropriate assembly path.

### Step 4: Review Result
Check the returned `output_path`, `duration`, `file_size`, and any `warnings`. Verify total duration matches target.

## Infomercial Assembly Guidelines

### Opening
- Hook immediately
- Problem resonates
- Transition to solution

### Demos
- Clear introductions
- Full demonstration visible
- Results emphasized

### Flow
- Logical progression
- Building persuasion
- Maintaining interest

### Closing
- Clear CTA
- Easy next step
- Urgency (appropriate)

## Duration Guidelines

- Short form: 30-60 seconds
- Standard: 60-180 seconds
- Long form: 3+ minutes

Match target duration to:
- Platform requirements
- Attention span
- Content complexity

## Final Checklist

### Technical
- Video quality consistent
- Smooth transitions
- Proper duration

### Content
- All demos included
- CTA is clear
- Message is cohesive

### Quality
- Professional standard
- Commercial-ready
- Brand appropriate

## After Successful Assembly

When `assemble_from_timeline` returns `success: true`, the final video has been persisted and registered successfully. Present the result to the user.

## Quality Criteria

Before completing this phase:
- [ ] All content included
- [ ] Duration appropriate
- [ ] Final video exported successfully
- [ ] User has approved

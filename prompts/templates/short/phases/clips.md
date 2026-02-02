# Clip Generation Phase

This phase generates video clips from each visual image.

## Phase Goal

Create dynamic, engaging video clips that bring the visuals to life.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Key visuals are documented in `plans/visuals.md`. Visual images are tracked in `project.json` with their artifact IDs.

## Artifacts in This Phase

- **Visual Clips**: Animated video clips

## Short-Form Video Requirements

### Pacing
- Dynamic and snappy
- No dead time
- Maintains momentum

### Duration
- Each clip: 3-15 seconds
- Total must fit under 60
- Match script timing

### Energy
- High engagement
- Movement creates interest
- Variety in motion types

## Motion Styles for Shorts

### Dynamic Zoom
- Push in/pull out
- Creates drama and focus
- Good for reveals

### Slide/Pan
- Horizontal or vertical movement
- Shows scope
- Creates flow

### Quick Motion
- Fast camera moves
- Matching high-energy content
- Attention-maintaining

### Subtle Life
- Minimal movement
- Breathing room moments
- Text overlay friendly

## Generation Workflow

For each visual image:
1. Review timing and context
2. Determine motion style
3. Set duration target
4. Generate clip
5. Present for approval
6. Allow regeneration

## User Approval

This is an EXPENSIVE phase:
- Show motion plan
- Confirm before generation
- Play clip for review
- Allow refinement

## Quality Criteria

Before completing this phase:
- [ ] All clips generated
- [ ] Timing matches script
- [ ] Motion is engaging
- [ ] No artifacts or glitches
- [ ] Each clip individually approved

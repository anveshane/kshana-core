# Video Generation Phase

This phase generates video clips for each documentary segment.

## Phase Goal

Create animated video clips that bring the static segment images to life.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Segment files are in the `segments/` directory. Segment images are tracked in `project.json` with their artifact IDs.

## Artifacts in This Phase

- **Segment Videos**: Animated clips for each segment

## Documentary Video Style

### Motion Principles
- Subtle, professional movements
- Information-focused rather than entertainment-focused
- Smooth, intentional camera work
- Pacing appropriate to content

### Motion Types

**Ken Burns Effect**
- Slow pan and zoom on images
- Classic documentary technique
- Good for archival or static imagery

**Subtle Animation**
- Minimal movement within frame
- Environmental motion (clouds, water, leaves)
- Breathing life into still images

**Dynamic Sequences**
- More active for action content
- Match the energy of the content
- Still professional and controlled

## Workflow

For each segment image:
1. Review segment content and narration
2. Determine appropriate motion style
3. Plan timing to match narration
4. Generate video clip
5. Present for approval

## Technical Guidelines

### Duration
- Match the segment's narration timing
- Leave room for transitions
- Consider pacing within the documentary

### Quality
- Maintain image clarity
- Smooth, artifact-free motion
- Professional documentary standard

## User Approval

This is an EXPENSIVE phase:
- Show motion plan before generation
- Confirm each generation
- Play video for review
- Allow regeneration with feedback

## Quality Criteria

Before completing this phase:
- [ ] All segment videos approved
- [ ] Motion is appropriate and professional
- [ ] Timing matches segment needs
- [ ] Visual quality maintained
- [ ] Documentary style consistent

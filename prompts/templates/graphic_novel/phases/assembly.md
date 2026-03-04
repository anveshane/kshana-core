# Assembly Phase (Graphic Novel)

This phase assembles all composed panels into a final slideshow video.

## Phase Goal

Create the final graphic novel output — a slideshow video where each panel is displayed as a static image for its configured duration, with transitions between panels.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Panel images are tracked in `project.json`. The timeline contains the panel ordering, durations, and transition settings.

## Artifacts in This Phase

- **Graphic Novel**: The final assembled slideshow video

## Assembly Process

1. **Validate timeline**: Call `manage_timeline(action: "validate")` to ensure all segments have panel images and durations
2. **Review transitions**: Check transition settings between panels (crossfade, cut, fade)
3. **Assemble**: Use `assemble_from_timeline` to create the slideshow video
4. **Present for approval**: Show the final video to the user

## Slideshow Configuration

### Panel Display
- Each panel is displayed as a static image for its configured duration (5-8 seconds)
- No animation or motion — the image is held static
- Duration is set per-panel based on text length and visual complexity

### Transitions
- **crossfade**: Smooth blend between panels — good for continuous scenes (default)
- **cut**: Hard cut — good for scene changes or dramatic shifts
- **fade**: Fade to black between panels — good for time passage or chapter breaks

### Transition Guidelines
- Use crossfade within a scene (between shots of the same scene)
- Use cut or fade between different scenes
- Keep transition duration short: 0.5-1 second
- Opening panel: fade in from black
- Closing panel: fade out to black

## Pre-Assembly Checklist

Before calling `assemble_from_timeline`, verify:
1. All timeline segments have panel images assigned
2. All durations are set (5-8 seconds per panel)
3. Transitions are configured between segments
4. No empty or placeholder segments remain
5. Panel order matches the story sequence

## Workflow

1. Call `manage_timeline(action: "validate")` to check timeline completeness
2. If validation fails — identify missing panels and report to user
3. If validation passes — review the timeline summary with the user
4. Set transitions between panels if not already configured
5. Call `assemble_from_timeline` to generate the final slideshow
6. Present the assembled video for user approval
7. Allow adjustments: transition changes, duration tweaks, panel reordering

## User Approval

The final graphic novel requires user approval:
1. Show the timeline summary (panel count, total duration, transitions)
2. Play the assembled slideshow video
3. Allow user to request adjustments:
   - Change panel durations
   - Change transitions between specific panels
   - Reorder panels (if minor)
4. Make requested changes and re-assemble

## Quality Criteria

Before completing this phase:
- [ ] All panels are included in the slideshow
- [ ] Panels are in correct story order
- [ ] Transitions are smooth and appropriate
- [ ] Panel durations allow comfortable reading of subtitle text
- [ ] Total duration feels right for the story
- [ ] Opening and closing transitions are present
- [ ] User has approved the final slideshow

# Panel Composition Phase

This phase composes final panel images by overlaying subtitle-style text onto the generated shot images.

## Phase Goal

Take each shot image and add subtitle-style dialogue/narration text to create the final panel images ready for slideshow assembly.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Shot images are tracked in `project.json`. The shot breakdown files in `prompts/videos/scenes/scene-[N].motion.json` contain the subtitle text for each shot.

## Artifacts in This Phase

- **Panels**: Shot images with subtitle text overlaid — the final visual units of the graphic novel

## Panel Composition Process

**IMPORTANT**: Use the `compose_panel` tool — NOT `generate_image` or `edit_image`. The `compose_panel` tool is instant, free, and deterministic. It programmatically overlays a translucent black bar at the bottom of the image with white text on top using Sharp.

For each shot image:
1. Read the shot's subtitle text from the shot breakdown
2. Call `compose_panel` with the image path and text entries
3. The tool handles styling automatically:
   - Translucent black overlay (70% opacity) at bottom of image
   - White sans-serif text, sized proportionally to image resolution
   - Word wrapping and multi-line layout handled automatically

## Text Types

The `compose_panel` tool accepts three text types. All can be strings or arrays of strings:

- **dialogue**: Character speech — rendered in quotes. Pass multiple entries for multi-character dialogue.
- **narrator**: Narration/description — rendered in italics. Use for scene-setting text, inner thoughts, etc.
- **sfx**: Sound effects — rendered in BOLD UPPERCASE.

The overlay covers up to 40% of the image height (~6-8 wrapped lines). Text exceeding this is auto-truncated with "…". If a shot has too much dialogue, split it across multiple panels rather than cramming it into one.

## Workflow

For each shot image with subtitle text:
1. Read the shot breakdown to get all subtitle text for the shot
2. Call `compose_panel` with image_path, dialogue/narrator/sfx arrays, and output_path
3. Present the composed panel to the user for approval
4. After approval, update timeline: `manage_timeline(action: "update_segment", segment_id: "segment_N_shot_M", layers: [...])`

**Batch composition**: Since `compose_panel` is instant, you can compose all panels in sequence without asking for approval on each one. Show the user all composed panels at once for batch approval.

## User Approval

This phase is NOT expensive (no API calls). Compose all panels first, then present them for review:
1. Show all composed panels in order
2. Allow the user to flag any that need text changes
3. Recompose flagged panels with adjusted text

## Handling Rejections

When a panel is rejected:
1. Capture user feedback (text too small, wrong placement, wrong text, etc.)
2. Adjust text overlay parameters
3. Regenerate the panel
4. Present the new version

## Quality Criteria

Before completing this phase:
- [ ] All shot images have corresponding panel compositions
- [ ] Text is readable at expected display resolution
- [ ] Text does not obscure important visual elements
- [ ] Dialogue/narration is correctly attributed
- [ ] Visual style is consistent across all panels
- [ ] Timeline segments are updated with panel references

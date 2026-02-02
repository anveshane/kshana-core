# Image Generation Phase

This phase generates images for each key visual.

## Phase Goal

Create visually striking, mobile-optimized images for each key visual.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Key visuals are documented in `plans/visuals.md`. Read it to generate the appropriate images.

## Artifacts in This Phase

- **Visual Images**: Generated images for each visual

## Short-Form Image Requirements

### Format
- Optimized for 9:16 vertical
- High resolution (1080x1920)
- Mobile-first composition

### Visual Impact
- Scroll-stopping quality
- High contrast and clarity
- Clear focal points

### Text-Overlay Ready
- Space for text if needed
- Not too busy in overlay areas
- Works with or without text

## Generation Workflow

For each key visual:
1. Review the visual description
2. Construct vertical-optimized prompt
3. Apply style modifiers
4. Generate image
5. Present for approval
6. Allow regeneration

## Prompt Considerations

### Vertical Composition
- Specify vertical framing
- Center key elements
- Consider safe areas

### Mobile Viewing
- Clear at small sizes
- Not overly detailed
- Strong silhouettes

### Animation Ready
- Consider how it will move
- Leave room for motion
- Avoid elements that won't animate well

## User Approval

This is an EXPENSIVE phase:
- Show prompt before generation
- Confirm each generation
- Display with script context
- Allow refinement

## Quality Criteria

Before completing this phase:
- [ ] All visual images generated
- [ ] Each works in vertical format
- [ ] Mobile-optimized clarity
- [ ] Style is consistent
- [ ] Each image individually approved

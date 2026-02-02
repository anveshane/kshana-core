# Visual Assets Phase

This phase generates all visual assets: source graphics, location images, and segment images.

## Phase Goal

Create professional documentary visuals that support the narrative and maintain consistency.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Sources are in the `sources/` directory, locations in `locations/`, and segments in `segments/`. Read them to generate appropriate visual assets.

## Artifacts in This Phase

- **Source Graphics**: Visual representations of experts/data
- **Location Images**: Establishing shots and b-roll
- **Segment Images**: Key visuals for each segment

## Generation Order

1. **Source Graphics First**: These provide reference for segments
2. **Location Images Second**: Establish the visual environments
3. **Segment Images Last**: Combine elements for final visuals

## Visual Guidelines

### Source Graphics
- Professional, broadcast-quality
- Clear and readable
- Match documentary's visual style
- Appropriate for the source type

### Location Images
- Documentary authenticity
- Atmospheric and contextual
- Wide establishing shots
- Detail shots for b-roll

### Segment Images
- Support the narrative
- Use source/location references
- Capture key moments
- Informative composition

## Workflow

For each visual asset:
1. Review the source material
2. Construct appropriate prompt
3. Apply style modifiers
4. Generate the image
5. Present for approval
6. Allow regeneration if needed

## User Approval

This is an EXPENSIVE phase:
- Show prompts before generation
- Confirm each generation
- Display results for approval
- Allow refinement feedback

## Quality Criteria

Before completing this phase:
- [ ] All source graphics are approved
- [ ] All location images are approved
- [ ] All segment images are approved
- [ ] Visual consistency is maintained
- [ ] Documentary quality standards met

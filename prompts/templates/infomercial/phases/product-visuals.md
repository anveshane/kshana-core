# Product Visuals Phase

This phase generates product shots and demo images.

## Phase Goal

Create professional product imagery and demonstration visuals.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Products are in the `products/` directory. Demo sequences are in `demos/`. Read them to generate product visuals.

## Artifacts in This Phase

- **Product Shots**: Professional product photography
- **Demo Images**: Demonstration visuals

## Generation Order

1. **Product Shots First**: These are references for demos
2. **Demo Images Second**: Use product references for consistency

## Product Shot Guidelines

### Types Needed
- Hero shot (main marketing image)
- Angle shots (show full product)
- Detail shots (key features)

### Quality Standards
- Professional studio quality
- Clean, consistent lighting
- Product is the star
- Brand-appropriate styling

### Consistency
- Same product across all shots
- Consistent color and scale
- Recognizable brand feel

## Demo Image Guidelines

### Requirements
- Product must match product shots
- Action must be clear
- Benefit must be visible
- Professional quality

### Types
- In-use scenarios
- Feature demonstrations
- Before/after (if applicable)
- Result shots

## Workflow

For product shots:
1. Review product description
2. Construct prompt for shot type
3. Generate image
4. Present for approval

For demo images:
1. Review demo sequence
2. Reference product shots
3. Construct demo prompt
4. Generate image
5. Present for approval

## User Approval

This is an EXPENSIVE phase:
- Show prompt before generation
- Confirm each generation
- Display with context
- Allow regeneration

## Quality Criteria

Before completing this phase:
- [ ] All products have hero shots
- [ ] Product shots are consistent
- [ ] All demos have images
- [ ] Demo images match products
- [ ] Professional quality throughout
- [ ] Each image individually approved

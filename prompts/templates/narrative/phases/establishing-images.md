# Establishing Image Generation Phase

This phase generates a wide establishing shot for each scene. These images serve as spatial anchors ensuring all per-shot images within a scene share the same physical environment.

## Phase Goal

Create one establishing image per scene showing the full environment with all characters positioned. These are used as the primary reference (image1) during per-shot image generation to maintain shot-to-shot coherence.

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Scene files are in `chapters/[chapter]/scenes/scene_[N].md`. Character reference images and setting reference images must already exist from the previous phase.

## Artifacts in This Phase

- **Establishing Images**: One wide establishing shot per scene

## Why Establishing Images Matter

Without a shared spatial anchor, each shot's starting image is generated independently. Even with character/setting references, each shot creates a new interpretation of the physical space. When cut together, shots look like different locations.

The establishing image solves this by defining the canonical layout of the scene. Per-shot images are then derived from it, ensuring:
- Consistent room layout, furniture placement, and spatial relationships
- Characters in correct positions relative to each other and the environment
- Matching lighting, color palette, and atmosphere across all shots

## Workflow

For each approved scene:
1. Read the scene description to identify characters, setting, and spatial arrangement
2. Gather character reference images and the setting reference image
3. Count characters in the scene:
   - **1-2 characters**: Single-pass generation (setting as image1, characters as image2/image3)
   - **3+ characters**: Multi-pass generation (see below)
4. Craft a wide establishing shot prompt with explicit spatial positioning
5. Generate the establishing image
6. Present to user for approval
7. Allow regeneration if needed

### Multi-Pass for 3+ Characters

Qwen Edit supports maximum 3 image slots. For scenes with 3+ characters:

**Pass 1**: Generate with setting_ref + characters 1-2
**Pass 2**: Use Pass 1 result as image1 + characters 3-4 as image2/image3

The prompt for Pass 2 must describe where additional characters appear in the existing composition.

## Character Count Guidance

Prefer scenes with 1-2 characters where possible. Scenes with 3+ characters require multi-pass compositing which is slower and may reduce quality. Only use 3+ character scenes when narratively essential.

## User Approval

This is an EXPENSIVE phase. Before generating each image:
1. Show the user the establishing image prompt
2. Confirm they want to proceed with generation
3. Display the generated image
4. Allow approval, rejection, or regeneration request

## Quality Criteria

Before completing this phase:
- [ ] All scenes have approved establishing images
- [ ] Each establishing image shows the full environment with all characters positioned
- [ ] Wide/establishing framing (not close-up or medium)
- [ ] Characters are recognizable (face accuracy from reference images)
- [ ] Spatial layout matches the scene description
- [ ] User has approved all establishing images

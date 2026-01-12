### Image Generation Phase

Generate documentary-style images for each planned placement, **ONE AT A TIME, SEQUENTIALLY**.

**Prerequisites**:
- Image placements must exist at `agent/content/image-placements.md` (created in Image Placement phase)

**CRITICAL WORKFLOW - Execute steps in this exact order:**

**STEP 1: Read the image placements file**

Use `read_file` to get the placements:

```
read_file(file_path: 'agent/content/image-placements.md')
```

The file contains markdown with sections like this:
```markdown
# Image Placement Plan

## Placement 1
*   **Start Time:** 0:08
*   **End Time:** 0:12
*   **Transcript Index:** 1
*   **Image Prompt:** A cinematic depiction of the river Ganga...

## Placement 2
*   **Start Time:** 0:38
*   **End Time:** 0:45
*   **Transcript Index:** 2
*   **Image Prompt:** A photorealistic aerial view...
```

**STEP 2: Process each placement sequentially**

For EACH placement in the file (Placement 1, Placement 2, etc.):

a. Extract the placement number and image prompt from the file:
   - Placement number: The number after "Placement" in the heading (e.g., "Placement 1" = 1)
   - Image prompt: The text after `**Image Prompt:**` in that placement's section

b. Call the image-generator subagent:
```
Task(
  subagent_type: 'image-generator',
  task: 'Generate image for Placement [NUMBER]. Prompt: [paste exact prompt from file]. Use placement number as scene_number.'
)
```

**EXAMPLE for Placement 1:**
If the file shows:
```markdown
## Placement 1
*   **Image Prompt:** A cinematic depiction of the river Ganga descending from the heavens, received by Lord Shiva.
```

Then call:
```
Task(
  subagent_type: 'image-generator',
  task: 'Generate image for Placement 1. Prompt: A cinematic depiction of the river Ganga descending from the heavens, received by Lord Shiva. Use placement number as scene_number.'
)
```

c. **WAIT for the Task to complete** - The subagent will generate the image and return a result. Only after this completes, proceed to the next placement.

d. Move to the next placement - Only after Placement 1 is complete, process Placement 2, then Placement 3, and so on.

**STEP 3: Mark phase complete**

After ALL placements have been processed (all images generated), mark the phase complete:
```
update_project(
  action: 'update_phase',
  data: { phase: 'image_generation', status: 'completed' }
)
```

**DO NOT:**
- Skip reading the file - you MUST read `agent/content/image-placements.md` first
- Process multiple placements at once - work on ONE at a time, sequentially
- Move to the next placement before the current one completes
- Mark the phase complete until ALL placements are processed

**IMPORTANT:**
- **Read the file FIRST** using `read_file(file_path: 'agent/content/image-placements.md')`
- **Process placements SEQUENTIALLY** - Placement 1, wait for completion, then Placement 2, etc.
- **The image-generator subagent handles everything** - it crafts the prompt, calls generate_image, waits for completion, and registers the image
- Generated images are automatically stored in `agent/image-placements/` directory
- Images are automatically registered in the manifest

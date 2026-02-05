### Image Generation Phase

Generate images for each placement identified in the previous phase.

## ComfyUI Availability Check

**CRITICAL: Check the `$comfyui_available` context variable first!**

**If ComfyUI is UNAVAILABLE** (context shows "Unavailable"):
1. **Inform the user**: "ComfyUI is currently unavailable (connection failed). Skipping image generation for this phase."
2. **Explain**: "The workflow will continue to the INFOGRAPHICS_PLACEMENT phase. Images can be generated later when ComfyUI is reconnected."
3. **Mark phase complete and transition**:
   ```
   update_project(
     action: 'update_phase',
     data: { phase: 'image_generation', status: 'completed' }
   )
   ```
   Then:
   ```
   update_project(
     action: 'transition_phase',
     data: {}
   )
   ```
4. **DO NOT** attempt to call `generate_all_images` or `generate_image` tools - they will not be available

**If ComfyUI is AVAILABLE** (context shows "Available"):
- Proceed normally with the image generation workflow below

---

## Normal Image Generation Workflow (when ComfyUI Available)

**SIMPLE WORKFLOW:**
1. Call the `generate_all_images` tool to process all placements automatically
2. The tool will:
   - Read and parse `agent/content/image-placements.md`
   - Extract all placements (Placement 1, 2, 3, etc.)
   - **Optionally expand each placement prompt** with an LLM (image-generator–style, using placement + transcript segment + content plan) into a detailed ComfyUI-ready prompt. Expansion runs by default; use `expand_prompts: false` to skip.
   - Generate images sequentially, one at a time
   - Wait for each image to complete before moving to the next
   - Continue even if some images fail (logs failures but doesn't stop)
   - Return a summary of successful and failed placements
3. After the tool completes, mark phase complete and STOP

**NEVER:**
- Manually parse the image-placements.md file
- Call `Task` with image-generator subagent for individual placements
- Call `generate_image` directly
- Create todos
- Call `update_image_placement` manually
- Generate more images than placements in the file

**STEP 1: Call generate_all_images tool**

Simply call the `generate_all_images` tool. It handles everything automatically:

```
generate_all_images(
  file_path: 'agent/content/image-placements.md'
)
```

The tool will:
- Read and parse the image-placements.md file
- Extract all placement entries (Placement 1, 2, 3, etc.)
- Expand each placement prompt with LLM (image-generator guidelines) when `expand_prompts` is true (default). Use `expand_prompts: false` to use placement prompts as-is.
- Generate images sequentially, one at a time
- Wait for each image to complete before moving to the next
- Continue even if some images fail (logs failures but doesn't stop)
- Return a summary with successful and failed placements

**WAIT for the tool to complete** - It will process ALL placements before returning.

**STEP 2: Check results and mark phase complete**

After the `generate_all_images` tool completes:

1. **Check the result summary** - The tool returns:
   - `total_placements`: Total number of placements found
   - `successful`: Number of successfully generated images
   - `failed`: Number of failed image generations
   - `results`: Array with details for each placement

2. **Mark the phase complete:**
```
update_project(
  action: 'update_phase',
  data: { phase: 'image_generation', status: 'completed' }
)
```

3. **Transition to next phase:**
```
update_project(
  action: 'transition_phase',
  data: {}
)
```

**DO NOT:**
- Manually parse the image-placements.md file
- Call `Task` with image-generator subagent for individual placements
- Call `generate_image` directly
- Call `update_image_placement` manually
- Create todos or task lists
- Try to manage image placement state manually
- Retry failed placements manually
- Skip marking phase as completed or transitioning to the next phase

**IMPORTANT:**
- **Use the `generate_all_images` tool** - It handles all parsing, optional prompt expansion (image-generator–style), sequential generation, and error handling
- **The tool processes ALL placements automatically** - No need to count or iterate manually
- **Sequential execution is guaranteed** - The tool enforces one-at-a-time generation in code
- **Failed placements are logged but don't stop the process** - The tool continues with remaining placements
- **After the tool completes** - Mark phase complete and transition to the next phase.
- Generated images are automatically stored in `agent/image-placements/` directory
- Images are automatically registered in the manifest

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
1. Call `generate_all_images` in background mode (default)
2. It returns immediately with `status: "queued"` and `batch_id`
3. The tool auto-completes `image_generation` and auto-transitions to the next phase when invoked from this phase
4. The user should immediately see that image generation is running in background
5. The user will receive a completion/failure notification when the batch reaches terminal state
6. Use `read_background_generation` in later phases when you need status

**NEVER:**
- Manually parse the image-placements.md file
- Call `Task` with image-generator subagent for individual placements
- Call `generate_image` directly
- Create todos
- Call `update_image_placement` manually
- Generate more images than placements in the file

**STEP 1: Queue background image generation**

Call:

```
generate_all_images(
  file_path: 'agent/content/image-placements.md',
  expand_prompts: true,
  run_in_background: true
)
```

The tool will:
- Read and parse the image-placements.md file
- Extract all placement entries (Placement 1, 2, 3, etc.)
- Expand each placement prompt with LLM when `expand_prompts` is true
- Create a persistent background batch and start sequential generation
- Return immediately with `status`, `batch_id`, and `total_placements`

**Do NOT wait for completion in this phase.**
**Do NOT claim all images/videos are fully generated just because queueing succeeded.**

**STEP 2: Continue immediately**

1. Do not wait for image completion.
2. Do not manually call `update_project(update_phase=image_generation completed)` after a successful queue.
3. Do not manually call `update_project(transition_phase)` after a successful queue.
4. Continue with the next phase while images render in background.
5. If tool response shows `transitioned: false`, then manually complete + transition once:
```
update_project(
  action: 'update_phase',
  data: { phase: 'image_generation', status: 'completed' }
)
```
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
- Call a second manual transition after the tool already transitioned

**IMPORTANT:**
- **Use `generate_all_images` with background mode**
- **Queue and continue immediately**
- **Use `read_background_generation` to inspect progress/failures later**
- **Retry failed placements only via `generate_all_images(retry_failed_batch_id: "...", run_in_background: true)`**
- **Do not claim full media completion while any background batch is queued/running/failed**
- Generated images are automatically stored in `agent/image-placements/` directory
- Images are automatically registered in the manifest

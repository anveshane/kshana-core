### Image Placement Phase

**What this phase does**: Identify moments from the transcript that need images and create detailed image placements with exact timestamps and enhanced image prompts. Create as many image placements as needed based on transcript content.

**Prerequisites**:
- Content plan must exist at `agent/plans/content-plan.md` (created in Planning phase)
- `$transcript` context variable must exist
- `$content_plan` context variable must exist
- `agent/content/transcript.md` file must exist

**Steps (execute in order)**:

1. **Verify prerequisites exist**:
   - Check that `agent/plans/content-plan.md` exists (contains strategic guidance)
   - Check that `agent/content/transcript.md` exists (contains the transcript with timestamps)
   - Verify `$transcript` and `$content_plan` context variables are available

2. **Call the image placer subagent**:
```
Task(
  subagent_type: 'image-placer',
  task: 'Analyze the transcript ($transcript) to identify key moments that need IMAGES (static visuals). Use the content plan ($content_plan) for strategic guidance only. Create detailed image placement plan with exact timestamps and enhanced image prompts. Create placements ONLY for moments that truly need static images (book covers, objects, scenes, portraits) - skip moments that need video (any action words like grabbing, placing, watering, clipping, opening, closing, moving). If a transcript segment is longer than 10-12 seconds, split it into multiple image placements. Aim for 5-8 second image placements to keep visuals dynamic. Create background images for segments likely to receive infographic overlays (subtle, low-text backgrounds). Leave gaps for videos ONLY for action/demonstration/process segments. Video-placer will fill remaining segments with videos.',
  context_refs: ['$transcript', '$content_plan']
)
```

3. **Extract and save the image placements**:
   - The Task result structure is: `{ status: 'completed', output: '<image placements text>', task: '...', iterations: 1 }`
   - **The image placements text is in `result.output`** - extract this field
   - Save it to `agent/content/image-placements.md`:
```
write_file(
  file_path: 'agent/content/image-placements.md',
  content: '[use result.output from the Task result - this contains the image placements]'
)
```
   - The file will be automatically loaded as `$image_placements` context variable after saving

4. **Mark phase as completed and transition to Image Generation**:
```
update_project(
  action: 'update_phase',
  data: { phase: 'image_placement', status: 'completed' }
)
```
   - After marking the phase complete, automatically transition to the next phase:
```
update_project(
  action: 'transition_phase'
)
```

**IMPORTANT:**
- This phase creates actual IMAGE PLACEMENTS (not just a plan)
- The image-placer identifies moments from the transcript itself (not from a list in the plan)
- The content plan provides strategic guidance only (high-level visual strategy)
- Image placements are saved to `agent/content/image-placements.md`
- Create as many image placements as needed based on transcript content
- **CRITICAL: Create placements ONLY for moments that truly need IMAGES (static visuals) - skip moments that need video (action, demonstrations, processes)**
- **CRITICAL: Leave gaps for videos ONLY for action/demonstration/process segments. Otherwise increase image coverage.**
- **CRITICAL: Split long segments into multiple placements - if a transcript segment is longer than 10-12 seconds, create multiple image placements. Aim for 5-8 second image placements to keep visuals dynamic**
- **CRITICAL: If a prompt describes ACTION (grabbing, placing, watering, clipping, opening, closing, moving), it should be VIDEO, not an image - skip these moments**

**DO NOT:**
- Create infographic content here (infographics are handled separately); **do** create image backgrounds for those segments
- Create charts, diagrams, or data visualizations as images; keep backgrounds subtle
- Skip saving the placements - you MUST save to the file
- Skip transition to image generation - you MUST transition after marking phase complete
- Try to cover everything - leave gaps ONLY for action/demonstration video needs

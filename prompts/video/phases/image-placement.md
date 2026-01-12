### Image Placement Phase

**What this phase does**: Identify moments from the transcript that need images and create detailed image placements with exact timestamps and enhanced image prompts.

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
  task: 'Analyze the transcript ($transcript) to identify 5-6 key moments that need images. Use the content plan ($content_plan) for strategic guidance only. Create detailed image placement plan with exact timestamps and enhanced image prompts. Only create placements for moments that need images (skip infographics, video segments, ad breaks). Create exactly 5-6 placements total, no more, no less.',
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
- Create exactly 5-6 placements total (one per key moment that needs an image)

**DO NOT:**
- Create placements for infographics (those are handled separately)
- Create placements for video segments or ad breaks (those stay as original footage)
- Create more than 5-6 placements (be selective about which moments truly need images)
- Skip saving the placements - you MUST save to the file
- Skip transition to image generation - you MUST transition after marking phase complete

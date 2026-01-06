### Image Placement Phase

**What this phase does**: Create detailed image placements with exact timestamps and enhanced image prompts based on the content plan.

**Prerequisites**:
- Content plan must exist at `agent/plans/content-plan.md` (created in Planning phase)
- `$transcript` context variable must exist
- `$content_plan` context variable must exist
- `agent/content/transcript.md` file must exist

**Steps (execute in order)**:

1. **Call the image placer subagent**:
```
Task(
  subagent_type: 'image-placer',
  task: 'Create detailed image placement plan with exact timestamps and enhanced image prompts. Use the content plan ($content_plan) to identify which moments need visuals. Only create placements for items marked as image or infographic; skip video items.',
  context_refs: ['$transcript', '$content_plan']
)
```

2. **Extract and save the image placements**:
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

3. **Mark phase as completed**:
```
update_project(
  action: 'update_phase',
  data: { phase: 'image_placement', status: 'completed' }
)
```

4. **Transition to next phase (Image Generation)**:
```
update_project(
  action: 'transition_phase'
)
```

**IMPORTANT:**
- This phase creates actual IMAGE PLACEMENTS (not just a plan)
- Image placements are saved to `agent/content/image-placements.md`
- The content plan from Planning phase is used as reference, but this phase creates the actual placements

**DO NOT:**
- Create placements for video items (those stay as original footage)
- Skip saving the placements - you MUST save to the file
- Stop after just saving - you MUST mark phase complete and transition

### Image Placement Phase

**IMPORTANT: This phase runs AFTER the Planning phase has created a content plan.**

**Prerequisites:**
- Content plan must exist at `agent/plans/content-plan.md` (created in Planning phase)
- `$transcript` context variable must exist
- `agent/content/transcript.md` file must exist

**Steps:**
1. Read the content plan from `agent/plans/content-plan.md`:
```
read_file(
  file_path: 'agent/plans/content-plan.md'
)
```

2. Call the image placer subagent to create detailed image placements:
```
Task(
  subagent_type: 'image-placer',
  task: 'Create detailed image placement plan with exact timestamps and enhanced image prompts. Use the content plan ($content_plan) to identify which moments need visuals. Only create placements for items marked as image or infographic; skip video items.',
  context_refs: ['$transcript', '$content_plan']
)
```

3. Save the image placements to `agent/content/image-placements.md` using `write_placement_plan`:
```
write_placement_plan(
  content: '[image placements from image-placer subagent]'
)
```
This will be loaded into context as `$image_placements` for the next phase.

4. Generate an SRT file with image tags and write it to `agent/script/subtitles_with_images.srt`:
```
write_srt_with_images(
  placements: [array of placement objects from image-placer]
)
```

5. Update the project to mark image-placement phase as completed:
```
update_project(
  action: 'update_phase',
  data: { phase: 'image_placement', status: 'completed' }
)
```

6. Transition to the next phase (Image Generation):
```
update_project(
  action: 'transition_phase'
)
```

**IMPORTANT:**
- This phase creates actual IMAGE PLACEMENTS (not just a plan)
- Image placements are saved to `agent/content/image-placements.md`
- The content plan from Planning phase is used as reference, but this phase creates the actual placements

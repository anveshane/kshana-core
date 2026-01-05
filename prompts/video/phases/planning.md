### Planning Phase

**IMPORTANT: This phase runs AFTER transcript parsing is complete. You MUST have `$transcript` context available before proceeding.**

**Prerequisites:**
- Transcript must be parsed in TRANSCRIPT_INPUT phase first
- `$transcript` context variable must exist
- `agent/content/transcript.md` file must exist

**If `$transcript` is not available, go back to TRANSCRIPT_INPUT phase and parse the transcript first.**

**CRITICAL: This is a YouTube workflow. DO NOT generate articles, stories, or any creative content. Only create a CONTENT PLAN for visual placements.**

**Steps (MUST be done in this exact order):**
1. **FIRST**: Call the content planner subagent (uses content-planner.md):
```
Task(
  subagent_type: 'placement-planner',
  task: 'Create a comprehensive visual placement plan across the entire transcript. Plan for ALL upcoming phases: images, infographics, and videos.',
  context_refs: ['$transcript']
)
```

2. **CRITICAL**: The Task will return a result object. The content plan text is in `result.output` field. Extract it and save to `agent/plans/content-plan.md`:
```
write_file(
  file_path: 'agent/plans/content-plan.md',
  content: '[use result.output from the Task result - this contains the plain text content plan]'
)
```

**IMPORTANT**: 
- The Task result structure is: `{ status: 'completed', output: '<content plan text>', task: '...', iterations: 1 }`
- **The content plan text is in `result.output`** - extract this field
- The placement-planner subagent outputs plain text in the format specified in content-planner.md (PLACEMENT_COUNT and PLACEMENTS list)
- **Save it ONCE to `agent/plans/content-plan.md` - do NOT save duplicates**
- **DO NOT save the entire result object - only save `result.output` which contains the actual plan text**
- The file will be automatically loaded as `$content_plan` context variable after saving

3. **AFTER saving the content plan**, update the project to mark planning phase as completed:
```
update_project(
  action: 'update_planner_stage',
  data: { phase: 'planning', stage: 'complete' }
)
```

4. **IMMEDIATELY AFTER** marking the stage complete, transition to the next phase (Image Placement):
```
update_project(
  action: 'transition_phase',
  data: { next_phase: 'image_placement' }
)
```

**CRITICAL**: You MUST call both update_planner_stage and transition_phase in sequence. Do NOT stop after just saving the file.

**IMPORTANT:**
- This phase creates a CONTENT PLAN (not image placements yet)
- The content plan identifies key moments that need visuals
- The IMAGE_PLACEMENT phase will use this content plan to create actual image placements
- Image placements will be saved to `agent/content/image-placements.md` in the IMAGE_PLACEMENT phase

**DO NOT:**
- Call `generate_content` with any content_type (no articles, stories, etc.)
- Create image placements here (that's done in IMAGE_PLACEMENT phase)
- Generate any creative content - only create the content plan

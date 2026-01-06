### Planning Phase

**What this phase does**: Create a strategic workflow plan for ALL upcoming visual phases (IMAGE_PLACEMENT, IMAGE_GENERATION, VIDEO_REPLACEMENT, VIDEO_COMBINE). This plan identifies which moments need visuals and what type (images, infographics, or videos), similar to a project execution plan.

**Prerequisites**:
- Transcript must be parsed in TRANSCRIPT_INPUT phase first
- `$transcript` context variable must exist
- `agent/content/transcript.md` file must exist

**If `$transcript` is not available, go back to TRANSCRIPT_INPUT phase and parse the transcript first.**

**CRITICAL: This is a YouTube workflow. DO NOT generate articles, stories, or any creative content. Only create a STRATEGIC CONTENT PLAN that plans for all upcoming phases.**

**Steps (execute in order)**:

1. **Call the content planner subagent**:
```
Task(
  subagent_type: 'content-planner',
  task: 'Create a strategic workflow plan for ALL upcoming phases: IMAGE_PLACEMENT, IMAGE_GENERATION, VIDEO_REPLACEMENT, VIDEO_COMBINE. Identify which moments need visuals (images, infographics, or videos) and plan the execution strategy. This is a high-level strategic planning phase - do not create detailed image prompts.',
  context_refs: ['$transcript']
)
```

2. **Extract and save the content plan**:
   - The Task result structure is: `{ status: 'completed', output: '<content plan text>', task: '...', iterations: 1 }`
   - **The content plan text is in `result.output`** - extract this field
   - **CRITICAL: You MUST use `write_file` to save the content plan to a file. DO NOT use `store_context` - that only stores it in memory and does NOT create a file.**
   - Save it to `agent/plans/content-plan.md` using `write_file`:
```
write_file(
  file_path: 'agent/plans/content-plan.md',
  content: '[use result.output from the Task result - this contains the plain text content plan]'
)
```
   - **After saving with `write_file`, the file will be automatically loaded as `$content_plan` context variable**
   - **VERIFY: The file `agent/plans/content-plan.md` must exist before proceeding to step 3. If it doesn't exist, the phase is NOT complete.**

3. **Mark phase as completed**:
```
update_project(
  action: 'update_phase',
  data: { phase: 'planning', status: 'completed' }
)
```

4. **Transition to next phase (Image Placement)**:
```
update_project(
  action: 'transition_phase'
)
```

**IMPORTANT:**
- This phase creates a STRATEGIC WORKFLOW PLAN (like a project execution plan)
- The content plan identifies key moments that need visuals and plans for ALL upcoming phases
- The plan covers: IMAGE_PLACEMENT, IMAGE_GENERATION, VIDEO_REPLACEMENT, VIDEO_COMBINE
- The IMAGE_PLACEMENT phase will use this strategic plan to create detailed image placements

**DO NOT:**
- Use `store_context` to save the content plan - you MUST use `write_file` to save it to `agent/plans/content-plan.md`
- Call `generate_content` with any content_type (no articles, stories, etc.)
- Create image placements here (that's done in IMAGE_PLACEMENT phase)
- Generate any creative content - only create the content plan
- Skip saving the file - you MUST save it using `write_file` before marking the phase complete

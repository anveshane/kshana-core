### Planning Phase

**What this phase does**: Create a strategic workflow plan for ALL upcoming visual phases (IMAGE_PLACEMENT, IMAGE_GENERATION, VIDEO_REPLACEMENT, VIDEO_COMBINE). This plan identifies which moments need visuals and what type (images, infographics, or videos), similar to a project execution plan.

**Prerequisites**:
- Transcript must be parsed in TRANSCRIPT_INPUT phase first
- `agent/content/transcript.md` file must exist

**IMPORTANT: Before starting, check if the transcript file exists:**
1. **First, read the transcript file** to verify it exists:
```
read_file(file_path: 'agent/content/transcript.md')
```
2. **If the file exists**, use it directly in the Task context_refs or read its content
3. **If `$transcript` context variable is not available**, you can still use the transcript by:
   - Reading the file: `read_file(file_path: 'agent/content/transcript.md')`
   - Or using it in Task context_refs: The Task tool will automatically resolve `agent/content/transcript.md` when referenced

**CRITICAL: This is a YouTube workflow. DO NOT generate articles, stories, or any creative content. Only create a STRATEGIC CONTENT PLAN that plans for all upcoming phases.**
**CRITICAL: Do NOT call Task with subagent_type="Plan" or write to master-plan.md. Use the content-planner subagent only.**

**CRITICAL WORKFLOW: You MUST complete steps 1-4 in order BEFORE attempting step 5 (transition). The system will block transitions if the phase is not marked as "completed".**

**Steps (execute in order - DO NOT skip any step):**

1. **Read the transcript file first** (if not already loaded):
```
read_file(file_path: 'agent/content/transcript.md')
```
   - This ensures you have the transcript content before calling the subagent
   - The transcript file should exist from the TRANSCRIPT_INPUT phase

2. **Call the content planner subagent**:
```
Task(
  subagent_type: 'content-planner',
  task: 'Create a strategic workflow plan for ALL upcoming phases: IMAGE_PLACEMENT, IMAGE_GENERATION, VIDEO_REPLACEMENT, VIDEO_COMBINE. Identify which moments need visuals (images, infographics, or videos) and plan the execution strategy. This is a high-level strategic planning phase - do not create detailed image prompts.',
  context_refs: ['$transcript']  // If $transcript exists, use it. Otherwise, the Task tool will resolve 'agent/content/transcript.md' automatically
)
```

3. **Extract and save the content plan**:
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

4. **Mark phase as completed** (REQUIRED - do not skip this step):
```
update_project(
  action: 'update_phase',
  data: { phase: 'content_planning', status: 'completed' }
)
```
   - **CRITICAL**: You MUST mark the phase as "completed" before attempting to transition
   - Use phase name 'content_planning' (not 'planning')
   - **DO NOT attempt step 5 until step 4 succeeds**

5. **Transition to next phase (Image Placement)** - ONLY after step 4 succeeds:
```
update_project(
  action: 'transition_phase'
)
```
   - **Only call this AFTER the phase is marked as "completed" in step 4**
   - If transition fails, check that step 4 was successful first

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

### Video Placement Phase

**What this phase does**: Identify moments from the transcript that need AI-generated videos and create detailed video placements with exact timestamps and enhanced video prompts. Videos complement images by appearing in different time segments. **The goal is to cover the ENTIRE transcript duration with placements (images + videos), with no gaps.**

**Prerequisites**:
- Content plan must exist at `agent/plans/content-plan.md` (created in Planning phase)
- Image placements must exist at `agent/content/image-placements.md` (created in Image Placement phase)
- `$transcript` context variable must exist
- `$content_plan` context variable must exist
- `$image_placements` context variable must exist (to avoid timestamp collisions)
- `agent/content/transcript.md` file must exist

**Steps (execute in order)**:

1. **Verify prerequisites exist**:
   - Check that `agent/plans/content-plan.md` exists (contains strategic guidance)
   - Check that `agent/content/image-placements.md` exists (to avoid timestamp collisions)
   - Check that `agent/content/transcript.md` exists (contains the transcript with timestamps)
   - Verify `$transcript`, `$content_plan`, and `$image_placements` context variables are available

2. **Call the video placer subagent**:
```
Task(
  subagent_type: 'video-placer',
  task: 'Analyze the transcript ($transcript) to identify moments that need AI-generated videos. Check $image_placements to see what is already covered and fill ALL remaining gaps. Use the content plan ($content_plan) for strategic guidance only. Create detailed video placement plan with exact timestamps, video types (cinematic_realism/stock_footage - AVOID motion_graphics, use stock_footage or cinematic_realism instead), and enhanced video prompts emphasizing cinematic realism style (not animation/infographic style). CRITICAL: Video duration MUST NOT exceed 10 seconds - this is a hard limit due to hardware constraints. If transcript segments are longer than 10 seconds, split them into multiple placements or adjust timestamps. The goal is to cover the ENTIRE transcript duration with placements (images + videos), with no gaps. Create as many placements as needed to fill all remaining segments.',
  context_refs: ['$transcript', '$content_plan', '$image_placements']
)
```

3. **Extract and save the video placements**:
   - The Task result structure is: `{ status: 'completed', output: '<video placements text>', task: '...', iterations: 1 }`
   - **The video placements text is in `result.output`** - extract this field
   - **VALIDATE the output format**:
     - The output MUST start with `VIDEO_PLACER:`
     - If the output contains planning comments, tool_code, or thinking before `VIDEO_PLACER:`, extract ONLY the section starting from `VIDEO_PLACER:` onwards
     - If the output contains text after the placements, remove everything after the last placement line
     - The final content should start with `VIDEO_PLACER:` and contain ONLY placement lines
   - Save it to `agent/content/video-placements.md`:
```
write_file(
  file_path: 'agent/content/video-placements.md',
  content: '[use result.output from the Task result, but extract ONLY the VIDEO_PLACER section if planning comments are present]'
)
```
   - **VERIFY the saved file**:
     - Read the file back to confirm it starts with `VIDEO_PLACER:`
     - Confirm it contains only placement lines in the format: `- Placement N: startTime-endTime | type=video_type | prompt | filename.mp4`
   - The file will be automatically loaded as `$video_placements` context variable after saving

4. **CRITICAL: Validate placement coverage**:
   - Read `agent/content/image-placements.md` and `agent/content/video-placements.md`
   - Read `agent/content/transcript.md` to get the total transcript duration
   - **Check that image placements + video placements together cover the ENTIRE transcript duration with NO GAPS**
   - **If gaps are found**:
     - Identify the exact time ranges that are not covered
     - Call the video-placer again with a specific task to fill those gaps:
     ```
     Task(
       subagent_type: 'video-placer',
       task: 'CRITICAL: There are gaps in placement coverage. The following time segments are NOT covered by any placement: [list the gaps]. You MUST create video placements to fill these gaps. Check $image_placements to avoid overlaps. Create placements for these specific time ranges to ensure 100% coverage.',
       context_refs: ['$transcript', '$content_plan', '$image_placements', '$video_placements']
     )
     ```
     - Extract and save the additional placements
     - Re-validate until coverage is complete
   - **If overlaps are found**:
     - Identify which placements overlap
     - Adjust timestamps to eliminate overlaps (prefer keeping image placements and adjusting video placements)
     - Re-save the files
   - **DO NOT proceed to the next phase until validation passes - all gaps must be filled**

5. **Mark phase as completed and transition to Video Generation**:
```
update_project(
  action: 'update_phase',
  data: { phase: 'video_placement', status: 'completed' }
)
```
   - After marking the phase complete, automatically transition to the next phase:
```
update_project(
  action: 'transition_phase'
)
```

**IMPORTANT:**
- This phase creates actual VIDEO PLACEMENTS (not just a plan)
- The video-placer identifies moments from the transcript itself (not from a list in the plan)
- The content plan provides strategic guidance only (high-level visual strategy)
- **CRITICAL: Check `$image_placements` and DO NOT create video placements that overlap with image placement timestamps**
- **CRITICAL: Videos complement images - they appear in DIFFERENT time segments**
- **CRITICAL: Video duration MUST NOT exceed 10 seconds - this is a hard limit due to hardware constraints. If transcript segments are longer than 10 seconds, split them into multiple placements or adjust timestamps to stay within the 10-second limit.**
- Video placements are saved to `agent/content/video-placements.md`
- Create placements to cover all remaining transcript segments not covered by images. Ensure 100% coverage with no gaps.
- Each placement must specify video type: cinematic_realism or stock_footage (AVOID motion_graphics - use stock_footage or cinematic_realism instead)

**DO NOT:**
- Create placements that overlap with image placement timestamps
- Create placements for images (those are handled in Image Placement phase)
- Leave any gaps in the transcript timeline - fill ALL remaining segments to ensure complete coverage
- Skip saving the placements - you MUST save to the file
- Skip validation - you MUST verify the output format AND coverage before saving
- Skip coverage validation - you MUST check for gaps and overlaps before proceeding
- Save planning comments or thinking - extract ONLY the VIDEO_PLACER section
- Skip transition to video generation - you MUST transition after marking phase complete
- Proceed if gaps are found - you MUST fill all gaps before marking phase complete

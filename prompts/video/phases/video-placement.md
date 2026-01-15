### Video Placement Phase

**What this phase does**: Identify moments from the transcript that need AI-generated videos and create detailed video placements with exact timestamps and enhanced video prompts. Videos complement images by appearing in different time segments.

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
  task: 'Analyze the transcript ($transcript) to identify 1-2 key moments that need AI-generated videos. Check $image_placements to AVOID timestamp collisions. Use the content plan ($content_plan) for strategic guidance only. Create detailed video placement plan with exact timestamps, video types (animation/stock_footage/motion_graphics), and enhanced video prompts. Only create placements for moments that need videos (skip images, ad breaks, transitions). Create exactly 1-2 placements total, no more, no less.',
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

4. **Mark phase as completed and transition to Video Generation**:
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
- Video placements are saved to `agent/content/video-placements.md`
- Create exactly 1-2 placements total (one per key moment that needs a video)
- Each placement must specify video type: animation, stock_footage, or motion_graphics

**DO NOT:**
- Create placements that overlap with image placement timestamps
- Create placements for images (those are handled in Image Placement phase)
- Create placements for ad breaks or transitions (those stay as original footage)
- Create more than 1-2 placements (be selective about which moments truly need videos)
- Skip saving the placements - you MUST save to the file
- Skip validation - you MUST verify the output format before saving
- Save planning comments or thinking - extract ONLY the VIDEO_PLACER section
- Skip transition to video generation - you MUST transition after marking phase complete

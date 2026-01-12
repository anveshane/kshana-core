### Video Generation Phase

Generate AI videos for each placement identified in the previous phase.

**SIMPLE WORKFLOW:**
1. Call the `generate_all_videos` tool to process all placements automatically
2. The tool will:
   - Read and parse `agent/content/video-placements.md`
   - Extract all placements (Placement 1, 2, 3, etc.)
   - Generate videos sequentially, one at a time
   - Wait for each video to complete before moving to the next
   - Continue even if some videos fail (logs failures but doesn't stop)
   - Return a summary of successful and failed placements
3. After the tool completes, mark phase complete and STOP

**NEVER:**
- Manually parse the video-placements.md file
- Call `generate_video` tool for individual placements
- Create todos
- Process multiple placements at once
- Transition to the next phase - the phase ends after marking it as completed

**STEP 1: Call generate_all_videos tool**

Simply call the `generate_all_videos` tool. It handles everything automatically:

```
generate_all_videos(
  file_path: 'agent/content/video-placements.md'
)
```

The tool will:
- Read and parse the video-placements.md file
- Extract all placement entries (Placement 1, 2, 3, etc.)
- Calculate duration from timestamps (rounded to 5, 10, or 15 seconds)
- Extract video type (animation, stock_footage, or motion_graphics)
- Generate videos sequentially, one at a time
- Wait for each video to complete before moving to the next
- Continue even if some videos fail (logs failures but doesn't stop)
- Return a summary with successful and failed placements

**WAIT for the tool to complete** - It will process ALL placements before returning.

**STEP 2: Check results and mark phase complete**

After the `generate_all_videos` tool completes:

1. **Check the result summary** - The tool returns:
   - `total_placements`: Total number of placements found
   - `successful`: Number of successfully generated videos
   - `failed`: Number of failed video generations
   - `results`: Array with details for each placement

2. **Mark the phase complete:**
```
update_project(
  action: 'update_phase',
  data: { phase: 'video_generation', status: 'completed' }
)
```

3. **STOP here** - The video generation phase ends after marking it as completed. Do NOT transition to the next phase automatically.

**DO NOT:**
- Manually parse the video-placements.md file
- Call `generate_video` tool for individual placements
- Create todos or task lists
- Try to manage video placement state manually
- Retry failed placements manually
- Transition to the next phase - the phase ends after marking it as completed

**IMPORTANT:**
- **Use the `generate_all_videos` tool** - It handles all parsing, sequential generation, and error handling
- **The tool processes ALL placements automatically** - No need to count or iterate manually
- **Sequential execution is guaranteed** - The tool enforces one-at-a-time generation in code
- **Failed placements are logged but don't stop the process** - The tool continues with remaining placements
- **After the tool completes** - Mark phase complete and STOP. The phase ends here.
- Generated videos are automatically stored in `agent/video-placements/` directory
- Videos are automatically registered in the manifest

### Video Generation Phase

Generate AI videos for each placement identified in the previous phase.

**SIMPLE WORKFLOW:**
1. Call `generate_all_videos` in background mode (default)
2. It returns immediately with `status: "queued"` and `batch_id`
3. The user should immediately see that video generation is running in background
4. The user will receive a completion/failure notification when the batch reaches terminal state
5. Monitor status with `read_background_generation`
6. Complete `video_generation` only when all placements in the active batch succeed
7. If any placements fail, retry failed-only using `retry_failed_batch_id`

`generate_all_videos` now resumes safely by default:
- It generates only missing placements (already-generated placements are skipped).
- Use `force_regenerate: true` only when the user explicitly wants a full rerun.

**NEVER:**
- Manually parse the video-placements.md file
- Call `generate_video` tool for individual placements
- Create todos
- Process multiple placements at once
- Mark phase completed while failed placements still exist

**STEP 1: Queue background video generation**

Call:

```
generate_all_videos(
  file_path: 'agent/content/video-placements.md',
  expand_prompts: true,
  run_in_background: true,
  auto_fill_gaps: true
)
```

Full rerun (explicit):

```
generate_all_videos(
  file_path: 'agent/content/video-placements.md',
  expand_prompts: true,
  run_in_background: true,
  auto_fill_gaps: true,
  force_regenerate: true
)
```

The tool will:
- Read and parse the video-placements.md file
- Extract all placement entries (Placement 1, 2, 3, etc.)
- Optionally expand prompts with LLM
- Queue a persistent background batch and return immediately
- Generate videos sequentially in background

**Do NOT transition immediately after queueing.**
**Do NOT claim all images/videos are fully generated just because queueing succeeded.**

**STEP 2: Monitor progress**

Call:

```
read_background_generation(
  kind: 'video',
  include_items: true
)
```

Interpretation:
- If batch status is `running` or `queued`: keep monitoring.
- If batch status is `failed`: retry failed placements only.
- If batch status is `completed` with zero failures: complete phase.

**STEP 3: Retry failed placements (when needed)**

```
generate_all_videos(
  retry_failed_batch_id: 'video-batch-...',
  run_in_background: true
)
```

**STEP 4: Complete phase only after full success**

When the active/retry batch finishes with zero failed placements:

1. Mark phase complete:
```
update_project(
  action: 'update_phase',
  data: { phase: 'video_generation', status: 'completed' }
)
```

2. Transition:
```
update_project(
  action: 'transition_phase',
  data: {}
)
```

**DO NOT:**
- Manually parse the video-placements.md file
- Call `generate_video` tool for individual placements
- Create todos or task lists
- Try to manage video placement state manually
- Transition while failed placements remain

**IMPORTANT:**
- **Use `generate_all_videos` with background mode**
- **Expect user-facing background status + completion/failure notifications**
- **Use `read_background_generation` for status**
- **Retry with `retry_failed_batch_id` instead of full reruns**
- **Complete video_generation only when all placements succeed**
- **Do not claim full media completion while any background batch is queued/running/failed**
- Generated videos are automatically stored in `agent/video-placements/` directory
- Videos are automatically registered in the manifest

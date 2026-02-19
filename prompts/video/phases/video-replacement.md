### Video Replacement Phase

Replace video segments with generated images while maintaining narration/audio sync.

Steps:
1. Read the SRT with image tags (e.g., `agent/script/subtitles_with_images.srt`).
2. Call the video replacer subagent:
```
Task(
  subagent_type: 'video-replacer',
  task: 'Replace video segments with image inserts and preserve audio sync',
  context_refs: ['$srt_with_images', '$generated_images']
)
```
3. Execute replacement operations and ensure transitions are smooth.
4. Mark phase complete and transition to Video Combine.

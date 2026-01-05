### Image Placement Phase

Create a detailed placement plan with exact timestamps and enhanced image prompts.

Call the image placer subagent:
```
Task(
  subagent_type: 'image-placer',
  task: 'Create detailed placement plan with timestamps and enhanced prompts',
  context_refs: ['$transcript', '$placement_plan']
)
```

Then:
- Save placement entries to project state.
- Generate an SRT file with image tags and write it to `agent/script/subtitles_with_images.srt`.
- Mark the phase complete and transition to Image Generation.

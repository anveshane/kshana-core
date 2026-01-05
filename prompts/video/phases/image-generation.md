### Image Generation Phase

Generate documentary-style images for each planned placement.

Guidelines:
- Focus on illustrative, informational visuals.
- No character consistency required.
- Avoid cinematic scene staging; keep it documentary/informational.

Use the existing image-generator subagent for each placement:
```
Task(
  subagent_type: 'image-generator',
  task: 'Generate documentary image for placement 1',
  context_refs: ['$placement_1']
)
```

After all images are generated and approved, mark this phase complete and transition to Video Replacement.

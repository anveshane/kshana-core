### Planning Phase

Analyze the transcript and plan where images should appear.

Guidelines:
- Identify 5-15 key moments for images.
- Avoid inserting images too frequently.
- Focus on visually strong moments and informational beats.

Call the placement planner subagent:
```
Task(
  subagent_type: 'placement-planner',
  task: 'Plan strategic image placements across the transcript',
  context_refs: ['$transcript']
)
```

Store the placement plan in project state (e.g., `$placement_plan` context).
Mark the phase complete and transition to Image Placement.

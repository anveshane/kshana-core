### Story Development Phase

**REQUIRED CONTEXT**: `$plot` - Use the APPROVED PLOT from the previous phase. DO NOT use `$original_input`.
The plot has been refined and approved - expand the PLOT into a full story.

IMPORTANT: The story requires user approval before proceeding.

1. Use Task(subagent_type: 'content-creator', content_type: 'story', context_refs: ["$plot"]) to expand the plot into a full story
2. The content-creator will show the story and ask for user approval
3. After approval, the story is automatically saved to `plans/story.md`

The story should include:
- Character introductions with physical descriptions
- Setting descriptions with visual details
- Detailed narrative with dialogue
- Scene transitions and pacing

After story approval:
1. Extract characters and save using `update_project` action: 'add_character'
2. Extract settings and save using `update_project` action: 'add_setting'
3. Update planner stage to 'complete' and transition to the next phase

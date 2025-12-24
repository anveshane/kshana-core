### Story Development Phase

IMPORTANT: The story requires user approval before proceeding.

1. Read `plans/plot.md` for context (use fetch_context or read_file)
2. Use Task(subagent_type: 'content-creator', content_type: 'story') to expand the plot into a full story
3. The content-creator will show the story and ask for user approval
4. After approval, the story is automatically saved to `plans/story.md`

The story should include:
- Character introductions with physical descriptions
- Setting descriptions with visual details
- Detailed narrative with dialogue
- Scene transitions and pacing

After story approval:
1. Extract characters and save using `update_project` action: 'add_character'
2. Extract settings and save using `update_project` action: 'add_setting'
3. Update planner stage to 'complete' and transition to the next phase

### Story Development Phase

**Step-by-step instructions:**

1. Generate the full story:
```
generate_content(content_type: "story")
```

The tool automatically:
- Uses the approved plot from the context store
- Passes it to the content-creator agent
- Handles user approval flow
- Saves approved content to `plans/story.md`

2. After story approval, extract characters and settings from the story

3. Extract characters and save using `update_project` action: 'add_character'

4. Extract settings and save using `update_project` action: 'add_setting'

5. Update planner stage to 'complete' and transition to the next phase

**The story should include:**
- Character introductions with physical descriptions
- Setting descriptions with visual details
- Detailed narrative with dialogue
- Scene transitions and pacing

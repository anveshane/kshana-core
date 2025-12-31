### Story Development Phase

**⚠️ CRITICAL: This phase generates content directly. DO NOT create a plan first!**

**Step-by-step instructions:**

1. **IMMEDIATELY generate the story content** (DO NOT create a plan first):
```
generate_content(content_type: "story")
```

The tool automatically:
- Uses the approved plot from the context store
- Passes it to the content-creator agent
- Handles user approval flow
- Saves approved content to `agent/script/story.md`

2. **CRITICAL: After story approval, IMMEDIATELY update project state:**
```
update_project(action: 'update_planner_stage', data: { phase: 'story', stage: 'complete' })
update_project(action: 'transition_phase', data: { next_phase: 'characters_settings' })
```

**❌ DO NOT use Task with subagent_type="Plan" for this phase.**
**❌ DO NOT create story-plan.md - generate the story content directly.**
**❌ DO NOT enter a feedback loop after approval.**
**✅ After the user accepts the story, IMMEDIATELY call the two update_project actions above.**

**The story should include:**
- Character introductions with physical descriptions
- Setting descriptions with visual details
- Detailed narrative with dialogue
- Scene transitions and pacing

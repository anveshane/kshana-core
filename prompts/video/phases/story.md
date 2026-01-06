### Story Development Phase

**⚠️ PREREQUISITE: Master plan must be approved before executing this phase!**

**Step-by-step instructions:**

1. **IMMEDIATELY generate the story content**:
   - Uses the approved plot and master plan for guidance.
```
generate_content(content_type: "story")
```

The tool automatically:
- Uses the approved plot from the context store
- References the master plan for structure
- Passes it to the content-creator agent
- Handles user approval flow
- Saves approved content to `agent/script/story.md`

2. **CRITICAL: After story approval, IMMEDIATELY update project state:**
```
update_project(action: 'update_phase', data: { phase: 'story', status: 'completed' })
update_project(action: 'transition_phase', data: {})
```

**❌ DO NOT create per-phase plans - the master plan governs all phases.**
**❌ DO NOT enter a feedback loop after approval.**
**✅ After the user accepts the story, IMMEDIATELY mark phase complete and transition.**

**The story should include:**
- Character introductions with physical descriptions
- Setting descriptions with visual details
- Detailed narrative with dialogue
- Scene transitions and pacing

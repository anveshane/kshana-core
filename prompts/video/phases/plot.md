### Plot Development Phase

**Step-by-step instructions:**

1. Generate the plot outline:
```
generate_content(content_type: "plot")
```

The tool automatically:
- Fetches the user's original input from the context store
- Passes it to the content-creator agent
- Handles user approval flow
- Saves approved content to `plans/plot.md`

2. Wait for user approval of the plot.

3. **CRITICAL: After plot approval, IMMEDIATELY update project state and transition to story phase:**
```
update_project(action: 'update_planner_stage', data: { phase: 'plot', stage: 'complete' })
update_project(action: 'transition_phase', data: { next_phase: 'story' })
```

After updating the plot phase to complete, the story phase will automatically start. The workflow will transition to the story phase where you'll generate the full story based on the approved plot.

**DO NOT use Task with subagent_type="Plan" for phase-level planning.**
**DO NOT enter a feedback loop after approval.**
**After the user accepts the plot, IMMEDIATELY call the two update_project actions above.**

**The plot should include:**
- Main story beats and structure based on user's input
- Key turning points
- Character arcs overview
- Beginning, middle, and end

### Plot Development Phase

**⚠️ PREREQUISITE: Master plan must be approved before executing this phase!**

Check that the master plan is approved by calling `read_project()`. If `plan.stage` is not "complete", you must first create and get approval for the master plan.

**Step-by-step instructions:**

1. **IMMEDIATELY generate the plot content** (master plan guides this):
```
generate_content(content_type: "plot")
```

The tool automatically:
- Fetches the user's original input from the context store
- Uses the approved master plan for guidance
- Passes it to the content-creator agent
- Handles user approval flow
- Saves approved content to `agent/script/plot.md`

2. Wait for user approval of the plot.

3. **CRITICAL: After plot approval, IMMEDIATELY update project state and transition to story phase:**
```
update_project(action: 'update_phase', data: { phase: 'plot', status: 'completed' })
update_project(action: 'transition_phase', data: {})
```

**❌ DO NOT create per-phase plans - the master plan governs all phases.**
**❌ DO NOT enter a feedback loop after approval.**
**✅ After the user accepts the plot, IMMEDIATELY mark phase complete and transition.**

**The plot should include:**
- Main story beats and structure based on user's input and master plan
- Key turning points
- Character arcs overview
- Beginning, middle, and end

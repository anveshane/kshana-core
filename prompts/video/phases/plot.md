### Plot Development Phase

⛔ **CRITICAL: DO NOT create plot from a provided chapter**

Plot is OPTIONAL and should ONLY be created/updated when:
- The user provides a short story idea/concept (NOT a full chapter)
- The user explicitly pastes plot content for updating

**If the user provided a chapter:**
- This phase should be SKIPPED
- DO NOT generate a plot from the chapter
- Move directly to the next phase

**Step-by-step instructions (only for short ideas/concepts):**

1. Generate the plot outline:
```
generate_content(content_type: "plot")
```

That's it! The tool automatically:
- Fetches the user's original input from the context store
- Passes it to the content-creator agent
- Handles user approval flow
- Saves approved content to `plans/plot.md`

2. After approval, update planner stage to 'complete' and transition to story phase

**The plot should include:**
- Main story beats and structure based on user's input
- Key turning points
- Character arcs overview
- Beginning, middle, and end

### Plot Development Phase

**Step-by-step instructions:**

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

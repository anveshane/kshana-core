### Plot Development Phase

IMPORTANT: The plot requires user approval before proceeding.

1. Read the user's original input from `read_project`
2. Use Task(subagent_type: 'content-creator', content_type: 'plot') to generate the plot
3. The content-creator will show the plot and ask for user approval
4. After approval, the plot is automatically saved to `plans/plot.md`
5. Update planner stage to 'complete' and transition to the next phase

The plot should include:
- Main story beats and structure
- Key turning points
- Character arcs overview
- Beginning, middle, and end

Wait for user approval before marking the phase complete.

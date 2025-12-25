### Plot Development Phase

**REQUIRED CONTEXT**: `$original_input` - This is the first phase, use the user's original input.

IMPORTANT: The plot requires user approval before proceeding.

1. Read the user's original input from `read_project`
2. Use Task(subagent_type: 'content-creator', content_type: 'plot', context_refs: ["$original_input"]) to generate the plot
3. The content-creator will show the plot and ask for user approval
4. After approval, the plot is automatically saved to `plans/plot.md`
5. Update planner stage to 'complete' and transition to the next phase

The plot should include:
- Main story beats and structure
- Key turning points
- Character arcs overview
- Beginning, middle, and end

Wait for user approval before marking the phase complete.

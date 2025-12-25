Use this tool ONLY after initial project planning is complete and user has approved.

## When to Use ExitPlanMode

**USE when:**
- You are in initial plan mode (called EnterPlanMode earlier)
- You have presented the INITIAL project plan to the user
- The user has APPROVED the plan to start the workflow

**DO NOT USE when:**
- You are inside a workflow phase (use `update_planner_stage` instead)
- Completing individual phase work
- Transitioning between workflow phases
- You never called EnterPlanMode in this session

## Important: ExitPlanMode vs update_planner_stage

- **ExitPlanMode**: Called ONCE after initial project planning approval
- **update_planner_stage**: Called MULTIPLE TIMES to track progress within each phase

After ExitPlanMode, you should NEVER call it again. Use `update_planner_stage` for phase progress.

## CRITICAL: User Approval Required

You MUST NOT call ExitPlanMode until:

1. You have summarized your plan clearly
2. You have presented the plan to the user via `AskUserQuestion`
3. The user has APPROVED the plan

## Required Steps Before Calling ExitPlanMode

1. **Summarize the plan** - Create a clear summary of:
   - What phases will be executed (plot → story → characters → scenes → images → video)
   - What content will be created
   - What the expected deliverables are

2. **Ask for approval** - Use AskUserQuestion:
   ```
   AskUserQuestion(
     question: "Here is the execution plan: [summary]. Ready to proceed?",
     options: [
       { label: "Approve and proceed (Recommended)", description: "Start execution" },
       { label: "Modify the plan", description: "I have changes to suggest" },
       { label: "Cancel", description: "Do not proceed" }
     ]
   )
   ```

3. **Wait for response** - Only proceed if user approves

4. **Call ExitPlanMode** - After approval, call this tool

## What Happens After ExitPlanMode

- Initial plan mode ends (you should NEVER re-enter it)
- Create todos via `TodoWrite` to track phase-level progress
- Start the first workflow phase (usually 'plot')
- From now on, use `update_planner_stage` to manage phase progress, NOT EnterPlanMode/ExitPlanMode

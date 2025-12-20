Use this tool when you are in plan mode and have finished planning.

## CRITICAL: User Approval Required

You MUST NOT call ExitPlanMode until:

1. You have summarized your plan clearly
2. You have presented the plan to the user via `AskUserQuestion`
3. The user has APPROVED the plan

## Required Steps Before Calling ExitPlanMode

1. **Summarize the plan** - Create a clear summary of:
   - What phases will be executed
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

4. **Call ExitPlanMode** - After approval, call this tool to exit plan mode

## What Happens After ExitPlanMode

- Plan mode ends
- You transition to execution mode
- You should immediately create todos via `TodoWrite` to track execution
- Begin executing the approved plan phase by phase

Use this tool when you're about to start a non-trivial creative task that requires planning.

## When to Use EnterPlanMode

- User provides a new story idea or complete story
- Starting a multi-phase workflow (plot → story → images → video)
- Complex task requiring multiple subagent dispatches
- Any work that benefits from upfront planning and user approval

## What Happens in Plan Mode

Once you call EnterPlanMode:

1. You enter READ-ONLY mode - no file modifications allowed
2. Analyze the user's input and project state
3. Design an execution plan with clear phases
4. Present the plan to the user for approval
5. Only after approval, call `ExitPlanMode` to begin execution

## Plan Mode Rules

While in plan mode:

- Do NOT generate creative content (no plots, stories, characters)
- Do NOT generate images or videos
- Do NOT modify any files
- ONLY analyze, plan, and present to user

## Example Usage

```
EnterPlanMode(task: "Create a video from the user's story about Daniel at a train station")
```

Then in plan mode:

1. Analyze the input (is it a complete story or just an idea?)
2. Determine which phases are needed
3. Create execution plan
4. Present plan to user via `AskUserQuestion`
5. After approval, call `ExitPlanMode`

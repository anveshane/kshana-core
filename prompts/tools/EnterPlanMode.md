Use this tool ONLY at the very start of a NEW project to create an initial execution plan.

## When to Use EnterPlanMode

**USE when:**
- User provides a NEW story idea or complete story (starting fresh)
- Beginning a brand new multi-phase workflow from scratch
- First interaction with a new creative task

**DO NOT USE when:**
- Already inside a workflow phase (plot, story, characters, etc.)
- Transitioning between workflow phases
- Working on individual items within a phase
- The project already exists and has progress

## Important: EnterPlanMode vs Planner Stage Cycle

These are DIFFERENT concepts:

- **EnterPlanMode/ExitPlanMode**: One-time tools for INITIAL project setup only
- **Planner Stage Cycle** (planning → verify → refining → complete): Per-PHASE workflow, managed via `update_planner_stage`

Once you exit plan mode and start the workflow, you should NEVER call EnterPlanMode again.
Use `update_planner_stage` to manage progress within each phase instead.

## What Happens in Plan Mode

Once you call EnterPlanMode:

1. You enter READ-ONLY mode - no file modifications allowed
2. Analyze the user's input
3. Design an execution plan with clear phases
4. Present the plan to the user for approval via `AskUserQuestion`
5. Only after approval, call `ExitPlanMode` to begin execution

## Plan Mode Rules

While in plan mode:

- Do NOT generate creative content (no plots, stories, characters)
- Do NOT generate images or videos
- Do NOT modify any files
- ONLY analyze, plan, and present to user

## Example Usage

```
User: "Create a video about a boy named Daniel at a train station"
Agent: EnterPlanMode()  // Start planning for this NEW project
```

Then in plan mode:

1. Analyze the input (is it a complete story or just an idea?)
2. Determine which phases are needed (plot → story → characters → scenes → images → video)
3. Create execution plan
4. Present plan to user via `AskUserQuestion`
5. After user approval, call `ExitPlanMode`
6. Then use TodoWrite and start the workflow phases

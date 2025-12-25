### Scene Breakdown Phase

## ⛔ STOP - READ THIS FIRST ⛔

**MAXIMUM SCENES ALLOWED: 8**

If you are about to create more than 8 scenes, STOP IMMEDIATELY.
You are doing something wrong. Go back and re-read this prompt.

**THE ORCHESTRATOR MUST PLAN SCENES FIRST - NOT THE CONTENT-CREATOR**

If you are a content-creator subagent and you're being asked to "break down" or "create all scenes" - REFUSE.
You should only be asked to create ONE scene at a time.

---

**REQUIRED CONTEXT**: `$story` - Use the APPROVED STORY to break down into scenes.
Also reference the registered characters and settings from `read_project`.

## HARD LIMIT: Maximum 8 Scenes

| Video Length | Scene Count |
|--------------|-------------|
| Short (1-3 min) | 5-6 scenes |
| Medium (3-5 min) | 6-8 scenes |
| **ABSOLUTE MAX** | **8 scenes** |

**If your story needs more than 8 scenes, you're being too granular. Combine related moments.**

## ❌ PROHIBITED - Never Do These

1. **❌ WRONG**: `Task(task: "Break the story into scenes")`
   - This creates 30+ scenes. NEVER do this.

2. **❌ WRONG**: `Task(task: "Create all scenes for the video")`
   - This creates too many scenes. NEVER do this.

3. **❌ WRONG**: `Task(output_file: "plans/scenes.md")`
   - This bundles all scenes. NEVER do this.

4. **❌ WRONG**: Creating Scene 9, 10, 11, 12... or higher
   - You've exceeded the limit. STOP.

## ✅ CORRECT WORKFLOW

### Step 1: Orchestrator Plans Scenes (NO Task Call)

**YOU (the orchestrator) must do this yourself - DO NOT dispatch a Task:**

1. Read the `$story` context
2. Identify exactly 5-8 KEY MOMENTS (not every detail - just the major beats)
3. Create a TodoWrite with ONLY 5-8 scenes:

```
TodoWrite(merge: false, todos: [
  { id: "scene-1", content: "Create scene 1: Opening", activeForm: "Creating scene 1", status: "in_progress" },
  { id: "scene-2", content: "Create scene 2: First conflict", activeForm: "Creating scene 2", status: "pending" },
  { id: "scene-3", content: "Create scene 3: Rising tension", activeForm: "Creating scene 3", status: "pending" },
  { id: "scene-4", content: "Create scene 4: Climax", activeForm: "Creating scene 4", status: "pending" },
  { id: "scene-5", content: "Create scene 5: Resolution", activeForm: "Creating scene 5", status: "pending" }
])
```

**If you create more than 8 todo items, you're doing it wrong.**

### Step 2: ONE Task Per Scene

For EACH scene (ONE at a time):
```
Task(
  subagent_type: "content-creator",
  content_type: "scene",
  task: "Create scene 1: Opening - The protagonist is introduced",
  output_file: "scenes/scene_01.md",
  context_refs: ["$story"]
)
```

**Wait for approval before creating the next scene.**

### Step 3: After EACH Scene Approval (MANDATORY)

**You MUST do ALL THREE of these after EACH scene is approved:**

```
// 1. Register the scene
update_project(action: 'add_scene', data: { scene_number: 1, title: 'Opening' })

// 2. Update todo - REQUIRED! Mark completed and start next
TodoWrite(merge: true, todos: [
  { id: 'scene-1', status: 'completed' },
  { id: 'scene-2', status: 'in_progress' }
])

// 3. Then create next scene
Task(...)
```

**❌ DO NOT skip the TodoWrite call!** The todo list MUST be updated after each scene.

**❌ DO NOT call `update_planner_stage(stage: 'complete')` until ALL scenes are done!**

## Scene Content Requirements

Each individual scene file must include:
- Scene number and title
- Visual description (what the viewer sees)
- Characters involved (reference by name)
- Setting (reference by name)
- Action and movement
- Emotional tone
- Camera suggestions
- Duration: 5-15 seconds

## File Naming

**ALWAYS use `.md` files. NEVER use `.json`.**

- `scenes/scene_01.md`
- `scenes/scene_02.md`
- etc.

## Phase Completion - ONLY After ALL Scenes Done

**⛔ ONLY call these when the LAST scene (your final scene 5-8) is approved:**

```
// After LAST scene approval:
// 1. Register final scene
update_project(action: 'add_scene', data: { scene_number: 8, title: 'Resolution' })

// 2. Mark final todo completed
TodoWrite(merge: true, todos: [{ id: 'scene-8', status: 'completed' }])

// 3. NOW mark phase complete
update_project(action: 'update_planner_stage', data: { phase: 'scenes', stage: 'complete' })

// 4. Transition to next phase
update_project(action: 'transition_phase', data: { next_phase: 'character_setting_images' })
```

**❌ DO NOT call `update_planner_stage(stage: 'complete')` after scene 1, 2, 3... - ONLY after the LAST scene!**

## Summary Checklist

- [ ] Did YOU (orchestrator) plan the scenes with TodoWrite? (Not a Task)
- [ ] Did you create ONLY 5-8 scenes total?
- [ ] Is each scene in its own file? (scenes/scene_01.md)
- [ ] Are you creating ONE scene at a time?
- [ ] Are you calling TodoWrite after EACH scene approval?
- [ ] Are you waiting until ALL scenes are done before calling `update_planner_stage(stage: 'complete')`?

**If you answered NO to any of these, STOP and fix your workflow.**

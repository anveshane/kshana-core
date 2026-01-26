### Scene Breakdown Phase

## STOP - READ THIS FIRST

**MAXIMUM SCENES ALLOWED: 8**

If you are about to create more than 8 scenes, STOP IMMEDIATELY.
You are doing something wrong. Go back and re-read this prompt.

---

## HARD LIMIT: Maximum 8 Scenes

| Video Length     | Scene Count  |
| ---------------- | ------------ |
| Short (1-3 min)  | 5-6 scenes   |
| Medium (3-5 min) | 6-8 scenes   |
| **ABSOLUTE MAX** | **8 scenes** |

**If your story needs more than 8 scenes, you're being too granular. Combine related moments.**

## CORRECT WORKFLOW

### Step 0: Create and Approve the Scene Outline

**YOU (the orchestrator) must do this yourself - DO NOT dispatch anything:**

1. Read the `$story` context
2. Identify exactly 5-8 KEY MOMENTS (not every detail - just the major beats)
3. Write the **Scene Outline** to `plans/scenes-outline.md`
4. Move to VERIFY stage and present the outline for approval
5. If approved, update planner stage to COMPLETE
6. If feedback is given, move to REFINING and update the outline

**Do NOT write full scene descriptions until the outline is approved.**

### Step 1: Create Scene Todos (NO generate_content Call)

After outline approval, create a TodoWrite with ONLY 5-8 scenes:

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

### Step 2: ONE generate_content Per Scene

For EACH scene (ONE at a time):

```
generate_content(
  content_type: "scene",
  task_description: "Scene 1: Opening - The protagonist is introduced"
)
```

The tool automatically:

- Fetches the story, characters, and settings from the context store
- Creates the scene description
- Handles user approval flow
- Saves to `plans/scenes.md` (appended)

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
generate_content(content_type: "scene", task_description: "Scene 2: First conflict")
```

**DO NOT skip the TodoWrite call!** The todo list MUST be updated after each scene.

**DO NOT call `update_planner_stage(stage: 'complete')` until ALL scenes are done!**

## Scene Content Requirements

Each individual scene must include:

- Scene number and title
- Visual description (what the viewer sees)
- Characters involved (reference by name)
- Setting (reference by name)
- Action and movement
- Emotional tone
- Camera suggestions
- Duration: 5-15 seconds

## Phase Completion - ONLY After ALL Scenes Done

**ONLY call these when the LAST scene (your final scene 5-8) is approved:**

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

**DO NOT call `update_planner_stage(stage: 'complete')` after scene 1, 2, 3... - ONLY after the LAST scene!**

## Summary Checklist

- [ ] Did YOU (orchestrator) approve the outline before scene generation?
- [ ] Did you create ONLY 5-8 scenes total?
- [ ] Are you creating ONE scene at a time?
- [ ] Are you calling TodoWrite after EACH scene approval?
- [ ] Are you waiting until ALL scenes are done before calling `update_planner_stage(stage: 'complete')`?

**If you answered NO to any of these, STOP and fix your workflow.**

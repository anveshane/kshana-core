### Scene Breakdown Phase

**REQUIRED CONTEXT**: `$story` - Use the APPROVED STORY to break down into scenes.
Also reference the registered characters and settings from `read_project`.

**OPTIONAL CONTEXT**: `$highlights` - If available (from YouTube transcript workflow), use the extracted visual highlights to guide scene breakdown. Each highlight contains:
- Visual composition hints (camera angle, lighting, key elements)
- Emotional/narrative context (tone, story beat, thematic weight)
- Source quotes from the original content

When `$highlights` is available, prioritize creating scenes that capture these key visual moments.

## CRITICAL: Scene Limits

**For short videos (1-3 minutes)**: Create 5-8 scenes maximum.
**For medium videos (3-5 minutes)**: Create 8-12 scenes maximum.

**DO NOT create more than 12 scenes.** If the story is complex, focus on the KEY MOMENTS only.

## PROHIBITED ACTIONS

**NEVER** do any of the following:
- `Task(output_file: "plans/scenes.md")` - WRONG! No bundled files!
- Creating all scenes in a single Task call
- Creating 20+ scenes - this is excessive!

## CORRECT WORKFLOW

### Step 1: YOU (Orchestrator) Plan the Scenes

**DO NOT dispatch a Task for this step.** YOU must:
1. Read the `$story` context
2. Identify 5-8 KEY MOMENTS that will make compelling video scenes
3. Create a TodoWrite list with each scene:

```
TodoWrite(merge: false, todos: [
  { id: "scene-1", content: "Create scene 1: Opening", activeForm: "Creating scene 1", status: "in_progress" },
  { id: "scene-2", content: "Create scene 2: Inciting incident", activeForm: "Creating scene 2", status: "pending" },
  { id: "scene-3", content: "Create scene 3: Rising action", activeForm: "Creating scene 3", status: "pending" },
  { id: "scene-4", content: "Create scene 4: Climax", activeForm: "Creating scene 4", status: "pending" },
  { id: "scene-5", content: "Create scene 5: Resolution", activeForm: "Creating scene 5", status: "pending" }
])
```

### Step 2: Process EACH Scene with a SEPARATE Task Call

For EACH scene (ONE at a time - do not batch!):
```
Task(
  subagent_type: "content-creator",
  content_type: "scene",
  task: "Create scene 1: <SCENE_TITLE> - <brief description>",
  output_file: "scenes/scene_01.md",
  context_refs: ["$story", "$highlights"]  // Include $highlights if available for visual direction
)
```

### Step 3: After Each Scene Task

After each scene is approved:
1. Register: `update_project(action: 'add_scene', data: { scene_number: 1, title: '...', ... })`
2. Update todo: `TodoWrite(merge: true, todos: [{ id: 'scene-1', status: 'completed' }, { id: 'scene-2', status: 'in_progress' }])`
3. Move to next scene

## Scene Requirements

Each scene description must include:
- Scene number and title
- Visual description (what the viewer sees)
- Characters involved (reference by name from registered characters)
- Setting (reference by name from registered settings)
- Action and movement
- Emotional tone and atmosphere
- Camera suggestions (wide shot, close-up, pan, etc.)
- Duration estimate (5-15 seconds per scene)

## File Naming Convention

- Scenes: `scenes/scene_01.md`, `scenes/scene_02.md`, etc.

## Summary

1. **Step 1**: YOU read $story and create TodoWrite with 5-8 scenes (NO Task call)
2. **Step 2**: ONE Task call per scene (individual files!)
3. **Step 3**: Update todo and move to next

## CRITICAL: After All Scenes Complete

When the LAST scene is approved and registered:

1. Mark final todo as completed
2. `update_project(action: 'update_planner_stage', data: { phase: 'scenes', stage: 'complete' })`
3. `update_project(action: 'transition_phase', data: { next_phase: 'character_setting_images' })`

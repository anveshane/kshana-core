### Character & Setting Reference Images Phase

**REQUIRED CONTEXT**: Use the registered characters and settings from `read_project`.
Each character/setting has a description that should be used to generate reference images.
DO NOT re-read $story or $original_input - use the approved character/setting descriptions.

IMPORTANT: Each image requires user approval before generation.

This phase creates reference images for visual consistency across scenes.

## ⚠️ PHASE START: Create Fresh Todo List

**FIRST THING when entering this phase**: Create a NEW todo list with `merge: false` listing ALL characters and settings that need reference images:

```
TodoWrite(merge: false, todos: [
  { id: "img-char-<name1>", content: "Generate image for character: <Name1>", activeForm: "Generating image for <Name1>", status: "in_progress" },
  { id: "img-char-<name2>", content: "Generate image for character: <Name2>", activeForm: "Generating image for <Name2>", status: "pending" },
  { id: "img-setting-<loc1>", content: "Generate image for setting: <Location1>", activeForm: "Generating image for <Location1>", status: "pending" },
  ...
])
```

**CRITICAL**: Use `merge: false` to REPLACE the old todos from the previous phase. Old scene/character creation todos should disappear.

## Workflow

### For each character (ONE at a time):
1. Get character description from `read_project` (characters array)
2. Use Task(subagent_type: 'image-generator', task: "Generate reference image for [character name]") with the character's visual description
3. The prompt will be shown to the user for approval
4. After approval, the image is generated
5. Update character with referenceImageId using `update_project` action: 'update_character_approval'

### For each setting (ONE at a time):
1. Get setting description from `read_project` (settings array)
2. Use Task(subagent_type: 'image-generator', task: "Generate reference image for [setting name]") with the setting's visual description
3. The prompt will be shown to the user for approval
4. After approval, the image is generated
5. Update setting with referenceImageId using `update_project` action: 'update_setting_approval'

### After EACH Approval (MANDATORY):

**You MUST do ALL THREE of these after EACH image is approved:**

```
// 1. Register the approval
update_project(action: 'update_character_approval', data: { name: 'Kira', referenceImageId: '...' })

// 2. Update todo - REQUIRED! Mark completed and start next
TodoWrite(merge: true, todos: [
  { id: 'img-char-kira', status: 'completed' },
  { id: 'img-char-marcus', status: 'in_progress' }
])

// 3. Then generate next image
Task(...)
```

**❌ DO NOT skip the TodoWrite call!** The todo list MUST be updated after each approval.

## Image Prompt Guidelines

Image prompts should:
- Focus on the subject (character on neutral background, empty setting)
- Include specific visual details from the descriptions
- Specify art style consistent with project style
- Avoid text or logos

## Phase Completion

When ALL images have been generated and approved:

1. Mark final todo as completed: `TodoWrite(merge: true, todos: [{ id: '<last-item-id>', status: 'completed' }])`
2. Mark phase complete: `update_project(action: 'update_planner_stage', data: { phase: 'character_setting_images', stage: 'complete' })`
3. **IMMEDIATELY** transition: `update_project(action: 'transition_phase', data: { next_phase: 'scene_images' })`

**DO NOT** stop after step 2. You MUST call `update_project(action: 'transition_phase', ...)` to move to scene images.

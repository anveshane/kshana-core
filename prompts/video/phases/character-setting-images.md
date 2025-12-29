### Character & Setting Reference Images Phase

**REQUIRED CONTEXT**: Use the registered characters and settings from `read_project`.
Each character/setting has a description that should be used to generate reference images.

IMPORTANT: Each image prompt requires user approval before the image is generated.

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

**CRITICAL**: Use `merge: false` to REPLACE the old todos from the previous phase.

## Workflow

### For each character (ONE at a time):
1. Generate the image prompt using `generate_content`:
   ```
   generate_content(content_type: "character_image_prompt", name: "CharacterName")
   ```
   This automatically uses the character description and project style.
2. The prompt will be shown to the user for approval
3. After approval, the image is generated automatically
4. Update character with referenceImageId using `update_project` action: 'update_character_approval'

### For each setting (ONE at a time):
1. Generate the image prompt using `generate_content`:
   ```
   generate_content(content_type: "setting_image_prompt", name: "SettingName")
   ```
   This automatically uses the setting description and project style.
2. The prompt will be shown to the user for approval
3. After approval, the image is generated automatically
4. Update setting with referenceImageId using `update_project` action: 'update_setting_approval'

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

// 3. Then generate next image prompt
generate_content(content_type: "character_image_prompt", name: "Marcus")
```

**❌ DO NOT skip the TodoWrite call!** The todo list MUST be updated after each approval.

## Phase Completion

When ALL images have been generated and approved:

1. Mark final todo as completed: `TodoWrite(merge: true, todos: [{ id: '<last-item-id>', status: 'completed' }])`
2. Mark phase complete: `update_project(action: 'update_planner_stage', data: { phase: 'character_setting_images', stage: 'complete' })`
3. **IMMEDIATELY** transition: `update_project(action: 'transition_phase', data: { next_phase: 'scene_images' })`

**DO NOT** stop after step 2. You MUST call `update_project(action: 'transition_phase', ...)` to move to scene images.

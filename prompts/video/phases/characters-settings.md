### Characters & Settings Phase

**CRITICAL**: You MUST use `$story` as your source of truth for this phase. DO NOT use `$original_input`.
The story has been refined and approved - extract characters and settings from the STORY, not the original input.

## PROHIBITED ACTIONS - DO NOT DO THESE

**NEVER** do any of the following:
- `Task(task: "Extract and register all characters...")` - WRONG! Don't extract all at once!
- `Task(output_file: "plans/characters.md")` - WRONG! No bundled files!
- `Task(output_file: "plans/settings.md")` - WRONG! No bundled files!
- Creating a single file containing multiple characters or settings

## CORRECT WORKFLOW

### Step 1: YOU (Orchestrator) Identify Items

**DO NOT dispatch a Task for this step.** YOU must read the `$story` context yourself and identify:
- All character names mentioned in the story
- All key locations/settings mentioned in the story

After identifying them, create a TodoWrite list:
```
TodoWrite(merge: false, todos: [
  { id: "char-<name>", content: "Create character: <Name>", activeForm: "Creating character: <Name>", status: "in_progress" },
  { id: "char-<name2>", content: "Create character: <Name2>", activeForm: "Creating character: <Name2>", status: "pending" },
  { id: "setting-<location>", content: "Create setting: <Location>", activeForm: "Creating setting: <Location>", status: "pending" },
  ...
])
```

### Step 2: Process EACH Item with a SEPARATE Task Call

For EACH character (ONE at a time - do not batch!):
```
Task(
  subagent_type: "content-creator",
  content_type: "character",
  task: "Create detailed character profile for <CHARACTER_NAME>",
  output_file: "characters/<character_name_lowercase>.md",
  context_refs: ["$story"]
)
```

For EACH setting (ONE at a time - do not batch!):
```
Task(
  subagent_type: "content-creator",
  content_type: "setting",
  task: "Create detailed setting description for <SETTING_NAME>",
  output_file: "settings/<setting_name_lowercase>.md",
  context_refs: ["$story"]
)
```

### Step 3: After Each Task

After each Task completes and user approves:
1. Register: `update_project(action: 'add_character', data: {...})` or `update_project(action: 'add_setting', data: {...})`
2. Update todo: `TodoWrite(merge: true, todos: [{ id: "<completed-id>", status: "completed" }, { id: "<next-id>", status: "in_progress" }])`
3. Move to next item

## File Naming Convention

- Characters: `characters/<lowercase_name>.md` (e.g., `characters/elias_vance.md`)
- Settings: `settings/<lowercase_name>.md` (e.g., `settings/abandoned_warehouse.md`)

Use underscores for spaces. All lowercase.

## Character Profile Requirements
Each character profile must include:
- Name and role in the story
- Physical appearance (detailed for image generation)
- Personality traits
- Clothing and distinctive features
- Age and demographic details
- Visual keywords for image generation

## Setting Description Requirements
Each setting description must include:
- Location name and type
- Visual details (lighting, colors, atmosphere)
- Key objects and props
- Time of day and weather (if relevant)
- Mood and emotional tone
- Visual keywords for image generation

## Summary

1. **Step 1**: YOU read $story and create TodoWrite (NO Task call)
2. **Step 2**: ONE Task call per character/setting (individual files!)
3. **Step 3**: Update todo and move to next
4. **Step 4**: After ALL items done → call `update_project(action: 'transition_phase', data: { next_phase: 'scenes' })`

**Remember**: Each character = separate Task + separate file. Each setting = separate Task + separate file.

## CRITICAL: After All Items Complete

When the LAST character/setting is approved and registered:

1. Mark final todo as completed: `TodoWrite(merge: true, todos: [{ id: '<last-item-id>', status: 'completed' }])`
2. Mark phase complete: `update_project(action: 'update_planner_stage', data: { phase: 'characters_settings', stage: 'complete' })`
3. **IMMEDIATELY** transition: `update_project(action: 'transition_phase', data: { next_phase: 'scenes' })`

**DO NOT** stop after step 2. You MUST call `update_project(action: 'transition_phase', ...)` to move to scenes.

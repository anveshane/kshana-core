### Characters & Settings Phase

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

### Step 2: Process EACH Item with generate_content

For EACH character (ONE at a time - do not batch!):
```
generate_content(content_type: "character", name: "<CHARACTER_NAME>")
```

For EACH setting (ONE at a time - do not batch!):
```
generate_content(content_type: "setting", name: "<SETTING_NAME>")
```

The tool automatically:
- Fetches the story and other required contexts
- Creates the character/setting profile
- Handles user approval flow
- Saves to `characters/<name>.md` or `settings/<name>.md`

### Step 3: After EACH Approval (MANDATORY)

**You MUST do ALL THREE of these after EACH item is approved:**

```
// 1. Register the item
update_project(action: 'add_character', data: { name: 'Kira', ... })

// 2. Update todo - REQUIRED! Mark completed and start next
TodoWrite(merge: true, todos: [
  { id: 'char-kira', status: 'completed' },
  { id: 'char-marcus', status: 'in_progress' }
])

// 3. Then create next item
generate_content(content_type: "character", name: "Marcus")
```

**DO NOT skip the TodoWrite call!** The todo list MUST be updated after each approval.

**DO NOT call `update_planner_stage(stage: 'complete')` until ALL items are done!**

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
2. **Step 2**: ONE generate_content call per character/setting (individual files!)
3. **Step 3**: Update todo and move to next
4. **Step 4**: After ALL items done -> call `update_project(action: 'transition_phase', data: { next_phase: 'scenes' })`

**Remember**: Each character = separate generate_content + separate file. Each setting = separate generate_content + separate file.

## CRITICAL: After All Items Complete

When the LAST character/setting is approved and registered:

1. Mark final todo as completed: `TodoWrite(merge: true, todos: [{ id: '<last-item-id>', status: 'completed' }])`
2. Mark phase complete: `update_project(action: 'update_planner_stage', data: { phase: 'characters_settings', stage: 'complete' })`
3. **IMMEDIATELY** transition: `update_project(action: 'transition_phase', data: { next_phase: 'scenes' })`

**DO NOT** stop after step 2. You MUST call `update_project(action: 'transition_phase', ...)` to move to scenes.

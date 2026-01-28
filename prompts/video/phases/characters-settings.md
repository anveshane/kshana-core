### Characters & Settings Phase

## CORRECT WORKFLOW

### Step 0: Create and Approve the Breakdown

**DO NOT dispatch a Task for this step.** YOU must read the `$story` context yourself and identify:

- All character names mentioned in the story
- All key locations/settings mentioned in the story

**COUNT the total number** of characters and settings you identified.

Create a **Character & Setting Breakdown** and save it to `plans/characters-settings.md` for approval.

Approval flow:

1. Save the breakdown
2. Move to VERIFY stage
3. Present the breakdown for user approval
4. If approved, update planner stage to COMPLETE
5. If feedback is given, move to REFINING and update the breakdown

**Do NOT generate full descriptions until the breakdown is approved.**

### Step 1: Create Item Todos (MANDATORY if more than 1 item)

After breakdown approval, **if you have more than 1 character or setting**, create a TodoWrite list with one todo per item:

```
TodoWrite(merge: false, todos: [
  { id: "char-<name>", content: "Create character: <Name>", activeForm: "Creating character: <Name>", status: "in_progress" },
  { id: "char-<name2>", content: "Create character: <Name2>", activeForm: "Creating character: <Name2>", status: "pending" },
  { id: "setting-<location>", content: "Create setting: <Location>", activeForm: "Creating setting: <Location>", status: "pending" },
  ...
])
```

**ALWAYS create individual todos** - one per character, one per setting. This is required for proper progress tracking.

### Step 2: Process EACH Item with generate_content

For EACH character (ONE at a time - do not batch!):

```
generate_content(
  content_type: "character",
  name: "<CHARACTER_NAME>",
  instruction: "Create a detailed character profile for <CHARACTER_NAME>. Include physical appearance, personality, clothing, and visual keywords for image generation."
)
```

For EACH setting (ONE at a time - do not batch!):

```
generate_content(
  content_type: "setting",
  name: "<SETTING_NAME>",
  instruction: "Create a detailed setting description for <SETTING_NAME>. Include visual details, atmosphere, lighting, and visual keywords for image generation."
)
```

The `instruction` parameter tells the content creator WHAT to create. The content creator will:
- Query the project structure to understand available context
- Fetch the story and other relevant content
- Generate the profile based on your instruction
- Present it for user approval
- Save to `characters/<name>.md` or `settings/<name>.md`

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
generate_content(
  content_type: "character",
  name: "Marcus",
  instruction: "Create a detailed character profile for Marcus based on his role in the story."
)
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

1. **Step 0**: Create and approve the breakdown (save to `plans/characters-settings.md`)
2. **Step 1**: Create TodoWrite after approval (one todo per item)
3. **Step 2**: ONE generate_content call per character/setting (with clear instruction)
4. **Step 3**: Update todo and move to next
5. **Step 4**: After ALL items done -> call `update_project(action: 'transition_phase', data: { next_phase: 'scenes' })`

**Remember**: Each character = separate generate_content + separate file. Each setting = separate generate_content + separate file.

## CRITICAL: After All Items Complete

When the LAST character/setting is approved and registered:

1. Mark final todo as completed: `TodoWrite(merge: true, todos: [{ id: '<last-item-id>', status: 'completed' }])`
2. Mark phase complete: `update_project(action: 'update_planner_stage', data: { phase: 'characters_settings', stage: 'complete' })`
3. **IMMEDIATELY** transition: `update_project(action: 'transition_phase', data: { next_phase: 'scenes' })`

**DO NOT** stop after step 2. You MUST call `update_project(action: 'transition_phase', ...)` to move to scenes.

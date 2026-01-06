### Characters & Settings Phase

**⚠️ CRITICAL: This is a PER-ITEM phase. DO NOT mark phase complete after each item!**

This phase requires creating MULTIPLE items (characters and settings). Each item must be created, approved, and registered individually. Only mark the phase complete when ALL items are done.

## CORRECT WORKFLOW

### Step 1: YOU (Orchestrator) Identify Items

**CRITICAL: Use `$story` context directly - DO NOT create tasks to read the story!**

**DO NOT dispatch a Task to read the story.** The `$story` context is already available. YOU must:
1. Use `fetch_context(context_ref: "$story")` to get the story content
2. Identify all character names mentioned in the story
3. Identify all key locations/settings mentioned in the story
4. Check `read_project()` to see which characters/settings already exist (don't recreate them!)

**DO NOT create `story_content.md` or any temporary story files. Use `$story` context directly.**

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

**BEFORE creating each item, check if it already exists:**
```
read_project()  // Check project.characters and project.settings arrays
```

**If the character/setting already exists in the project, SKIP it and move to the next item.**

For EACH character that doesn't exist yet (ONE at a time - do not batch!):
```
generate_content(content_type: "character", name: "<CHARACTER_NAME>")
```

For EACH setting that doesn't exist yet (ONE at a time - do not batch!):
```
generate_content(content_type: "setting", name: "<SETTING_NAME>")
```

The tool automatically:
- Fetches the story and other required contexts
- Creates the character/setting profile
- Handles user approval flow
- Saves to `characters/<name>.md` or `settings/<name>.md`

**DO NOT create the same character/setting multiple times! Check first, then create.**

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

**DO NOT mark phase as 'completed' until ALL items are done!**

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

1. **Step 1**: YOU use `$story` context directly (NO Task to read story, NO story_content.md files!)
2. **Step 2**: Check if item exists, then ONE generate_content call per NEW character/setting
3. **Step 3**: After each approval: register item, update todo, create next item
4. **Step 4**: After ALL items done -> mark phase complete and transition

**Remember**: 
- Use `$story` context directly - DO NOT create tasks to read story files
- Check if character/setting exists before creating (use `read_project()`)
- Each character = separate generate_content + separate file
- Each setting = separate generate_content + separate file
- DO NOT create duplicates!

## CRITICAL: After All Items Complete

When the LAST character/setting is approved and registered:

1. Mark final todo as completed: `TodoWrite(merge: true, todos: [{ id: '<last-item-id>', status: 'completed' }])`
2. Mark phase complete: `update_project(action: 'update_phase', data: { phase: 'characters_settings', status: 'completed' })`
3. **IMMEDIATELY** transition: `update_project(action: 'transition_phase', data: {})`

**DO NOT** stop after step 2. You MUST call `update_project(action: 'transition_phase', ...)` to move to scenes.

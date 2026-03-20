# Video Workflow — Phase Execution

{{#if project_id}}
**Project:** {{project_title}} ({{project_id}})
{{/if}}

{{#if current_phase}}
**Current Phase:** {{phase_display_name}} (`{{current_phase}}`)
{{/if}}

{{#if loaded_contexts}}
**Loaded Contexts:** {{loaded_contexts}}
{{/if}}

## Phase Instructions

{{phase_instructions}}

{{#if expensive_checkpoint}}
**Checkpoint:** {{expensive_checkpoint}}
{{/if}}

## Tool Usage Rules

### Content Creation Phases (plot, story, characters_settings, scenes)
- Use `generate_content` for ALL text/content creation — it handles context injection automatically
- For characters: `generate_content(content_type: "character", name: "<name>")`
- For settings: `generate_content(content_type: "setting", name: "<name>")`
- For scenes: `generate_content(content_type: "scene", task_description: "Scene N: <title>")`
- For image prompts: `generate_content(content_type: "character_image_prompt", name: "<name>")` or `generate_content(content_type: "setting_image_prompt", name: "<name>")`
- Process items ONE AT A TIME — never batch multiple characters, settings, or scenes

### Image & Video Phases (character_setting_images, scene_images, video)
- Use `read_project` to get current project state (characters, settings, scenes, images)
- Use `Task` to dispatch subagents for image/video generation
- Do NOT use `generate_content` for reading project data — use `read_project`

### Todo Management
- **Phase start (new phase):** `TodoWrite(merge: false, todos: [...])` — replaces old todos
- **After item approval:** `TodoWrite(merge: true, todos: [{id: "...", status: "completed"}, ...])` — updates existing
- First todo should be `in_progress`, rest should be `pending`
- Use prefixed IDs: `img-char-<name>`, `img-setting-<name>`, `scene-<N>`

### Phase Completion
- After ALL items in a phase are done, call `update_project(action: "update_planner_stage", data: {stage: "complete"})` or `update_project(action: "transition_phase", data: {next_phase: "<phase>"})`
- Do NOT call `Task` after marking phase complete
- Do NOT call `update_planner_stage` with `complete` until ALL items are finished

### Plan Mode (Initial Setup ONLY)
- `EnterPlanMode` — ONLY at the very start of a NEW project (no project_id, no current_phase)
- `ExitPlanMode` — ONLY after user approves the initial plan
- NEVER call `EnterPlanMode` or `ExitPlanMode` during workflow phases (plot, story, characters_settings, scenes, images, video)
- During workflow phases, use `update_project` with `update_planner_stage` or `transition_phase` instead

### Phase Transitions
- After completing a phase, call `update_project(action: "transition_phase", data: {next_phase: "<next>"})`
- Phase order: plot → story → characters_settings → scenes → character_setting_images → scene_images → video → assembly

Now execute the phase instructions above using the correct tools.

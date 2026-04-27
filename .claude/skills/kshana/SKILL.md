---
name: kshana
version: 1.0.0
description: |
  Drive the kshana-ink video pipeline from the shell. Use when the user asks to
  create a video from a story/idea, generate scenes/shots/images/videos for a
  kshana project, regenerate one piece of a project (a shot prompt, a scene's
  prose), override LLM-generated content with their own, or check the status
  of a running project. The pipeline goes: text input → scene breakdown →
  shot prompts → first/last frame images → video clips → final assembly.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
---

# kshana-ink CLI

A short reference for driving the kshana-ink video pipeline. **Always run
commands from the kshana-ink repo root** (where `package.json` lives). All
commands are `pnpm <verb> <project> ...`.

## When to use this skill

Invoke it when the user asks for any of these:

- "create a kshana project", "make a video from this story/idea"
- "regenerate shot N's prompt", "redo scene 3"
- "show me the prompt for shot 2", "what did the LLM generate for scene 1"
- "use my version of scene 3 instead of the one the LLM wrote"
- "what's the status of my project", "did anything fail"
- "run the pipeline", "stop after scene breakdown", "go to final video"

If the user is asking a code question (not asking to drive kshana), don't
invoke this skill — they probably want to edit source.

## The 8 commands

```bash
# CREATE
pnpm new <project> --input <file> [--style <style>] [--duration <sec>]

# INSPECT
pnpm status <project>                                    # phase + node rollup
pnpm nodes <project> [--type X] [--status Y] [--grep R]  # filtered list
pnpm inspect <project> <alias> [--full]                  # one node + its content

# DRIVE
pnpm run-to <project> [stage] [--skip-media]             # run forward to a stage
pnpm reset <project> <stage> [--clean]                   # roll back to a stage

# EDIT
pnpm regen <project> <alias> [--cascade] [--no-run]      # rerun one node
pnpm override <project> <alias> --from <file>            # inject user content
```

## Friendly aliases for `<alias>`

Any command that takes `<alias>` accepts either a verbatim node id
(`shot_image_prompt:scene_2_shot_3`) or a friendly form:

| Alias | Resolves to |
|---|---|
| `scene_2.scene` | `scene:scene_2` |
| `scene_2.svp` | `scene_video_prompt:scene_2` |
| `scene_2_shot_3.prompt` | `shot_image_prompt:scene_2_shot_3` |
| `scene_2_shot_3.image` | `shot_image:scene_2_shot_3` |
| `scene_2_shot_3.motion` | `shot_motion_directive:scene_2_shot_3` |
| `scene_2_shot_3.video` | `shot_video:scene_2_shot_3` |
| `elara` (bare) | `character:elara` (tries common typeIds in order) |

If a user says "shot 3 of scene 2" or "scene 2 shot 3", that's
`scene_2_shot_3.<thing>` where `<thing>` is what they want.

## Stages (for `run-to` and `reset`)

```
plot → story → characters → setting → scene → world_style →
character_image → setting_image → scene_video_prompt → shot_image_prompt →
shot_motion_directive → shot_image → shot_video → final_video
```

Common stops:
- `pnpm run-to myproj scene` — write scene prose, stop before shot planning
- `pnpm run-to myproj scene_video_prompt` — plan all shots, stop before any image
- `pnpm run-to myproj` — go all the way to the final video

## Common workflows

**Create from input file and run end-to-end:**
```bash
pnpm new myproj --input story.md --style anime --duration 60
pnpm run-to myproj
```

**Stop before any image is generated, then continue:**
```bash
pnpm new myproj --input story.md
pnpm run-to myproj scene_video_prompt    # all prompts, no media
pnpm inspect myproj scene_2.svp          # check the LLM's plan
pnpm run-to myproj                        # continue to final video
```

**User wants to use their own scene 2 prose:**
```bash
pnpm run-to myproj scene                  # generate placeholder
# user writes their version to my_scene_2.md
pnpm override myproj scene_2.scene --from my_scene_2.md
pnpm regen myproj scene_2.scene --cascade   # cascade ensures downstream redoes
```

**Regenerate one shot's prompt only (LLM gave a bad one):**
```bash
pnpm regen myproj scene_2_shot_3.prompt --cascade
```

**Something failed — debug:**
```bash
pnpm status myproj                        # shows failed nodes + errors
pnpm inspect myproj <failed-node>         # see context
pnpm regen myproj <failed-node>           # retry just that one
```

**Restructure changed and per-item nodes are stale (rare but happens after
big LLM-driven structure changes):**
```bash
pnpm reset myproj scene_video_prompt --clean
# --clean wipes executorState entirely so the graph rebuilds from scratch
```

## What lives where in the project folder

```
<project>.kshana/
├── original_input.md              # user's story or idea
├── project.json                   # full state (phases + executorState)
├── chapters/chapter_1/
│   ├── plans/{plot,story}.md      # high-level plans (skipped if input=story)
│   └── scenes/scene_N.md          # per-scene prose
├── characters/<name>.md           # character profiles
├── settings/<name>.md             # location profiles
├── prompts/
│   ├── scene_summaries.json       # extracted summaries (P0 path)
│   ├── scene_durations.json       # per-scene budgets (duration-first path)
│   ├── videos/scenes/scene_N.json # scene_video_prompt outputs (the "shot plan")
│   ├── images/shots/scene-N-shot-M.json    # shot_image_prompt outputs
│   └── motion/scene_N_shot_M.json          # shot_motion_directive outputs
└── assets/
    ├── images/                    # generated reference + per-shot frames
    └── videos/{shots,final}/      # per-shot clips + final assembly
```

## Tips

- **Always start with `pnpm status`** when joining a project. It tells you
  the phase, what's pending, and any failures in seconds.
- **Use `inspect` before `regen`.** Read what the LLM produced first; sometimes
  you'll just want to `override` it instead of asking another LLM call.
- **`--cascade` on regen is the default mental model** when the user is
  changing semantics, not just retrying a transient failure.
- **Don't edit project.json by hand.** Use `override` (which writes the
  outputPath file AND updates state atomically). Hand-edits drift from the
  graph and cause subtle bugs.
- **Logs:** `logs/llm-calls-truncated.log` is the most useful when something
  went wrong inside an LLM call. `logs/debug.log` for ComfyUI cloud activity.
  Per-project: `<project>.kshana/logs/executor.log`.

## What this skill does NOT cover

- Editing prompt templates in `prompts/skills/defaults/` — that's source-code
  work, not pipeline driving.
- Modifying the executor / planner / extractor source. The CLI sits on top
  of those; for changes inside, work in `src/core/planner/`.
- Live UI session in `pnpm start`. The CLI is the headless equivalent.

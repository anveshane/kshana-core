# Content Generation Architecture: Legacy vs ContentDAG

## Overview

Content generation in kshana-ink has two execution paths. The **legacy path** routes through GenericAgent's multi-round subagent loop. The **ContentDAG path** uses a deterministic pipeline with a single LLM call. Both paths are invoked via the same `generate_content` tool — the routing happens based on content type.

| Content Types | Path |
|--------------|------|
| `plot`, `story`, `character`, `setting`, `scene` | **ContentDAG** (new) |
| `narration`, `outline`, `segment`, `thesis`, `research`, `script`, `scene_video_prompt`, `character_image_prompt`, etc. | **Legacy contentState** |

---

## Legacy Flow (GenericAgent → contentState → continueContentLoop)

```
┌──────────────────────────────────────────────────────────────────────┐
│  generate_content tool call                                         │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 1. Initialize contentState                                     │  │
│  │    - messages[], iterations=0, gatheringContext=true            │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 2. Context Gathering Phase (LLM call #1, WITH tools)           │  │
│  │    Tools: read_project, read_file, list_project_files          │  │
│  │    - LLM decides what files to read                            │  │
│  │    - Up to 5 tool-call rounds                                  │  │
│  │    - Temperature 0.8                                           │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 3. Content Generation Phase (LLM call #2, streaming, NO tools) │  │
│  │    - Generates content wrapped in <generated_content> tags     │  │
│  │    - Streams to UI in real-time                                │  │
│  │    - Temperature 0.8                                           │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 4. Tag Extraction                                              │  │
│  │    - Extract content between <generated_content> tags          │  │
│  │    - Fallback: heuristic stripping if tags missing             │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 5. Metadata Generation (LLM call #3, temp=0, 200 tokens)      │  │
│  │    - Generates name + summary from content                     │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 6. Persist & Register                                          │  │
│  │    - Write file to disk                                        │  │
│  │    - persistApprovedContent() → saveCharacter/saveSetting      │  │
│  │    - Name comes from LLM-generated metadata (BUG)              │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  Can loop up to 10 iterations if content needs retry                 │
└──────────────────────────────────────────────────────────────────────┘
```

### Characteristics

- **2-3 LLM calls** per content generation (context + generation + metadata)
- **Non-deterministic context**: the LLM decides which files to read via tool calls
- **Tag-based extraction**: content must be wrapped in `<generated_content>` tags, with fallback heuristics when models don't comply
- **LLM-generated metadata**: name and summary extracted by a separate LLM call — the name used for registry is whatever the LLM produces, not the original tool argument
- **Retry loop**: up to 10 iterations, with accumulated message history

### Known Bugs (fixed by ContentDAG)

1. **Wrong entity names**: `persistApprovedContent` uses the LLM-generated name (e.g., `"Character Profile: Jan the Blacksmith"`) instead of the tool-call argument (`"Jan"`). PromptDAG can't find entities later.
2. **Scenes not in project.scenes[]**: Only `content.scenes.status` is updated to `'available'`, but nothing is pushed to `project.scenes[]`. Downstream code looking for scene refs finds nothing.
3. **Phase never advances**: The agent doesn't reliably call `update_project(transition_phase)` after content generation, leaving the project stuck.
4. **Agent loops endlessly**: When project state is inconsistent (wrong names, missing scene refs), the agent spins trying to read/register files that don't match.

---

## ContentDAG Flow (ContentDAGExecutor)

```
┌──────────────────────────────────────────────────────────────────────┐
│  generate_content tool call                                         │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 1. Validate Params                                             │  │
│  │    - name required for character/setting                       │  │
│  │    - scene_number required for scene                           │  │
│  │    - instruction required                                      │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 2. Resolve Output File (deterministic)                         │  │
│  │    - characters/{name}.profile.md                              │  │
│  │    - settings/{name}.profile.md                                │  │
│  │    - plans/scenes/scene-{n}.md                                 │  │
│  │    - plans/plot.md, plans/chapters/chapter-{n}.story.md        │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 3. Check Existing (return already_exists if !overwrite)        │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 4. Load Context (deterministic — no LLM decisions)             │  │
│  │    - buildPreloadedContext() reads the right files based on    │  │
│  │      content type + project state                              │  │
│  │    - Resolves: project metadata, story chapters, character     │  │
│  │      profiles, setting profiles, duration constraints, skills  │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 5. Assemble Prompts                                            │  │
│  │    - System: content-dag.md + content-type skills               │  │
│  │    - User: duration constraints + preloaded context + instruction│ │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 6. Single Streaming LLM Call (NO tools)                        │  │
│  │    - Temperature 0.7                                           │  │
│  │    - Streams to UI via tool_streaming events                   │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 7. Clean Output (multi-model robustness)                       │  │
│  │    - Strip thinking tags: <think>, <thinking>, <reasoning>,    │  │
│  │      <reflection>, <|think|>, plain-text preambles             │  │
│  │    - Unwrap markdown code fences                               │  │
│  │    - Strip tool-call XML                                       │  │
│  │    - Normalize heading (character/setting → # {params.name})   │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 8. Validate Output (content-type-specific structural checks)   │  │
│  │    - Plot: ≥1 heading, ≥100 chars                              │  │
│  │    - Story: ≥1 heading, ≥500 chars                             │  │
│  │    - Character: ≥3 of 7 expected sections, ≥300 chars          │  │
│  │    - Setting: ≥2 of 4 expected sections, ≥200 chars            │  │
│  │    - Scene: ≥200 chars                                         │  │
│  │    → If fails: 1 retry with feedback, then persist anyway      │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 9. Update Registry (deterministic, correct)                    │  │
│  │    - Character: push to project.characters[] with params.name  │  │
│  │    - Setting: push to project.settings[] with params.name      │  │
│  │    - Scene: push SceneRef to project.scenes[]                  │  │
│  │    - Plot/Story: updateContentStatus → 'available'             │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                         ▼                                            │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ 10. Persist File to Disk                                       │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Characteristics

- **1 LLM call** (or 2 on validation retry) — no separate context, metadata, or extraction calls
- **Deterministic context**: `buildPreloadedContext()` resolves the exact files needed based on content type and project state — no LLM decisions about what to read
- **No tag extraction**: the prompt asks for plain markdown output. `cleanOutput()` strips any contamination (thinking tags, preambles, code fences) using pattern-based cleaning
- **Params-based metadata**: name comes from `params.name` (the tool-call argument), not LLM output. Summary extracted from first paragraph.
- **Single attempt**: generates once, validates, optionally retries once with feedback — no 10-iteration loop

---

## Side-by-Side Comparison

| Aspect | Legacy (contentState) | ContentDAG |
|--------|----------------------|------------|
| **LLM calls** | 2-3 per generation | 1 (max 2 on retry) |
| **Context resolution** | LLM decides via tool calls | Deterministic (buildPreloadedContext) |
| **Tools during generation** | read_project, read_file, list_project_files | None |
| **Output format** | `<generated_content>` tags | Plain markdown |
| **Output cleaning** | Tag extraction + heuristic fallback | Multi-pattern stripping (thinking tags, preambles, code fences) |
| **Entity name source** | LLM-generated metadata | `params.name` from tool call |
| **Scene registration** | Only updates content.scenes.status | Pushes SceneRef to project.scenes[] |
| **Retry mechanism** | Up to 10 iterations with history | 1 retry with validation feedback |
| **Model robustness** | Depends on model following tag instructions | Strips contamination from any model |
| **Streaming** | Yes (with tag buffering) | Yes (direct chunk forwarding) |
| **Prompt file** | content-creator.md (with tool instructions) | content-dag.md (content-only, no tools) |

---

## Why Two Paths Coexist

ContentDAG handles the 5 core narrative types where the context requirements are well-defined and predictable. For these types, we know exactly what files are needed:

- **Plot**: needs original_input
- **Story**: needs plot + original_input
- **Character**: needs story chapters
- **Setting**: needs story chapters
- **Scene**: needs story + characters + settings

The legacy path remains for content types where context requirements are dynamic or type-specific:

- **Image/video prompts** (`character_image_prompt`, `scene_video_prompt`, etc.) — handled by PromptDAGExecutor, a separate DAG
- **Narration, outline, segment** — may need to read arbitrary project files
- **Research, thesis, script** — open-ended context needs

Over time, more content types can be migrated to DAG executors as their context patterns become clear.

---

## File Map

```
src/core/tools/builtin/contentDAG.ts    — ContentDAGExecutor (new DAG path)
src/core/prompts/contentDAGPrompt.ts    — Prompt builder for ContentDAG
prompts/subagents/content-dag.md        — System prompt (no tools, content-only)
src/core/utils/projectFileUtils.ts      — Shared file utilities

src/core/agent/GenericAgent.ts          — Router (DAG vs legacy) + legacy contentState
src/core/agent/contentContext.ts        — buildPreloadedContext (used by both paths)
prompts/subagents/content-creator.md    — System prompt for legacy path (with tools)

tests/checkpoints/content-dag.test.ts   — 33 tests (format contracts, registry, phase transitions)
```

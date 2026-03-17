# DAG Executor Architecture

## Why: The Problem with LLM-as-Router

The original kshana-ink pipeline used a single `GenericAgent` as a router. The LLM decided what to do next on every turn — dispatching sub-agents, calling tools, managing approvals — all through an ever-growing message history.

This had real costs:

| Problem | Impact |
|---------|--------|
| **Implicit workflow** | The pipeline was encoded in prompts, not code. Debugging meant reading LLM transcripts. |
| **Token waste** | Every turn carried the full conversation history. By scene 8, the context window was mostly stale context. |
| **Non-determinism** | The same project could take different paths on different runs. The LLM might forget to generate a setting reference, skip an approval, or loop. |
| **No parallelism** | One LLM call at a time, one sub-agent at a time. Character A's image had to wait for Character B's approval. |
| **Fragile error handling** | Failures triggered loop detection heuristics and nudge prompts. No structured retry or recovery. |
| **No resume** | If the process crashed after generating 5 characters, you started from scratch. |

The DAG executor replaces LLM-as-router with **deterministic graph traversal**. LLMs are still used — but only where they add value (content generation), not for routing decisions.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      DAGAgentAdapter                         │
│  Bridges DAG executor ↔ GenericAgent event interface         │
│  (so CLI and web UI work unchanged)                          │
├─────────────────────────────────────────────────────────────┤
│                       DAGExecutor                            │
│  Traverses the graph: ready nodes → execute → expand → loop │
├──────────┬──────────┬──────────┬────────────────────────────┤
│  D-nodes │  S-nodes │  U-nodes │  Expanders                 │
│  (code)  │  (LLM)   │  (user)  │  (dynamic graph growth)    │
├──────────┴──────────┴──────────┴────────────────────────────┤
│                        DAG (graph)                           │
│  Nodes + edges + dependency tracking + context builder       │
├─────────────────────────────────────────────────────────────┤
│                      DAGBuilder                              │
│  Constructs the initial static graph from template config    │
├─────────────────────────────────────────────────────────────┤
│  Persistence          │  Error Policies      │  Micro-LLM   │
│  .kshana/dag/         │  Per-node retry +    │  Last-resort  │
│  state.json           │  escalation rules    │  recovery     │
└───────────────────────┴──────────────────────┴──────────────┘
```

---

## Three Node Types

Every node in the graph is one of three types:

### D — Deterministic

Runs a handler function directly. No LLM. Fast, predictable, testable.

```
set_goal [D] → scan_assets [D] → create_plan [D] → create_timeline [D] → assemble [D]
```

Examples: setting the project goal, scanning existing assets, splitting timeline segments, FFmpeg assembly.

### S — Stochastic (LLM)

Calls the LLM with a **focused prompt** built from dependency results. Each S-node gets a fresh context — no accumulated message history. Responses are streamed in real-time.

```
generate_plot [S] → generate_story [S] → char_elena_generate [S] → scene_3_shot_2_img_prompt [S]
```

S-nodes support:
- **Prompt builders** that receive dependency results via `NodeContext`
- **Validation functions** that check output correctness (e.g., JSON schema, required fields)
- **JSON response format** auto-detection (prompts containing "Return JSON" trigger structured output)

### U — User Gate

Pauses execution and asks the user a question. The DAG blocks until the user responds.

```
approve_plot [U] → approve_story [U] → char_elena_approve [U] → shots_approve [U]
```

U-nodes support:
- **Question builders** that provide context, options, and confirmation type
- **Auto-approval** in autonomous mode (confirmation gates resolve with "Yes" after timeout)

---

## The Conversion Pattern

Each element of the old LLM-as-router system maps to a DAG primitive:

| Old (GenericAgent) | New (DAG) | Why |
|--------------------|-----------|-----|
| Tool call (e.g., `set_goal`, `scan_assets`) | **D-node** handler | Deterministic work doesn't need an LLM |
| `dispatch_content_agent` → sub-agent LLM loop | **S-node** with prompt builder | One focused LLM call with fresh context |
| `AskUserQuestion` tool call | **U-node** with question builder | Explicit pause point, not an LLM decision |
| Sub-agent dispatch decision | **Graph edge** | The routing is the graph structure itself |
| `dispatch_agent` for planning | **Expander** function | Deterministically creates per-entity nodes |
| Loop detection + nudge prompts | **Error policy** + retry | Structured retry with escalation |
| Accumulated message history | **`NodeContext.getResult(depId)`** | Only relevant dependency results, not everything |

---

## Graph Lifecycle

### 1. Static Prefix (Built by DAGBuilder)

The initial graph is known upfront:

```
set_goal [D]
  → scan_assets [D]
    → register_content [D]
      → create_plan [D]
        → present_plan [U]
          → generate_plot [S]
            → approve_plot [U]
              → generate_story [S]
                → approve_story [U]
                  → extract_entities [S] + EXPANDER
```

### 2. Dynamic Expansion (Runtime Graph Growth)

When `extract_entities` completes, its **expander** parses the extracted JSON and creates per-entity pipelines:

```
extract_entities [S]
  ├─ ENTITY EXPANDER creates:
  │   ├─ char_elena_generate [S] → char_elena_approve [U] → char_elena_img_prompt [S] → char_elena_img [S]
  │   ├─ char_marcus_generate [S] → char_marcus_approve [U] → char_marcus_img_prompt [S] → char_marcus_img [S]
  │   ├─ setting_forge_generate [S] → setting_forge_approve [U] → setting_forge_img_prompt [S] → setting_forge_img [S]
  │   └─ generate_scenes [S] (depends on ALL char/setting approvals)
  │       → approve_scenes [U]
  │         → create_timeline [D]
  │         → expand_scenes [D] + SCENE EXPANDER
  │
  ├─ SCENE EXPANDER creates (per scene):
  │   ├─ scene_1_shot_breakdown [S] → scene_1_approve_shots [U] → scene_1_expand_shots [D] + SHOT EXPANDER
  │   ├─ scene_2_shot_breakdown [S] → scene_2_approve_shots [U] → scene_2_expand_shots [D] + SHOT EXPANDER
  │   └─ ...
  │
  ├─ SHOT EXPANDER creates (per shot):
  │   ├─ scene_1_shot_1_img_prompt [S] → scene_1_shot_1_img [S] → scene_1_shot_1_video [S] → scene_1_shot_1_timeline [D]
  │   ├─ scene_1_shot_2_img_prompt [S] → scene_1_shot_2_img [S] → scene_1_shot_2_video [S] → scene_1_shot_2_timeline [D]
  │   └─ scene_1_complete [D] (gate: depends on all shot timelines)
  │
  └─ ASSEMBLY EXPANDER creates (when all scenes complete):
      └─ validate_timeline [D] → assemble [D]
```

Characters and settings expand in parallel. Scenes depend on all reference images being ready. Shots within a scene can run in parallel.

### 3. Execution Loop

```
while (dag.hasWork() && !aborted) {
    readyNodes = dag.getReadyNodes()       // pending nodes with all deps completed
    batch = readyNodes.slice(0, maxConcurrency)
    await Promise.all(batch.map(executeNode))

    if (allScenesExpanded && !assemblyAdded) {
        addAssemblyNodes()                 // terminal expander
    }

    persistState()                         // save after every batch
    if (paused) break                      // U-node waiting for user
}
```

---

## Context Flow

Each node receives a `NodeContext` that provides access to dependency results without carrying full conversation history:

```typescript
interface NodeContext {
  getResult(nodeId: string): NodeResult;           // single dependency
  getResultsByPrefix(prefix: string): Map<string, NodeResult>;  // pattern match
  getAllResults(): Map<string, NodeResult>;         // everything completed
  projectDir: string;
  templateId: string;
  metadata: Record<string, unknown>;               // node-specific data
}
```

A prompt builder for `char_elena_generate` might do:

```typescript
(ctx) => {
  const story = ctx.getResult('generate_story').content;
  const entityData = ctx.getResult('extract_entities').data;
  const elena = entityData.characters.find(c => c.name === 'Elena');
  return `Write a full character profile for ${elena.name}.\n\nRole: ${elena.role}\n\nStory:\n${story}`;
}
```

Fresh, focused context. No stale messages from 30 turns ago.

---

## Error Handling

### Per-Node Error Policies

Each node carries an `ErrorPolicy`:

```typescript
{
  maxRetries: 3,
  retryStrategy: 'same' | 'rephrase',    // rephrase = re-prompt LLM with error feedback
  onExhausted: 'ask_user' | 'skip' | 'micro_llm',
  retryDelayMs?: number                   // for rate-limited APIs (image/video gen)
}
```

Default policies by node type:

| Node Type | Max Retries | Strategy | On Exhausted |
|-----------|-------------|----------|--------------|
| D-nodes | 2 | same | ask_user |
| S-nodes (content) | 3 | rephrase | ask_user |
| S-nodes (image/video) | 3 | same | ask_user |
| S-nodes (extraction) | 3 | rephrase | ask_user |
| U-nodes | 0 | — | ask_user |
| Skippable nodes | 2 | same | micro_llm |

### Escalation Chain

```
Node fails → retry (up to maxRetries)
  → retries exhausted → onExhausted policy:
      → ask_user:  pause DAG, present error + options (Retry / Skip / Stop)
      → skip:      mark node + all transitive dependents as skipped
      → micro_llm: call cheap recovery LLM for triage decision
```

### Micro-LLM Recovery

Last-resort recovery using a cheap/fast LLM call. Receives the node's error history and downstream impact, and must choose one action:

- **`retry_modified`** — propose a fix, get one more attempt
- **`skip`** — skip node and all downstream dependents
- **`ask_user`** — escalate to the user

All decisions are logged to `recovery.log` for audit. The micro-LLM cannot modify the graph structure or touch completed nodes.

---

## Persistence & Resume

### What Gets Saved

State is saved to `.kshana/dag/` after every batch:

| File | Contents |
|------|----------|
| `state.json` | Full DAG: all nodes with status, results, error history, timing |
| `expansions.json` | Expansion event log (which node triggered which new nodes) |
| `recovery.log` | Append-only audit trail of micro-LLM recovery decisions |

S-node outputs are also saved as files under `projectDir/{characters,settings,scenes}/{nodeId}.md`.

### Resume Flow

1. Check if `.kshana/dag/state.json` exists
2. If yes: deserialize → reset any `running` nodes back to `pending` → re-attach handler functions from registries → continue execution
3. If no: build fresh DAG from template

Handler re-attachment works because persisted state stores `handlerKey` strings (e.g., `'character_generate'`), not function references. On resume, handlers are looked up from registries that are always re-registered.

---

## GenericAgent Adapter

The `DAGAgentAdapter` bridges the DAG executor to the existing `GenericAgent` event interface, so the CLI and web UI work unchanged.

### Event Mapping

| DAG Event | GenericAgent Event | Notes |
|-----------|--------------------|-------|
| D-node started/completed | `tool_call` / `tool_result` (think) | Deterministic work shown as "thinking" |
| S-node started/completed | `tool_call` / `tool_result` (generate_*) | Mapped by node ID pattern |
| S-node streaming | `streaming_text` | Real-time LLM output |
| U-node gate | `question` event | Adapter stores Promise resolve callback |
| Node failed | `notification` (error) | |

### User Interaction Bridge

```
adapter.run("Create a story about a blacksmith")
  → DAGExecutor starts async
  → ... nodes execute ...
  → U-node fires → adapter stores pendingResolve → returns {status: 'waiting_for_user'}

adapter.run(undefined, "Looks good, approved!")
  → resolves pendingResolve("Looks good, approved!")
  → executor continues from U-node
  → ... more nodes ...
```

### Autonomous Mode

When `setAutonomousMode(true)`, confirmation U-nodes (those with `isConfirmation: true`) auto-approve with "Yes" after a timeout (default 30s). Non-confirmation gates still pause for real user input.

---

## Registries

The DAG uses four registries to decouple node definitions (serializable) from runtime behavior (functions):

| Registry | Maps | Used By |
|----------|------|---------|
| `HandlerRegistry` | `handlerKey → (ctx) => NodeResult` | D-nodes |
| `PromptBuilderRegistry` | `handlerKey → (ctx) => string` | S-nodes |
| `QuestionBuilderRegistry` | `handlerKey → (ctx) => UserQuestion` | U-nodes |
| `ExpanderRegistry` | `handlerKey → (result, ctx) => DAGNodeDefinition[]` | Nodes with expanders |

This separation is what makes persistence work — `DAGNodeDefinition` stores the key string, and on resume the function is re-attached from the registry.

---

## Validation

S-nodes can carry validation functions that check output before the node is considered complete:

| Validator | Checks |
|-----------|--------|
| `validateEntityExtraction` | JSON valid, non-empty characters/settings/scenes arrays, required fields per entity, referential integrity (scene characters exist), limits (max 10 chars, max 12 scenes) |
| `validateShotBreakdown` | JSON valid, non-empty shots array, each shot has shotNumber |
| `createJSONValidator(fields)` | Generic: JSON valid, required fields present and non-null, array fields non-empty |

If validation fails, the node enters the error/retry flow rather than propagating bad data downstream.

---

## File Map

```
src/core/dag/
├── types.ts                  # DAGNode, DAGNodeDefinition, NodeContext, NodeResult, events
├── DAG.ts                    # Graph data structure, dependency tracking, context builder
├── DAGBuilder.ts             # Constructs initial graph + registers all handlers
├── DAGExecutor.ts            # Main execution loop, node dispatch, expansion orchestration
├── DAGAgentAdapter.ts        # Bridges DAG ↔ GenericAgent event interface
├── errorPolicies.ts          # Per-node-type error policies and defaults
├── microLLM.ts               # Last-resort recovery agent
├── persistence.ts            # Save/load DAG state to .kshana/dag/
├── index.ts                  # Barrel exports
└── expanders/
    ├── index.ts              # Expander barrel
    ├── entityExpander.ts     # extract_entities → per-char + per-setting nodes
    ├── sceneExpander.ts      # expand_scenes → per-scene shot breakdown nodes
    ├── shotExpander.ts       # expand_shots → per-shot img/video/timeline nodes
    └── assemblyExpander.ts   # all scenes complete → validate + assemble nodes
```

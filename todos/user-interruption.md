# User Interruption, Redirection & Selective Redo

## Problem

The dependency graph executor (`feature/dep-graph` branch) runs a deterministic loop that cannot be interrupted or redirected by the user. In the previous agentic flow (`backward-flow` / `master` branch), the agent could be paused mid-execution, given a new instruction (e.g., "change the tone to darker", "skip the intro scene"), and it would work on that instruction before resuming its previous goal.

This agentic responsiveness is completely lost. The executor now runs start-to-finish without checking for user input.

Additionally, there is no way for users to request selective redos after execution (e.g., "redo scene 1 shot 2", "regenerate all of scene 1", "redo the character image for Maya").

## What Already Exists

### Selective Redo Infrastructure (built, not wired up)

- **`invalidateNode(nodeId)`** on `DependencyGraphExecutor` — resets a node to `pending`, **cascades to all dependents** (clears `outputPath`, `artifactId`, `completedAt`, etc.), and marks the graph as incomplete so the executor loop can re-run
- **State persistence** — executor state serializes to `project.json` (`executorState` field) and restores via `fromState()`. Completed nodes survive reconnects.
- **Self-repair for failed nodes** — the executor already retries `failed` nodes automatically (up to 3 `MAX_SELF_REPAIRS`)
- **Node metadata** — each node tracks `status`, `outputPath`, `outputPaths`, `artifactId`, `dependencies`, `dependents` — all the data needed to identify what to redo and what cascades

### Interruption Stubs (defined, not functional)

- `stop()` method on ExecutorAgent — one-way kill switch, no resume
- `_userResponse` parameter on `run()` — defined but completely unused (prefixed with `_`)
- `askApproval()` method — returns hardcoded `true` with TODO comment
- `injectInput?(input: string)` on SessionAgent interface — never implemented in ExecutorAgent
- WebSocket `user_response` message handler — calls `sendResponse()` which re-invokes `run()`, but only works when session is in `awaiting_input` state (which the executor never enters)
- WebSocket `cancel` message — calls `cancelTask()` but no abort signal propagation to LLM/media operations

## What's Missing

### Mid-Execution Interruption

1. **No mid-execution checkpoints** — the main loop never checks for pending user messages between node executions
2. **No message queue** — user messages sent during execution are rejected (session not in `awaiting_input` state)
3. **No pause/resume** — `stop()` terminates execution; there's no way to pause, inject instructions, and resume
4. **No abort signal propagation** — `session.abortController` exists but signals don't reach LLM calls or ComfyUI media generation
5. **No response routing** — no way to match user responses to specific pending questions
6. **`askApproval()` auto-approves** — expensive operations (media generation) bypass user confirmation

### Selective Redo (wiring only — core logic exists)

1. **No `redo_node` WebSocket message type** — not in `ClientMessageType`
2. **No WebSocket handler for redo** — `WebSocketHandler` doesn't handle redo requests
3. **No public method on ExecutorAgent** — `invalidateNode()` is only called internally during init for stuck node cleanup; no `redoNode()` method exposed
4. **No ConversationManager flow** — no way to trigger partial re-execution on a completed session
5. **No frontend redo UI** — no redo/regenerate buttons on todos or assets; todo list is read-only
6. **No natural language → node ID mapping** — no way to parse "redo scene 1 shot 2" into the correct node ID

## UX Approach: Hybrid (Buttons + Chat)

Buttons for simple "retry as-is" redos. Chat for complex redos with modifications. Both paths use the same backend (`invalidateNode()` → resume executor).

### Buttons (direct manipulation)

- **Redo icon on todo items** — appears on hover for completed todos. Click → confirmation toast ("Redo scene 1 shot 2? This will also redo: shot_video_2") showing cascade impact → invalidate → executor resumes
- **Regenerate button on asset cards** — on images/videos in the sidebar asset grid. Same flow as todo redo but entry point is the asset rather than the todo
- Buttons teach users that redo is possible (discoverability). Chat-only would hide this capability

### Chat (natural language with LLM intent parsing)

- For complex requests that buttons can't express:
  - "redo scene 1 shot 2 but make it a close-up" → invalidate + modify the motion directive before re-executing
  - "redo all of scene 1" → invalidate multiple nodes at once
  - "regenerate Maya's character image with darker hair" → invalidate + inject modified prompt context
  - "redo everything from scene 2 onwards" → bulk invalidation
- LLM parses intent → resolves to node IDs → optionally modifies prompts/context → calls `invalidateNode()` per node → executor resumes
- The button path is really just a shortcut for the simple chat case (no modifications)

### Mid-execution interruption UX

- Chat input stays active during execution (already is)
- User types a message → visual indicator: "Queued — will process after current node completes"
- At next node boundary, executor pauses, LLM processes the instruction, then either:
  - Modifies remaining execution (e.g., "make it darker" → adjusts pending prompts)
  - Invalidates + redoes completed nodes (e.g., "go back and redo scene 1")
  - Resumes unchanged (e.g., "how many shots are left?")

## What Needs to Happen

### Phase 1: Button-based Selective Redo (lower effort — infrastructure exists)

1. **Add `redo_node` message type** to `ClientMessageType` in `src/server/types.ts`
2. **Expose `redoNode(nodeId)` on ExecutorAgent** — calls `invalidateNode()`, persists state, resumes the main execution loop for invalidated nodes only
3. **Add WebSocket handler** — receives redo request, maps to node, calls `redoNode()`
4. **Add redo buttons in frontend** — hover-reveal redo icon on completed todo items, regenerate button on asset cards
5. **Cascade preview** — before confirming redo, show which dependent nodes will also be invalidated (e.g., "This will also redo: shot_video_2, final_assembly")
6. **Node ID resolution** — todos and assets already carry node IDs from the executor; wire them through to the redo message

### Phase 2: Chat-based Redo with Modifications (medium effort)

1. **Natural language → node ID mapping** — LLM parses "redo scene 1 shot 2" into the correct node ID(s). Provide node list as context so the LLM can match
2. **Prompt modification before redo** — when user says "redo X but change Y", the LLM modifies the relevant prompt/context before invalidation so the re-execution produces different output
3. **Bulk invalidation** — support "redo all of scene 1" → invalidate multiple nodes + their cascades in one operation
4. **Redo confirmation in chat** — show what will be invalidated and re-executed, let user confirm or adjust

### Phase 3: Mid-Execution Interruption (higher effort)

1. **Message queue between nodes** — check for pending user messages after each node completes, before picking the next node
2. **Pause/redirect flow** — when user sends a message during execution, queue it; at next checkpoint, pause the executor, process the instruction (possibly via LLM to understand intent), then either modify remaining execution plan or resume
3. **Queued message indicator** — frontend shows "pending" state on user messages sent during execution
4. **Abort signal propagation** — wire `abortController.signal` through to LLM API calls and ComfyUI polling so cancellation actually stops in-flight work
5. **`askApproval()` implementation** — emit a question event, set session to `awaiting_input`, wait for user response, resume with answer
6. **Node-level state preservation** — if paused mid-execution, preserve which nodes are done, which are in-flight, and which are pending so the executor can resume cleanly

## Key Files

- `src/core/planner/ExecutorAgent.ts` — main execution loop (line ~498), `stop()`, `askApproval()`, `_userResponse`
- `src/core/planner/DependencyGraphExecutor.ts` — `invalidateNode()` (line ~209), node scheduling, state serialization
- `src/server/ConversationManager.ts` — `sendResponse()`, `injectInput` interface, session state management
- `src/server/WebSocketHandler.ts` — `user_response` and `cancel` message handling
- `src/server/types.ts` — `ClientMessageType` enum

## Priority

Medium-High — Phase 1 (selective redo) is high value for low effort since the graph infrastructure already exists. Phase 2 (mid-execution interruption) is more complex.

## Reference

Check `master` or `backward-flow` branch for the agentic flow where the agent checked for user input between tool calls and could redirect mid-execution.

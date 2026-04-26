# Wrap ExecutorAgent in a GenericAgent (control-plane / data-plane split)

## Status: PARKED — direction confirmed, not yet implemented

## The shape

Today `ExecutorAgent` does everything: it owns the dependency graph, drives
LLM calls, manages media generation, persists state, and is also the thing
the CLI (`pnpm run-to`, `pnpm reset`) and the web server talk to directly.
That conflates two layers:

  1. **Data plane** — actually executing the dependency graph: resolving
     deps, calling LLMs, generating images/videos, writing to disk,
     emitting timeline updates.
  2. **Control plane** — talking to the user, eliciting the requirement,
     deciding *what* to run, when to reset, when to redo just one shot,
     when to pause and ask a question, when to hand off to the executor.

The plan is to split these by wrapping `ExecutorAgent` in a `GenericAgent`.

## Roles

**GenericAgent** (control plane)
  - The thing the user actually talks to (CLI, web UI, eventually a chat).
  - Owns the conversation loop.
  - Owns high-level operations: `run-to <stage>`, `reset <stage>`,
    `redo <node>`, `audit`, `regenerate prompts`, etc.
  - Decides when to invoke the executor and with what target.
  - Interprets executor failures and decides whether to retry, ask
    the user, or surface the error.
  - Carries the user's intent (style preferences, deadline, "don't
    regenerate already-good shots") and applies it to executor calls.

**ExecutorAgent** (data plane — what we have today, mostly)
  - Pure execution: given a target stage and a project, drive the graph.
  - Doesn't ask questions; reports outcomes.
  - Doesn't know about CLI vs web; emits structured events.
  - Stateless across calls beyond the project files on disk.

## Why this matters

  - `pnpm run-to` is the workhorse and *must keep working* — the underlying
    executor code is the most valuable thing in the codebase. The wrap
    is additive: GenericAgent calls executor; CLI calls GenericAgent.
  - Lets GenericAgent compose multiple executor runs (e.g. "regen prompts,
    audit, if clean then run media") without baking that logic into the
    executor itself.
  - Makes the conversational web UI tractable: GenericAgent is what the
    chat surface talks to, executor stays mechanical.
  - Cleaner test boundary: executor takes a project + target and runs;
    GenericAgent's logic about *when* to do that is testable separately.

## Sketch (not binding)

```ts
class GenericAgent {
  constructor(private executor: ExecutorAgent) {}

  // High-level operations the user invokes (or that GenericAgent
  // schedules itself based on conversation):
  async runTo(stage: string, opts?: { skipMedia?: boolean }): Promise<RunResult> { ... }
  async reset(stage: string): Promise<ResetResult> { ... }
  async redoNode(nodeId: string): Promise<RunResult> { ... }
  async auditPrompts(): Promise<AuditReport> { ... }

  // Conversation surface:
  async handleUserMessage(msg: string): Promise<AgentResponse> { ... }
}
```

`pnpm run-to` becomes `genericAgent.runTo(stage)` instead of poking the
executor directly. The CLI is a thin wrapper that constructs a
GenericAgent and calls one method.

## Resume trigger

Pick this up after the layered Klein compositing work (see
`/todos/...`) — we'll want the control plane in place before we
add multi-stage media operations because GenericAgent is the right
home for "compose this character in, then this one, then assemble".

## Files likely to touch

  - `src/core/planner/ExecutorAgent.ts` — extract the API surface
    GenericAgent will consume; keep executor code intact.
  - `src/core/planner/GenericAgent.ts` — new.
  - `scripts/run-to.ts`, `scripts/reset-project.ts` — call
    GenericAgent instead of constructing executor directly.
  - `src/server/ConversationManager.ts` — hand user messages to
    GenericAgent; route executor events through.

## Out of scope for the first pass

  - Don't try to make GenericAgent itself an LLM-driven agent yet.
    Start as a deterministic dispatcher. The "agentic chat" surface
    can come later once the boundary is clean.
  - Don't refactor the executor's internals — only its public API.

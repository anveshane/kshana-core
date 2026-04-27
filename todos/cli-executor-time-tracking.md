# CLI Executor-Time Tracking — Two Persistence Gaps

## Context

`pnpm status <project>` reports an "Executor time" metric — sum of
`(completedAt − startedAt)` across all nodes. The intent (per user
2026-04-27): a single number for "how much real work did the pipeline
do, end to end, across iterations, excluding stuck/idle gaps." A stuck
node has `startedAt` but no `completedAt` → contributes 0 → idle time
is naturally excluded.

The metric is computed correctly. But two persistence gaps prevent it
from being meaningful on real projects:

## Gap 1 — `markStarted` is bypassed on fast-path completions

`DependencyGraphExecutor.markStarted()` sets `node.startedAt`. But several
paths in `ExecutorAgent.ts` call `markCompleted()` without ever calling
`markStarted()` first. Observed sites:

- Lines 1812, 1816 — input-handling paths (e.g. `skipped-input-is-story`)
- Lines 2137, 2154, 2171 — `--skip-media` test mode
- Line 2253, 2430, 2451 — some media-gen paths

For these nodes the persisted record carries `completedAt` but no
`startedAt`, so they contribute 0 to executor time. That's "correct" in
the sense that they didn't take real work, but skipping `markStarted` on
slow paths (e.g. media gen on line 2430) is wrong — those WERE real work.

**Fix shape:**

- Audit every `markCompleted` call in `ExecutorAgent.ts`. For each one,
  ensure a corresponding `markStarted` fired upstream in the same code
  path. Skipped/short-circuit cases (truly zero work, like
  `skipped-input-is-story`) can stay as-is — they're correctly counted
  as 0 work.
- Where the pattern is "started elsewhere then marked completed by a
  callback" (e.g. parallel media-gen handler at line 2430), confirm the
  upstream caller invoked `markStarted` on this exact node id.
- Add a debug-only assertion in `markCompleted`: if
  `node.startedAt === undefined` and `node.status !== 'completed'` (i.e.
  this is a real first-time completion, not an idempotent re-mark),
  log a warning so future regressions are caught early.

## Gap 2 — `executorState` not persisted to `project.json` on some runs

Live observation 2026-04-27: a kareema run was actively progressing
(executor.log showed `[68/106]`, `productionStartedAt` updated, content
fields updated) but `project.json::executorState` was missing entirely.
For the woman_medieval_village_betrothed project, `executorState` IS
present, so this isn't a global break — it depends on the project type
or how it was created.

**Diagnostic steps:**

1. Identify the divergence: what's different between the kareema project
   and a project where `executorState` persists (e.g.
   `woman_medieval_village_betrothed`)? Candidates:
   - Different template (`narrative` vs ?)
   - Different `inputType` (kareema is `idea`, woman is `story`)
   - Different code path at creation
2. Verify `ExecutorAgent.persistState()` is reached at all on the kareema
   run. Check whether it writes a partial blob or none. Likely the
   project is using a different ProjectManager that doesn't carry the
   `executorState` field forward when re-saving.
3. If `GenericProjectManager` (used by some templates) drops
   `executorState` on its save path while `ProjectManager` keeps it,
   reconcile the two.

**Fix shape:**

- Either consolidate to a single save path that always preserves
  `executorState`, or add a defensive merge in
  `ExecutorAgent.persistState()` that reads the on-disk file, sets
  `executorState` on it, and writes back — so whatever else is
  managing `project.json` doesn't accidentally truncate the executor
  blob.
- After the fix, verify on a fresh `pnpm new ... --duration 60` run
  that `executorState.nodes[*]` carries both `startedAt` and
  `completedAt` after each node finishes.

## Done when

- A fresh end-to-end run on a kareema-style project (`inputType: 'idea'`)
  ends with `pnpm status <project>` showing `Executor time: <real value>`,
  not `0s (no executor state persisted yet)`.
- Sum of per-node executor time roughly equals wall-clock minus idle
  gaps (LLM thinking time + image-gen waits should both count; only
  user-input pauses and stuck/abandoned nodes should be excluded).
- A `--cascade` regen across iterations accumulates executor time
  rather than resetting it (so the "across iterations" requirement
  holds).

## Out of scope

- Sub-node breakdown (per-LLM-call time, per-Comfy-call time). The
  per-node sum is sufficient for the "how long did this take" question.
- Phase-level timing rollups beyond what's already in the existing
  `phases[*]` records. Those are wall-clock and serve a different purpose.

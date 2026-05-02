# Cleanup: Pre-Refactor Agent Architecture (Deprecated, Marked for Deletion)

## Background

`GenericAgent` and the Plan / Explore / content-creator / image-generator /
video-assembler sub-agent dispatch layer were removed in the
graph-as-source-of-truth refactor. See `src/core/index.ts:1` for the canonical
note. `ExecutorAgent` is now the only agent — it walks a dependency graph and
each node makes its own LLM call directly through the router. There is no
`Task`-tool dispatch to specialized sub-agents.

The same refactor obviated the per-item approval-gate flow ("approve this
character image / scene prompt / shot video before continuing"). The executor
generates, cascades regenerations, and surfaces results; it does not pause for
per-item approval.

A lot of code, types, and prompt files survived the refactor by accident —
nothing imports them, nothing reads them, but they were never deleted. This
todo tracks that cleanup.

> **Important:** A separate `todos/approval-gates.md` proposes a *new* feature
> (structured review criteria + LLM self-review) that would reintroduce a
> reviewed approval flow. That feature is unbuilt. The artifacts listed below
> are leftovers from the *old* approval-fatigue implementation, not in flight
> for the new one — safe to delete. If the new approval-gates feature is built
> later, it will introduce its own types and callbacks, not revive these.

## Deprecation markers

All items listed below now carry `@deprecated DELETE — ...` JSDoc tags or
HTML-comment headers pointing to this file. TypeScript will surface every
reference site as a `[6385]` deprecation diagnostic.

## Deletion list

### 1. Approval-system types in `src/tasks/video/workflow/types.ts`

- `ItemApprovalStatus` (line ~303)
- `ItemApprovalEntry` (line ~308)
- All `*ApprovalStatus` and `*ApprovedAt` fields on `CharacterData`,
  `SettingData`, and `SceneRef`. The fields are required by the type today
  but never set or read anywhere.
- `src/tasks/video/workflow/ProjectManager.ts` lines 27–28 — orphan imports
  of `ItemApprovalStatus`, `ItemApprovalEntry`. (Already flagged by the
  unused-vars diagnostic.)

### 2. Sub-agent prompt builders in `src/core/prompts/index.ts`

All marked `@deprecated DELETE`:
- `buildContentPrompt`
- `buildImageGenerationPrompt` + `VideoGenerationPromptOptions`
- `buildVideoGenerationPrompt`
- `buildPlanningPrompt` (also dead — same family)
- `buildExplorePrompt` (also dead — same family)
- `buildSkillPrompt` (also dead — same family)
- `buildSystemMessage` (only re-exported through `src/core/index.ts`; no
  call sites in src/. Re-export should also go.)

`buildRemotionAgentPrompt` is **alive** — used by
`src/tasks/video/remotionAgent.ts`. Do NOT delete.

Likely also dead helpers in the same file — verify before deleting:
- `wrapUserTask`, `wrapCustomPrompt`
- `buildProjectStateSection`, `getPromptMetadata`
- `resolveSkillContext`, `loadContentTypeSkills`
- `ContentType`, `SkillType`
- `buildEnvContext`, `toPromptContext`

### 3. Task tool

- `src/core/tools/builtin/taskTool.ts` — entire file dead. Marked.
- `src/core/tools/index.ts::createDefaultToolRegistry` — zero callers; was
  the registry consumed by the deleted `GenericAgent`. Marked.
- The re-export of `taskTool` from `src/core/tools/index.ts` and
  `src/core/tools/builtin/index.ts` should also go.

### 4. WorkflowLogger

- `src/tasks/video/workflow/WorkflowLogger.ts` — entire file dead.
  `getWorkflowLogger`, `resetWorkflowLogger`, and `WorkflowLogger.logApprovalUpdate`
  have zero callers in src/. The export forwards in
  `src/tasks/video/workflow/index.ts` (lines ~115–118) should also go.

### 5. Executor callback shape

- `src/core/planner/types.ts::ExecutorCallbacks` — interface and all members
  (`onNodeStarted`, `onApprovalNeeded`, `onNodeCompleted`, `onNodeFailed`,
  `onComplete`, `onContentStreaming`). Zero implementations, zero callers.

### 6. Prompt markdown files (loaded only by dead builders)

- `prompts/subagents/content-creator.md`
- `prompts/subagents/image-generator.md`
- `prompts/subagents/video-assembler.md`
- `prompts/subagents/plan.md`
- `prompts/subagents/explore.md`
- `prompts/system/subagent.md`
- `prompts/system/explore.md`
- `prompts/system/classification/content-approval.md`
- `prompts/system/classification/image-approval.md`
- `prompts/system/classification/plan-approval.md` — and the empty
  `classification/` directory once the three above are gone.

`prompts/subagents/remotion-agent.md` is **alive** (loaded by
`buildRemotionAgentPrompt`). Do NOT delete.

`prompts/system/orchestrator.md` is loaded by `buildSystemMessage` which is
itself dead — confirm before deleting.

`prompts/system/pi-orchestrator.md` is **alive** (loaded by
`src/agent/pi/prompt.ts`). Do NOT delete.

### 7. Stale documentation

- `docs/agent-architecture.md` — describes the pre-refactor architecture
  in detail. Header note added; full deletion preferred.

### 8. In-prompt references to the dead Task / sub-agent flow

- `src/tasks/video/index.ts::buildTemplateAgentPrompt` (already marked
  `@deprecated`, function still emits a prompt that references `Task` and
  approval gates). Function has zero callers — safe to delete entirely
  rather than just marking. Lines ~143–234.
- `src/tasks/video/workflow/FileTools.ts` — message strings reference
  "user approval workflow." Verify whether any of `getWorkflowFileTools` /
  `getAllFileTools` / `getAllWorkflowTools` have live callers; the surface
  search at the time of this todo found zero.

### 9. Stale memory entries

- `~/.claude/.../memory/MEMORY.md` had `prompts/subagents/*.md` listed as
  "loaded at runtime." Already corrected (see commit/history of MEMORY.md).
  Add a `project_executor_only_agent.md` pointer if not already present.

## Acceptance criteria

- `git grep -n "ItemApprovalStatus\|ItemApprovalEntry\|approvalStatus\|approvedAt"` returns zero hits in `src/`.
- `git grep -n "buildContentPrompt\|buildImageGenerationPrompt\|buildVideoGenerationPrompt\|buildPlanningPrompt\|buildExplorePrompt\|buildSkillPrompt\|buildSystemMessage" src/` returns zero hits.
- `git grep -n "taskTool\|createDefaultToolRegistry" src/` returns zero hits.
- `git grep -n "WorkflowLogger\|logApprovalUpdate" src/` returns zero hits.
- `git grep -n "ExecutorCallbacks\|onApprovalNeeded" src/` returns zero hits.
- `prompts/subagents/{content-creator,image-generator,video-assembler,plan,explore}.md` do not exist.
- `prompts/system/classification/` directory does not exist.
- `prompts/system/{subagent,explore}.md` do not exist.
- `docs/agent-architecture.md` is deleted; `docs/agent-interfaces.md` is
  unchanged (it documents the live external interfaces).
- `pnpm test` and `pnpm lint` (the project's `tsc --noEmit && eslint .`
  combo) pass.
- The TypeScript `[6385]` deprecation diagnostic count in the workspace
  drops to zero for these symbols.

## Out of scope

- The new structured-review feature in `todos/approval-gates.md`. That is a
  separate, unbuilt feature.
- Cleanup of dead code outside the agent-architecture / approval surface
  (e.g. `frontend/`, ProjectManager unused-import noise from the
  diagnostics queue). Track those separately.

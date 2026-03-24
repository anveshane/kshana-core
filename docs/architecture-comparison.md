# Architecture Comparison: GenericAgent (main) vs ExecutorAgent (feature/dep-graph)

## Overview

The **main branch** uses `GenericAgent` — an LLM-driven agent loop where the model decides what to do next, calls tools, spawns sub-agents, and manages user interaction. The **feature/dep-graph branch** uses `ExecutorAgent` — a deterministic code-driven loop where the dependency graph decides what's next and the LLM is called as a pure content generator with no tools.

---

## What We Gained

### 1. Deterministic Execution Order
The executor never gets lost. The dependency graph guarantees correct ordering — plot before story, story before characters, characters before character images. The old agent navigated this via prompt instructions and TodoWrite, which degraded over long conversations.

### 2. Reliable Session Resume
Executor state is serialized to `project.json` with per-node status. On resume, `getNextReady()` returns exactly the right next node. The old agent relied on conversation history + `create_backward_plan` re-computation, which could diverge after context compression.

### 3. Transparent Progress Tracking
Every node has explicit status (pending/in_progress/completed/failed). The todo list in the UI directly reflects graph state. The old agent's progress was tracked via TodoWrite which the LLM could forget to update.

### 4. Redo with Cascade Invalidation
`invalidateNode("scene:scene_2")` deterministically resets that node and all downstream dependents. The old agent had to reason about what to regenerate, sometimes missing cascading impacts.

### 5. Dynamic Collection Expansion
When the story reveals 5 characters, the graph expands deterministically. The old agent had to be told (or figure out) how many characters to generate, and could lose track.

### 6. No Context Window Degradation
Each LLM call is independent — fresh system + user prompt. The old agent's context window filled up over 30+ turns, requiring compression which could lose important details.

### 7. Consistent Prompt Structure
Every node type gets the same prompt template + skills. The old agent's prompts varied based on conversation context and which sub-agent was spawned.

---

## What We Lost

### 1. User Approval Flow
**Main branch:** The agent asks the user before expensive operations (image/video generation). The user can approve, reject, or provide feedback. The agent waits via `AskUserQuestion` and resumes when the user responds.

**Dep-graph:** `askApproval()` auto-approves everything. No question events are emitted. No `injectInput()` method. No `waiting_for_user` return status. The executor runs to completion without user checkpoints.

**Impact:** Users cannot review and approve generated content before it's committed. They cannot provide feedback like "make the character more menacing" to iterate on a result.

### 2. Multi-Turn Feedback & Refinement
**Main branch:** Sub-agents (content, image, planning) have approval loops that iterate up to 10 times. The user can say "make it shorter" or "add more dialogue" and the agent regenerates with that feedback in context.

**Dep-graph:** Each node is a single LLM call. There is no mechanism to retry with user feedback. Content is generated once and written to disk.

**Impact:** The user cannot iteratively refine content. If a character description is wrong, the only option is to invalidate and regenerate from scratch — losing any good parts.

### 3. Actual Image Generation
**Main branch:** `generate_image` tool calls ComfyUI via the provider registry. Images are generated, downloaded, and stored as actual PNG files. The agent handles reference image passing, workflow selection, and error recovery.

**Dep-graph:** `visual_ref` nodes generate image prompts as text files (`.prompt.md`). No connection to ComfyUI or any image provider. No actual images are produced.

**Impact:** The executor produces a complete set of image prompts but cannot turn them into actual images. The image generation pipeline is disconnected.

### 4. Actual Video Generation
**Main branch:** `generate_video_from_image` sends scene images to LTX/video providers. Videos are generated with motion prompts, downloaded, and stored.

**Dep-graph:** `clip` nodes generate motion prompt text files. No connection to video providers. No actual videos are produced.

**Impact:** Same as images — prompts exist but no media.

### 5. Image Editing (FLUX Klein)
**Main branch:** `edit_image` tool uses FLUX Klein to edit existing images with reference consistency. Users can say "change the lighting" and the agent modifies the image.

**Dep-graph:** No image editing capability at all. FLUX Klein workflow JSON is imported but not connected.

### 6. Timeline Management
**Main branch:** The agent creates a timeline skeleton (`manage_timeline create_skeleton`), updates segments as videos are generated, splits segments into shots, and assembles the final video via `assemble_from_timeline`.

**Dep-graph:** No timeline creation, no segment tracking, no final assembly. The `final_video` node just generates "assembly instructions" as text.

**Impact:** Even if images and videos were generated, there's no mechanism to assemble them into a final video.

### 7. Conversational Interaction
**Main branch:** The agent is conversational. Users can say "redo scene 3", "change the style to anime", "I have character images already", and the agent adapts dynamically. Multi-turn conversation means the agent accumulates context about what the user wants.

**Dep-graph:** The executor is non-conversational. It takes a goal and runs to completion. User messages during execution are ignored (the `_task` and `_userResponse` parameters are unused). After completion, the user can't have a conversation — they'd need to restart.

**Impact:** The creative collaboration aspect is gone. The user is a passive observer watching the graph execute, rather than an active participant guiding the creative process.

### 8. Intelligent Goal Understanding
**Main branch:** The orchestrator agent interprets natural language goals. "Turn my story into anime images" → sets target to `scene_image` with anime style. "I just want a thumbnail" → generates a single image without the full pipeline.

**Dep-graph:** The goal is hardcoded in `createExecutorAgent` as `targetArtifacts: ['final_video']`. No dynamic goal interpretation.

**Impact:** Every project targets `final_video` regardless of what the user actually wants.

### 9. Content Registration from User Input
**Main branch:** `register_user_content` lets users paste a story, provide file paths, or declare "I already have character images." The planner skips satisfied artifacts.

**Dep-graph:** No equivalent mechanism. The executor either generates everything or restores from state. Users can't provide their own content to skip generation steps.

### 10. Context Window Management
**Main branch:** GenericAgent monitors context usage (60% threshold), compresses old messages, and manages token budgets across turns.

**Dep-graph:** Not applicable — each call is independent. But this means the executor can't benefit from accumulated conversation context for creative coherence.

### 11. Tool Confirmation Framework
**Main branch:** Complex tools (generate_image, generate_video) require user confirmation before execution. Simple tools run automatically.

**Dep-graph:** No distinction between simple and complex operations. Everything auto-executes.

### 12. Error Recovery with User Choice
**Main branch:** When a tool fails, the agent reports the error and asks the user how to proceed (retry, skip, or abort).

**Dep-graph:** Transient errors get one auto-retry. Permanent failures are marked and dependents are blocked. No user choice.

---

## Capability Matrix

| Capability | GenericAgent (main) | ExecutorAgent (dep-graph) |
|---|---|---|
| Deterministic execution order | No (LLM decides) | **Yes** |
| Reliable session resume | Partial (conversation-based) | **Yes** (graph state) |
| Progress tracking | Via TodoWrite (LLM-managed) | **Yes** (graph-derived) |
| Redo with cascade | Manual (LLM reasons) | **Yes** (deterministic) |
| Collection expansion | Manual (LLM decides) | **Yes** (automatic) |
| Context window stability | Degrades over time | **Yes** (independent calls) |
| User approval flow | **Yes** (question events) | No (auto-approves) |
| Feedback/refinement loops | **Yes** (10-iteration loops) | No |
| Actual image generation | **Yes** (ComfyUI integration) | No (text prompts only) |
| Actual video generation | **Yes** (LTX integration) | No (text prompts only) |
| Image editing | **Yes** (FLUX Klein) | No |
| Timeline management | **Yes** (create/update/assemble) | No |
| Final video assembly | **Yes** (FFmpeg) | No |
| Conversational interaction | **Yes** (multi-turn) | No (run-to-completion) |
| Goal interpretation | **Yes** (natural language) | No (hardcoded) |
| User content registration | **Yes** (register_user_content) | No |
| Error recovery with user choice | **Yes** (ask user) | No (auto-retry once) |
| Skill-aware prompt generation | No | **Yes** (guides + model skills) |
| Duration-aware shot planning | No | **Yes** (per-scene/per-shot) |
| Think block separation | No | **Yes** (shown but not saved) |

---

## Recommendation

The executor architecture solves the right problem (agent getting lost in long sessions) but went too far in removing capabilities. The ideal architecture would combine:

1. **Deterministic graph navigation** from the executor (what to do next)
2. **User interaction and approval** from GenericAgent (the human in the loop)
3. **Actual media generation** from the existing tools (ComfyUI, LTX, FFmpeg)
4. **Feedback loops** for iterative refinement (the creative collaboration)

The executor should be the **backbone** that ensures correct ordering and progress tracking, while the agent capabilities should be layered on top for user interaction and media generation at each node.

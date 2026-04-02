# User Interventions — Mid-Execution Content Editing & Graph Modification

## Problem

Users see results they want to change but have no way to intervene without resetting entire stages. Examples:

- Settings extracted as 1 combined location instead of 2 separate ones
- Character image doesn't match expectations — needs prompt tweak
- Scene should be split into 2 scenes
- A shot's camera angle is wrong — needs different direction
- Want to add a character that the LLM didn't extract

Current tools (stop, redo, reset) are all destructive — they throw away work. Users need surgical editing.

## Proposed Feature Tiers

### Tier 1: Edit Content + Redo (MVP)

**Capability**: Click on a completed node → view its output → edit the content → save → redo the node (uses edited content, regenerates downstream).

**UI**: Click on a completed todo item in the sidebar → opens a panel/modal with:
- The node's output content (markdown, JSON)
- An editable text area
- "Save & Redo" button → saves the edit, invalidates the node + dependents, re-runs

**Implementation**:
1. **Frontend**: New `NodeEditor` component — displays node content, allows editing
2. **API**: `PUT /api/v1/nodes/:nodeId/content` — updates the output file on disk
3. **Backend**: After content update, call `executor.invalidateNode(nodeId)` to cascade reset
4. **Executor**: On next run, the node is pending but has a saved output → skip LLM, use saved content, cascade downstream

**Use cases solved**:
- Edit character description → redo character_image → new reference image
- Edit setting description → redo setting_image → new reference image
- Edit shot image prompt JSON → redo shot_image → new frame
- Edit scene_video_prompt JSON → change shot count, durations, strategies

### Tier 2: Split & Merge Collections

**Capability**: Split a single collection item into multiple, or merge multiple into one.

**Examples**:
- "Split setting into alleys + merchant hall" → creates 2 setting nodes from 1
- "Merge scene 3 and scene 4" → combines into 1 scene node
- "Add a new character: The Guard" → creates a new character node

**UI**: Right-click menu on a todo item → "Split", "Merge", "Add item"

**Implementation**:
1. **Split**: Parse the existing output content, create N new per-item nodes, each with a subset of the content. Invalidate downstream.
2. **Merge**: Combine N per-item outputs into 1 node, remove the others. Invalidate downstream.
3. **Add**: Create a new pending node with the given name. Wire dependencies from template. The next run generates content for it.

**Graph modifications needed**:
- `executor.addNode()` — already exists in `repairMissingNodes`
- `executor.removeNode()` — needs implementation (remove + rewire dependents)
- `executor.splitNode(nodeId, items)` — new: creates N items from 1
- `executor.mergeNodes(nodeIds)` — new: combines N items into 1

### Tier 3: Chat-Driven Edits

**Capability**: Type natural language instructions in the chat to modify content or graph.

**Examples**:
- "The investigator should have a beard" → edits character description → cascades
- "Split the setting into two locations" → modifies graph + content
- "Make scene 2 longer, 10 seconds" → edits scene_video_prompt durations
- "Add a transition between shot 3 and 4" → modifies timeline

**Implementation**:
1. **Intent detection**: Parse the user's message to determine the edit type (content edit, graph modification, parameter change)
2. **LLM-assisted edit**: Send the current content + user instruction to LLM → get modified content
3. **Apply**: Write the modified content, invalidate affected nodes
4. **Confirmation**: Show diff before applying — "Here's what will change: [diff]. Apply?"

**This is the most natural UX** but requires:
- Intent classification (is this a new task or an edit?)
- Content-aware editing (the LLM needs to understand what to change)
- Diff/preview UI
- Undo capability (save before/after for rollback)

## Priority Order

1. **Tier 1** (Edit + Redo) — highest value, simplest implementation
2. **Tier 2** (Split/Merge) — solves the settings/scene splitting problem directly
3. **Tier 3** (Chat-driven) — best UX but most complex

## Key Files

### Tier 1
- `frontend/src/components/NodeEditor.tsx` — new: editable content panel
- `frontend/src/components/Sidebar.tsx` — add click handler on todo items
- `src/server/routes.ts` — add `PUT /api/v1/nodes/:nodeId/content`
- `src/core/planner/ExecutorAgent.ts` — handle "content already saved, skip LLM" path

### Tier 2
- `src/core/planner/DependencyGraphExecutor.ts` — `splitNode()`, `mergeNodes()`, `removeNode()`
- `src/server/routes.ts` — add graph modification endpoints
- `frontend/src/components/Sidebar.tsx` — context menu with Split/Merge/Add

### Tier 3
- `src/core/planner/ExecutorAgent.ts` — intent detection in `run()` for edit commands
- `src/core/llm/` — edit prompt builder
- `frontend/src/components/ChatTimeline.tsx` — diff preview before apply

## Design Considerations

- **Undo**: Every edit should save a before/after snapshot for rollback
- **Conflict**: If the user edits while execution is running, queue the edit for after the current node completes
- **Validation**: Edited JSON must pass the same validation as LLM output (prevent broken prompts)
- **History**: Show edit history per node (who changed what, when)
- **Cascade preview**: Before applying an edit, show which downstream nodes will be invalidated ("This will regenerate 14 shot images and 14 videos — proceed?")

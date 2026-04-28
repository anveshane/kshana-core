# Reset Should Preserve Upstream Per-Item Nodes

## Problem

When resetting to `characters`, the reset removes per-item nodes for ALL downstream types including `scene:scene_1`, `scene:scene_2`, etc. Later resets to `scene_video_prompt` find only type-level collection nodes with no per-item children. The executor then generates ALL scenes/shots in one monolithic LLM call instead of per-scene, causing truncation.

## Root Cause

The reset script removes per-item nodes for ALL types in the reset cascade. But per-item nodes for types ABOVE the target are still valid — their content hasn't changed. For example, resetting `character_image` should NOT remove `scene:scene_1` nodes, because scene content is still valid.

## Current Behavior

1. `/reset characters` → removes `scene:scene_1`, `scene:scene_2`, etc.
2. Scenes re-generate and re-expand into per-scene nodes
3. `/reset scene_video_prompt` → removes SVP per-scene nodes
4. SVP regenerates as ONE monolithic call (no per-scene children to expand into)

## Desired Behavior

1. `/reset characters` → resets character/setting nodes, cascades to scene (re-extracts), SVP, etc.
2. Per-scene nodes are recreated from fresh scene extraction
3. `/reset scene_video_prompt` → SVP per-scene nodes reset to pending (not removed)
4. Each per-scene SVP regenerates independently (4-6 shots, not 37)

## Proposed Fix

Option A: Don't remove per-item nodes — just reset their status to pending and clear outputPath. The expansion already happened; the items are known. Only remove if the upstream item set changed (e.g., story rewrite adds/removes characters).

Option B: When Phase 5 recreates collection nodes, parse the upstream content files (not the node graph) to determine the item set. E.g., read `characters/.md` to find character names, read scene_video_prompt JSONs to find shot lists.

## Priority

High — this affects every reset + re-run cycle. The current workaround is to always reset far enough upstream that the full expansion cascade re-runs, but this wastes significant LLM compute.

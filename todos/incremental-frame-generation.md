# Incremental Frame Generation — Don't Re-generate Succeeded Frames

## Priority: HIGH

## Problem

When a shot_image node has multiple frames (first_frame, last_frame, mid_frame), if the first frame succeeds but the last frame fails, the entire node is marked as failed. On retry, ALL frames are regenerated — wasting expensive cloud GPU time on the already-succeeded first frame.

## Fix

Make per-frame generation incremental:
1. Save each frame's output path to `node.outputPaths` as it completes (already happening)
2. On retry, check `node.outputPaths` — skip frames that already have a valid file on disk
3. Only generate missing/failed frames
4. Node succeeds when ALL required frames have valid outputs

## Key File
- `src/core/planner/ExecutorAgent.ts` — `executeShotImage()` around line 3060-3140

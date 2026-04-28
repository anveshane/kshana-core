# Show All Frames in Shot Video UI Card

## Priority: MEDIUM

## Problem

The Shot Video tool card only shows the first frame thumbnail. For FLFV (first+last) and FMLFV (first+mid+last), all keyframe images should be visible so the user can see what the video will interpolate between.

## Fix

In `frontend/src/components/ToolCallCard.tsx` → `ShotVideoBody`:
- Read the shot_image node's `outputPaths` (first_frame, last_frame, mid_frame)
- Display all available frame thumbnails in a row
- Label each: "First", "Mid", "Last"

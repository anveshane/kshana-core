# Timeline Auto-Linking

## Problem

After `generate_video_from_image` produces a video, the timeline segment still points to the old artifact. The agent must manually call `manage_timeline(update_segment)` to link the new video. If forgotten, assembly silently uses stale content.

## Solution

The `generate_video_from_image` tool accepts an optional `segment_id` parameter. When provided, the tool automatically updates the timeline segment's layers with the new video artifact after successful generation — in a single atomic operation.

```
generate_video_from_image({
  shot_image_artifact_id: "img_abc123",
  scene_number: 2,
  shot_number: 1,
  motion_prompt: "slow zoom in",
  segment_id: "segment_1_shot_1"   // ← auto-links to timeline
})
```

The return value includes confirmation:
- `segment_id` — echoed back (undefined if not provided)
- `timeline_updated` — `true` if the timeline was updated, `false` otherwise

## Segment ID Convention

Segment IDs follow the pattern `segment_{N}_shot_{M}` where:
- `N` is the 0-based segment index (from `createTimelineSkeleton`)
- `M` is the 0-based shot index (from `splitSegmentIntoShots`)

Example: Scene 3, Shot 2 → `segment_2_shot_1` (0-indexed)

## Redo Behavior

When regenerating a clip, pass the same `segment_id` again. The new video automatically replaces the old one in the timeline — no extra `update_segment` call needed. Then call `assemble_from_timeline` to produce an updated final video.

## Why `update_segment` Still Exists

The `manage_timeline(update_segment)` action remains available for:
- Adding non-video layers (audio, narration, overlays)
- Updating multiple layers at once
- Manual corrections or custom layer configurations
- Any segment update not tied to video generation

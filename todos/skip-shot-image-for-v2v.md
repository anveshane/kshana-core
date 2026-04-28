# Skip Shot Image Generation for V2V Extend Shots

## Priority: HIGH (saves cloud credits)

## Problem

V2V extend shots generate first_frame + last_frame images via FLUX Klein, then the video extends from the previous shot's video — never using those images. Each image costs ~15s + cloud credits.

For 18 shots with ~14 using V2V extend = 14 × 2 unnecessary image generations = 28 wasted cloud calls.

## Fix

For shots where `getVideoStrategy()` returns `v2v_extend`:
- Skip the entire shot_image generation step
- shot_video depends directly on shot_image_prompt + shot_motion_directive + previous shot_video
- Remove shot_image from the dependency chain for V2V shots
- Only generate shot_image for shots using `flfv` strategy (shot 1, set_the_world, show_change)

## Complexity

- The expansion code creates shot_image nodes for ALL shots — needs conditional creation
- shot_video currently depends on shot_image — needs conditional dependency
- The UI shows shot_image thumbnails — V2V shots won't have thumbnails (extract a frame from the video instead?)
- Timeline segments reference shot_image — needs fallback

## Key Files

- `src/core/planner/ExecutorAgent.ts` — expansion code + executeShotVideo
- `src/core/planner/crossShotChaining.ts` — getVideoStrategy
- `src/templates/narrative.ts` — shot_image/shot_video artifact definitions

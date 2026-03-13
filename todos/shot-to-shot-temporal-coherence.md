# Shot-to-Shot Temporal Coherence

## Problem
Videos feel like a "non-coherent trailer" rather than a continuous story. Each shot within a scene depicts a completely different physical space, even though character/setting consistency is handled via reference images and per-shot starting images.

## What's NOT the Problem
- Character consistency — reference images are already generated and used
- Setting consistency — setting references exist
- Per-shot starting images — these ARE injected as first frames into LTX-2

## What IS the Problem
Each shot's starting image is generated **independently from scratch** (text prompt + refs). Image generation models have no spatial memory between calls, so:
- Shot 1: Temple courtyard, camera facing north
- Shot 2: A different courtyard-ish place, camera facing east
- Shot 3: Yet another interpretation of "temple"

When cut together, it's spatially incoherent — different physical environments masquerading as the same scene. The cuts feel random, not like a filmed sequence from different angles.

## Root Cause
Shot starting images within a scene are not spatially related to each other. They share character/setting refs but each generates a **new interpretation** of the space. There's no constraint that says "all shots in this scene are the same physical space from different angles."

## Potential Strategies

### Strategy 1: Scene Establishing Image → Derive Shot Images
- Generate ONE wide establishing image per scene (the full spatial environment)
- Derive subsequent shot images via **img2img or inpainting** from the establishing image with different framing/crop
- All shots literally share the same physical space
- **Requires**: img2img support in the image generation pipeline
- **Impact**: Highest — guarantees spatial coherence

### Strategy 2: One Continuous Shot Per Scene (Fewer Cuts)
- Instead of 2-4 shots per scene, use ONE longer shot with camera movement in the motion prompt
- Eliminates inter-shot discontinuity entirely
- Cuts only happen between scenes (which is natural — different scene = different location)
- **Requires**: LTX-2 to handle longer durations (8-10 sec) with reliable motion
- **Impact**: High — simplest architectural change

### Strategy 3: Stronger Spatial Anchoring in Shot Image Prompts
- Constrain shot image prompts to explicitly describe the SAME physical space
- e.g., "Same room as establishing shot. Stone walls with torches on left, wooden table center-frame. Camera now at 45 degrees."
- Prompt engineering fix, no architectural change
- **Requires**: Updates to `shot-image-prompt.md` and `scene-video-prompt.md`
- **Impact**: Medium — relies on image model following spatial constraints (unreliable)

## Open Questions
- [ ] Does the image pipeline support img2img? (determines if Strategy 1 is viable)
- [ ] What's the max reliable duration from LTX-2? (determines if Strategy 2 is viable)
- [ ] Is this primarily a prompting problem or an architectural one?

## Key Files
- `prompts/templates/narrative/scene-video-prompt.md` — scene → multi-shot breakdown
- `prompts/templates/narrative/shot-image-prompt.md` — per-shot image prompt generation
- `src/tasks/video/tools.ts` — `generateVideoFromImageTool`, `generateImageTool`
- `src/core/timeline/TimelineTools.ts` — timeline management and assembly
- `src/core/timeline/FFmpegAssembler.ts` — final video assembly

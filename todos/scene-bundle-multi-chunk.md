# Scene-bundle multi-chunk: split long scenes across multiple relay renders

## Status: open

## What this is

Today (post `feat/ltx-prompt-relay-probe`), prompt-relay scene
rendering bails when a scene exceeds the LTX 2.3 audio-latent cap.
`checkSceneBundleEligibility` enforces:

  - shots ≤ 20  (kijai `LTXVAddGuideMulti` `num_guides`)
  - total frames ≤ 1000 (LTXVEmptyLatentAudio `frames_number`)

When either cap trips, the scene is marked permanently unbundleable
and falls back to per-shot rendering for every shot in that scene —
losing the relay's whole-scene continuity.

Found live on `kareema3.kshana` scene 1 (12 shots, 1537 frames).

## What this todo covers

Split a too-long scene into N chunks of ≤1000 frames and ≤20 shots
each, render each chunk as a separate prompt-relay bundle, and have
final assembly concatenate the chunks back together.

## Sketch

```
scene 1: 12 shots, 1537 frames
  → chunk A: shots 1-7, 879 frames (under both caps)
  → chunk B: shots 8-12, 658 frames

each chunk → independent renderSceneBundle() call
each chunk → registered as a scene_video asset with metadata
            { sceneNumber: 1, chunkIndex: 0|1, coversShots: [...] }
```

## Things to figure out

  1. **Chunk-boundary handling.** Relay smooths transitions inside a
     chunk. Between chunks (e.g. shot 7 → shot 8 in the example),
     it's a hard cut from chunk A's tail to chunk B's head — the
     two were rendered with different seeds, different model
     patches, and may not match identity. Options:
     - Accept the cut at the chunk boundary; pick boundaries at
       natural visual breaks (cuts, location changes).
     - Use the last frame of chunk A as the first first_frame of
       chunk B (keep visual continuity by sharing the anchor).
     - Render with overlap (chunk A covers shots 1-7, chunk B
       covers shots 7-12; shot 7 appears in both, the assembler
       prefers chunk B's version of shot 7's tail).
  2. **Resolver/assembler updates.** The current scene-bundle
     resolver (FFmpegAssembler tier 3.5) finds the bundle by
     `metadata.isBundle === true && metadata.sceneNumber === N`.
     For chunked scenes there are 2+ assets matching that filter.
     Need to either:
     - resolve each shot to its specific chunk based on
       `metadata.coversShots`, OR
     - register chunks with a derived sceneNumber (e.g. 1.0, 1.1)
       and have the timeline carry the chunk number.
  3. **Chunk count selection.** Given a scene's frames+shots,
     compute the smallest chunk count N such that every chunk fits
     under both caps. Prefer chunks of roughly equal size.
  4. **Concurrency.** Should chunks render serially (preserve
     coherence by chaining) or in parallel (faster, but no
     cross-chunk continuity)? Probably parallel for v1; consider
     last-frame chaining as a v2.
  5. **Reset granularity.** A single bad shot in chunk A means
     re-rendering all of chunk A. Document this; users opting in
     to relay accept the granularity tradeoff.

## Effort estimate

  - Chunk planning + asset registration with chunk metadata: ~half day
  - Resolver updates to pick the right chunk per shot: ~half day
  - Tests (boundary picks, eligibility-passing chunks, multi-asset
    resolution): ~half day

Total: **~1.5 days**, probably spread across 2 sittings.

## References

  - eligibility cap rationale: `src/core/planner/sceneBundleEligibility.ts`
  - workflow expander (handles 1..20 segments per chunk):
    `src/services/providers/promptRelayWorkflowExpander.ts`
  - resolver tier 3.5: `src/core/timeline/FFmpegAssembler.ts`
    (resolveSegmentFilePaths, ~line 230)
  - kareema3 scene 1 — live test case (12 shots, 1537 frames)

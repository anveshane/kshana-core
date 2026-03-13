# Batch Phase Pipeline — Reduce LLM↔ComfyUI GPU Switching

## Problem

LLM and ComfyUI share the same GPU. The current per-scene interleaving causes dozens of model load/unload cycles, and ComfyUI sometimes hangs when the LLM model is still resident in VRAM.

## Proposal

Restructure the orchestrator to batch work into two LLM sessions instead of constant switching:

| Session | Work |
|---------|------|
| **LLM Session 1** | Phases 1-3: all text (plot, story, breakdown) |
| **ComfyUI Batch 1** | Phases 4-5: all reference + establishing images (deterministic queue) |
| **LLM Session 2** | Phase 6: all shot breakdowns (now has establishing image paths) |
| **ComfyUI Batch 2** | Phases 7-8: all shot images + videos (deterministic queue) |
| **FFmpeg** | Phase 9: assembly |

This reduces LLM↔ComfyUI switches from **dozens** to exactly **2**.

## Hard Dependency

Phase 6 (LLM shot breakdown) requires Phase 5 (ComfyUI establishing images) to be complete — the `scene_video_prompt` JSON includes `establishingImagePath` as a real file path that becomes `image1` in Qwen Edit for shot generation.

This means ALL prompts cannot be generated upfront. But batching per phase group is fully feasible.

## ComfyUI Batches Are Deterministic

Within each ComfyUI batch, no LLM is needed — just a queue of prompts with known reference image paths. A simple deterministic loop can submit and poll jobs one at a time.

## Approval Gate Consideration

Currently `establishing_image` and `shot_image_prompt` have `requiresPerItemApproval: true`. Options:
- Move approval to after each batch (review all generated images at once)
- Auto-approve and rely on regeneration/cascade invalidation for fixes

## Implementation Notes

- Unload LLM model (`POST /models/unload`) before each ComfyUI batch
- Each ComfyUI batch is a simple sequential queue — no agent loop needed
- Within Phase 4-5 batch: character refs → setting refs → establishing images (internal ordering required since establishing needs refs as input)

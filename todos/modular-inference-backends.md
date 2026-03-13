# Modular Inference Backends (Ditch ComfyUI for Fast Native Inference)

## Problem
ComfyUI adds significant overhead as a middleware layer — workflow serialization, Python/PyTorch dynamic dispatch, VRAM fragmentation, and HTTP/WebSocket polling. A Rust-based inference engine has demonstrated 10s LTX-2.3 video generation in ~40 seconds by eliminating these layers.

## Current Architecture
The provider pattern already exists (`ComfyUIProvider` → `GenerationProvider` interface). The tool handlers (`generate_video_from_image`) go through a registry and don't care about the backend. This is ~80% of what's needed for pluggable backends.

## What a Native Engine Gains
- **Hardcoded computational graph** — no dynamic dispatch overhead from PyTorch generics
- **Custom 3D latent memory pool** — sized exactly for LTX tensor shapes, zero VRAM fragmentation
- **Zero-copy safetensors loading** — direct GPU mapping, no Python intermediary
- **No Python GIL** — true parallelism on hot paths
- **No ComfyUI overhead** — no workflow serialization, no HTTP polling, no node graph execution

## Proposed Architecture

```
src/services/inference/
  ├── InferenceProvider.ts        # Interface (extends existing GenerationProvider pattern)
  ├── InferenceRegistry.ts        # Register backends by model family
  ├── backends/
  │   ├── comfyui/                # Current ComfyUI (keep as fallback)
  │   ├── rust-ltx/               # Rust native LTX engine (FFI or subprocess)
  │   ├── onnx-runtime/           # ONNX-based inference
  │   └── tensorrt/               # TensorRT optimized
  └── models/
      ├── ltx-2.3/                # Model-specific config, tokenizer wrappers
      └── ...
```

Community contributors add a folder under `backends/`, implement the interface, and register it.

## Interface (minimum)
- `loadModel(config)` — load weights, initialize engine
- `generateVideo(prompt, params) → VideoResult` — run inference
- `getProgress() → ProgressInfo` — generation progress
- `unloadModel()` — release resources

## Implementation Phases

### Phase 1: Abstract the Provider Interface (Short Term)
- [ ] Formalize `InferenceProvider` interface from existing `GenerationProvider` pattern
- [ ] Make backend selection configurable (env var / project config)
- [ ] Ensure ComfyUI backend works through the new interface (no regression)
- [ ] Document the interface for community contributors

### Phase 2: Raw Python Backend — No ComfyUI (Medium Term)
- [ ] Write a Python subprocess backend calling LTX diffusers pipeline directly
- [ ] Skip ComfyUI workflow overhead — direct model loading and inference
- [ ] Expected ~30-50% speedup over ComfyUI with minimal effort
- [ ] Communicate via stdin/stdout JSON protocol or Unix socket

### Phase 3: Native/Rust Backend (Long Term)
- [ ] When the open-source Rust LTX engine is available, wrap it as a backend
- [ ] Alternatively, explore ONNX Runtime or TensorRT for production optimization
- [ ] FFI via Neon/napi-rs for tight Node.js integration, or subprocess for isolation

## Reference: Rust Engine Specs (Community)
- Model: LTX-2.3 (22B dev checkpoint + distilled LoRA)
- Text encoder: Gemma-3-12B-IT (QAT Q4 unquantized)
- Sampler: 15 steps stage 1 + 3 refinement steps stage 2
- Output: 1920x1088 @ 24fps
- Generation time: ~40 seconds for 10s video

## Key Files
- `src/services/comfyui/ComfyUIProvider.ts` — current provider (refactor target)
- `src/services/comfyui/ComfyUIClient.ts` — HTTP client (stays for ComfyUI backend)
- `src/services/comfyui/WorkflowLoader.ts` — workflow parameterization
- `src/services/comfyui/WorkflowRegistry.ts` — workflow metadata
- `src/tasks/video/tools.ts` — tool handlers (should be backend-agnostic)

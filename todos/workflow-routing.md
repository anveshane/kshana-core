# Capability-Based Workflow Routing

## Done
- [x] WorkflowManifest type (unified schema for all pipeline types)
- [x] WorkflowModeRegistry singleton (scans *.manifest.json, filters by pipeline/provider)
- [x] Built-in manifests for i2v/t2v/i2v_late_entry, zimage, qwen_edit
- [x] Dynamic prompt injection ({{AVAILABLE_VIDEO_MODES}}, {{AVAILABLE_PROCESSING_MODES}}, {{FRAME_GENERATION_GUIDE}})
- [x] Multi-frame image generation (outputPaths on ExecutionNode)
- [x] Generic parameterizer (parameterizeGeneric reads *.manifest.json)
- [x] "Anything Everywhere" node resolution for user workflows
- [x] All 4 pipelines replaceable (image_gen, image_edit, image_processing, video_gen)
- [x] Built-in workflows immutable, user workflows can override
- [x] WorkflowParser (detect input nodes, LoRA nodes, auto-detect pipeline type)
- [x] LLM-assisted workflow analysis on upload
- [x] Workflow upload wizard (5 steps with AI pre-fill)
- [x] Workflow test panel (run with custom inputs, progress, result preview)
- [x] LoRA trigger keyword injection (prepend/append/negative)
- [x] API modes filtered from Workflow Management (ComfyUI-only)
- [x] Override persistence (writes isOverride to manifest file)
- [x] Manifest validation on load
- [x] Reserved ID protection (can't shadow built-in IDs)

## Pending (Phase 5 from plan)
- [ ] Image processing pipeline stage (new artifact type between shot_image and shot_video)
- [ ] executeImageProcessing() handler in ExecutorAgent
- [ ] Shot image → SAM/depth/ControlNet → processed image → video flow

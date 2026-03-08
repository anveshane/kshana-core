# Future Features

## 1. AI Voice & Audio Pipeline

The biggest gap right now. Videos are completely silent. The `MultiShotMotionPrompt` schema already has `dialogue` fields, but there's no audio pipeline to use them.

### What this includes:
- **AI narration** — generate voiceover from scene narration text (ElevenLabs, Google TTS, OpenAI TTS)
- **Character dialogue** — distinct voices per character, synced to shot timelines
- **Background music scoring** — AI-generated or licensed ambient tracks that match mood/tempo
- **Sound effects** — environmental audio (wind, footsteps, rain) from SFX libraries

### Architecture:
Follows the same provider pattern as image/video generation — an `AudioProvider` interface with `generateNarration()`, `generateMusic()`, `generateSFX()`. The `StitchVideoTool` already uses Remotion, which handles audio compositing natively.

### Why it matters:
A video without audio feels like a prototype. With audio, it feels like a finished product.

---

## 2. Visual Timeline Editor (NLE-lite in the browser)

Right now users interact through chat only — they can't see how their video is coming together. There's no way to:
- Preview the assembled video before final export
- Reorder, trim, or swap shots visually
- See the pacing/rhythm of the full piece
- Adjust transitions between scenes

### What this includes:
A lightweight browser-based timeline (simplified CapCut in the web UI) showing:
- Thumbnail strips for each shot on a horizontal track
- Drag-to-reorder, click-to-preview
- Duration handles for trim
- Audio waveform track (once the audio pipeline exists)
- One-click "reassemble" that calls `stitch_videos` with the new order

### Architecture:
The data model already supports this — `project.scenes` has ordered scene/shot refs, and `assets/manifest.json` tracks all generated artifacts. The timeline would be a visual representation of what's already there.

### Why it matters:
Chat-driven workflows are powerful for creation, but humans need visual control for editing and refinement.

---

## 3. Autonomous "Just Make It" Mode

Currently the workflow requires constant user approval — every phase, every image, every video needs confirmation. For a 2-minute video with 12 scenes and 3 shots each, that's 50+ approval gates.

### What this includes:
- Take a story/idea + style + duration as input
- Run the entire pipeline end-to-end with zero user interaction
- Use quality self-evaluation (have the LLM score its own outputs and regenerate if below threshold)
- Produce a complete video with all scenes, then present the result for review
- Let users cherry-pick what to regenerate rather than approving each step

### Architecture:
A `runAutonomous(projectId)` mode that skips the `ask_user` confirmation gates, auto-approves complex tool calls, and uses a quality-check loop (generate -> evaluate -> regenerate if needed -> move on).

### Why it matters:
The current workflow is great for control but terrible for the "I just want to see what it makes" use case. Most users will try autonomous first, then switch to guided mode for refinement.

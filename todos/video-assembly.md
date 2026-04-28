# Video Assembly & Transitions

## Done
- [x] FFmpeg xfade transitions between clips (dip_to_black, flash_to_white, crossfade, wipes, etc.)
- [x] Accumulated duration offset calculation for xfade chain
- [x] Transition data read from scene_video_prompt JSON
- [x] Transition field added to scene_video_prompt guide
- [x] Final video emits tool_result for UI display
- [x] toolCallId flows through full WebSocket chain
- [x] Concurrent executor lock (in-memory + file-based with stale detection)

## Known Issues
- [ ] Transition durations eat into clip duration (by design, but may want compensation)
- [ ] Audio crossfade could be smoother (currently uses triangle fade)

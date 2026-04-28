# Fix Timeline Reset & Load

## Priority: HIGH

## Issues

1. **Timeline not reset on project reset** — `scripts/reset-project.ts` doesn't clear timeline segments for reset stages. After resetting to `shot_image_prompt`, timeline.json still has stale segment data pointing to deleted files.

2. **Timeline not sent to UI on project load** — Timeline data is only pushed via WS when shots complete. If you load a project that already has timeline data, the Timeline tab shows nothing until new shots generate.

## Fix

1. Reset script: when resetting any stage that includes `shot_video` or `shot_image`, clear the corresponding timeline segments (set their `filled` status back to empty, remove file paths).

2. `handleSelectProject` in WebSocketHandler.ts: read `timeline.json` and send it to the frontend on project select, same as todos are sent.

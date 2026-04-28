# Remote Filesystem Consistency

## Problem

The executor, reset script, and other server-side operations directly read/write project files via `readFileSync`/`writeFileSync`. This works in local mode (server and project files on the same machine) but breaks in remote mode where the project files live on the user's machine and the server runs elsewhere.

## What Assumes Local File Access

- `ExecutorAgent.persistState()` — writes project.json directly
- `ExecutorAgent` content resolver — reads/writes output files, prompts, JSON artifacts
- `/reset` command — runs reset-project.ts which manipulates project.json and deletes output files
- `loadTimeline()` / `saveTimeline()` — reads/writes timeline.json
- `FFmpegAssembler` — reads video files, writes final assembly
- `AssetScanner` — reads asset manifest, scans directories
- ComfyUI output download — saves files to project assets dir

## What Already Exists for Remote

- `RemoteClientFileSystem` — proxies file operations to the client over WebSocket
- `IFileSystem` interface — abstraction for local vs remote file access
- `SessionContext` with `runInSession()` — wraps execution in the correct filesystem context
- `ProjectStateCache` / `project_state_sync` — client sends full project snapshot on connect

## What Needs to Happen

All file operations in the executor and its dependencies need to go through `IFileSystem` instead of direct `fs` calls. This is a large refactor touching every file read/write in the executor pipeline.

## Key Files

- `src/core/planner/ExecutorAgent.ts` — dozens of `readFileSync`/`writeFileSync` calls
- `src/core/planner/contentResolver.ts` — output file writing
- `src/core/timeline/TimelineManager.ts` — timeline.json I/O
- `src/core/timeline/FFmpegAssembler.ts` — video file access
- `scripts/reset-project.ts` — project.json manipulation + file deletion
- `src/core/fs/` — existing filesystem abstraction layer

## Priority

Low — remote mode is not the primary use case yet. All current users run locally.

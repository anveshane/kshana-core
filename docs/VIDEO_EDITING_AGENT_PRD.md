# Video Editing Agent PRD

## Executive Summary

Transform the existing kshana-ink "Cinematic Video Creation" agent into a "Video Editing Assistant" agent. The new system helps video editors enhance their existing videos with AI-generated content (images, video clips, motion graphics, audio) based on user-provided scripts.

**Key Decision**: This is a **complete replacement** of the existing workflow, not a parallel mode.

---

## Requirements Summary

| Aspect | Decision |
|--------|----------|
| **Video Input** | Local files, URLs, cloud storage (Google Drive, Dropbox, S3) |
| **Script Format** | Auto-detect (timestamped text, screenplay, SRT/VTT, plain text) |
| **Analysis** | Script-based only (no automatic video analysis) |
| **Enhancement Types** | Images, video clips, motion graphics, audio (music + SFX) |
| **Audio Sources** | AI generation + stock libraries + user uploads |
| **Composition Modes** | PIP overlays, B-roll cuts, split-screen (agent chooses) |
| **Strategy** | Hybrid (AI suggests + user hints, then approve/modify) |
| **Approval** | Full per-enhancement approval workflow |
| **Preview** | CLI-based interactive timeline (React Ink) |
| **Output** | Edited video + NLE project files (DaVinci, Premiere, FCP) |
| **Video Length** | Medium-form (5-30 min) |
| **Video Engine** | FFmpeg-based (direct integration) |
| **Target Users** | All content creators |

---

## New 8-Phase Workflow

Replaces the existing PLOT → STORY → CHARACTERS_SETTINGS → SCENES → etc. workflow:

```
INGEST → SCRIPT_PARSE → ANALYSIS → ENHANCEMENT_PLAN → ASSET_GENERATION → COMPOSITION → PREVIEW → EXPORT
```

| Phase | Description | Per-Item Approval |
|-------|-------------|-------------------|
| **INGEST** | Import video from local/URL/cloud, extract metadata, generate thumbnails | No |
| **SCRIPT_PARSE** | Auto-detect format, parse script, align segments with video | No |
| **ANALYSIS** | Identify enhancement opportunities from script keywords/structure | No |
| **ENHANCEMENT_PLAN** | AI suggests placements + user hints, create enhancement timeline | Yes |
| **ASSET_GENERATION** | Generate AI images, video clips, motion graphics, audio | Yes |
| **COMPOSITION** | Compose timeline with PIP/B-roll/split-screen compositions | Yes |
| **PREVIEW** | Interactive CLI timeline preview, per-segment approval | Yes |
| **EXPORT** | Render final video + export NLE project files | No |

---

## New Project Directory Structure

Replace `.kshana/` with `.kshana-edit/`:

```
.kshana-edit/
  project.json                # Main project file (VideoEditProjectFile)

  source/
    original/                 # Original source video
      video.[ext]
      metadata.json
    thumbnails/               # Video thumbnails for timeline
      thumb_*.jpg

  script/
    original.[ext]            # Original script (if uploaded)
    parsed.json               # Parsed script segments

  enhancements/
    suggestions.json          # AI suggestions + user hints

  assets/
    manifest.json             # Asset registry
    images/                   # AI-generated images
    video_clips/              # AI-generated video clips
    motion_graphics/          # Lower thirds, text animations
    audio/
      music/                  # AI/stock music
      sfx/                    # Sound effects
      user/                   # User uploads

  timeline/
    composition.json          # Full timeline data
    previews/                 # Rendered preview segments
      segment_*.mp4

  export/
    final_video.[ext]         # Final rendered video
    nle/
      project.xml             # DaVinci/Premiere (FCP7 XML)
      project.fcpxml          # Final Cut Pro X
```

---

## Core Data Types

### New File: `src/tasks/video-edit/workflow/types.ts`

```typescript
export const PROJECT_VERSION = '3.0';

// Input types
export type InputSourceType = 'local_file' | 'url' | 'cloud_storage';
export type CloudProvider = 'google_drive' | 'dropbox' | 's3';
export type ScriptFormat = 'srt' | 'vtt' | 'screenplay' | 'timestamped_text' | 'plain_text' | 'auto_detect';

// Enhancement types
export type EnhancementType = 'ai_image' | 'ai_video_clip' | 'motion_graphic' | 'audio_music' | 'audio_sfx';
export type CompositionMode = 'pip_overlay' | 'broll_cut' | 'split_screen' | 'lower_third' | 'full_overlay';
export type SuggestionSource = 'ai_suggested' | 'user_hint';

// Workflow phases
export enum EditWorkflowPhase {
  INGEST = 'ingest',
  SCRIPT_PARSE = 'script_parse',
  ANALYSIS = 'analysis',
  ENHANCEMENT_PLAN = 'enhancement_plan',
  ASSET_GENERATION = 'asset_generation',
  COMPOSITION = 'composition',
  PREVIEW = 'preview',
  EXPORT = 'export',
  COMPLETED = 'completed',
}

// Core interfaces
export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface ScriptSegment {
  id: string;
  index: number;
  timeRange?: TimeRange;
  text: string;
  speaker?: string;
  type: 'dialogue' | 'narration' | 'action' | 'scene_heading' | 'unknown';
}

export interface EnhancementSuggestion {
  id: string;
  type: EnhancementType;
  compositionMode: CompositionMode;
  timeRange: TimeRange;
  source: SuggestionSource;
  confidence: number;           // 0-1 for AI suggestions
  description: string;
  prompt?: string;
  scriptSegmentId?: string;
  approvalStatus: ItemApprovalStatus;
  feedback?: string;
}

export interface TimelineTrack {
  id: string;
  type: 'primary' | 'broll' | 'pip' | 'audio' | 'motion_graphics';
  label: string;
  clips: TimelineClip[];
}

export interface TimelineClip {
  id: string;
  trackId: string;
  assetId?: string;
  isSourceVideo: boolean;
  timeRange: TimeRange;
  compositionMode: CompositionMode;
  position?: { x: number; y: number };
  scale?: number;
  opacity: number;
}

export interface VideoEditProjectFile {
  version: '3.0';
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;

  source: {
    type: InputSourceType;
    path: string;
    cloudProvider?: CloudProvider;
    metadata?: VideoMetadata;
  };

  script: {
    format: ScriptFormat;
    segments: ScriptSegment[];
  };

  currentPhase: EditWorkflowPhase;
  phases: Record<EditWorkflowPhase, PhaseInfo>;

  enhancements: EnhancementSuggestion[];
  assets: AssetInfo[];

  timeline: {
    durationMs: number;
    frameRate: number;
    resolution: { width: number; height: number };
    tracks: TimelineTrack[];
  };

  exportConfig?: ExportConfig;
}
```

---

## Tools to Implement

### Ingest Tools (`src/tasks/video-edit/tools/ingestTools.ts`)
- `import_video` - Import from local file, URL, or cloud storage
- `extract_metadata` - Extract video metadata (FFmpeg)
- `generate_thumbnails` - Generate thumbnail strip for timeline

### Script Tools (`src/tasks/video-edit/tools/scriptTools.ts`)
- `parse_script` - Parse script in various formats (auto-detect)
- `align_script_to_video` - Align script segments to video timecodes
- `add_user_hint` - Add user enhancement hint at specific timecode

### Analysis Tools (`src/tasks/video-edit/tools/analysisTools.ts`)
- `identify_enhancement_opportunities` - AI identifies where enhancements would help
- `extract_frame` - Extract frame at specific timecode

### Enhancement Tools (`src/tasks/video-edit/tools/enhancementTools.ts`)
- `suggest_enhancement` - AI suggests an enhancement
- `approve_enhancement` - Mark enhancement as approved
- `reject_enhancement` - Mark enhancement as rejected with feedback
- `generate_motion_graphic` - Generate lower third, text animation (ComfyUI)
- `generate_ai_video_clip` - Generate short AI video clip (ComfyUI)
- `generate_ai_audio` - Generate AI music or sound effect
- `import_stock_asset` - Import from stock library or user uploads

### Timeline Tools (`src/tasks/video-edit/tools/timelineTools.ts`)
- `create_track` - Create timeline track
- `add_clip` - Add clip to timeline
- `set_clip_properties` - Set position, scale, opacity
- `get_timeline_state` - Get current timeline state

### Composition Tools (`src/tasks/video-edit/tools/compositionTools.ts`)
- `compose_pip` - Compose picture-in-picture overlay (FFmpeg)
- `compose_broll_cut` - Compose B-roll replacement cut (FFmpeg)
- `compose_split_screen` - Compose split-screen layout (FFmpeg)
- `render_preview_segment` - Render preview for a timeline segment

### Export Tools (`src/tasks/video-edit/tools/exportTools.ts`)
- `render_final_video` - Render final edited video (FFmpeg)
- `export_davinci_project` - Export DaVinci Resolve project (FCP7 XML)
- `export_premiere_project` - Export Premiere Pro project (FCP7 XML)
- `export_fcpxml` - Export Final Cut Pro X project (.fcpxml)

### Keep from Existing
- `think`, `ask_user`, `TodoWrite`, `read_file`, `write_file`
- `generate_image` (modify for new use cases)
- `wait_for_job`

### Remove
- `stitch_videos`, `generate_video_from_image`, `generate_video_from_frames`
- All story/character/setting tools

---

## New Services

### FFmpeg Service (`src/services/ffmpeg/FFmpegService.ts`)
Primary video processing engine:
- `extractMetadata(videoPath)` - Extract video metadata
- `generateThumbnails(videoPath, interval)` - Generate thumbnail strip
- `extractFrame(videoPath, timestampMs)` - Extract single frame
- `composePIP(base, overlay, config)` - Picture-in-picture composition
- `composeBRoll(base, broll, timeRange)` - B-roll cut
- `composeSplitScreen(video1, video2, config)` - Split-screen
- `renderTimeline(timeline, outputPath)` - Full timeline render

### Script Parser (`src/services/script-parser/ScriptParser.ts`)
- `detectFormat(content)` - Auto-detect script format
- `parseSRT(content)` - Parse SRT subtitles
- `parseVTT(content)` - Parse VTT subtitles
- `parseScreenplay(content)` - Parse screenplay format
- `parseTimestampedText(content)` - Parse timestamped text

### NLE Exporter (`src/services/nle-export/NLEExporter.ts`)
- `exportFCP7XML(project)` - Export FCP7 XML (DaVinci/Premiere compatible)
- `exportFCPXML(project)` - Export Final Cut Pro X format

### Timeline Manager (`src/services/timeline/TimelineManager.ts`)
- `loadTimeline()` / `saveTimeline()` - Persistence
- `addEnhancement()` / `updateEnhancement()` / `removeEnhancement()`
- `addTrack()` / `addClip()`
- `validateTimeline()` - Check for conflicts

---

## CLI Timeline Component

### New File: `src/components/timeline/TimelineView.tsx`

React Ink component for interactive timeline:

```
Timeline: 00:05:23 / 00:12:45                    [||] Pause  [<][>] Seek
============================================================================
Primary:  |====Scene 1====|===Scene 2===|=====Scene 3=====|===Scene 4====|
B-Roll:         |--[P]--|        |--[A]--|                    |--[R]--|
PIP:                          |---[A]---|
Audio:    |~~~background music~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~|

Legend: [A]=Approved [P]=Pending [R]=Rejected

Current: B-Roll @ 00:01:30 - "Office establishing shot"
Status: Pending                              [a]pprove [r]eject [p]review
```

Keyboard shortcuts:
- `Space` - Play/pause preview
- `Left/Right` - Seek 5 seconds
- `Shift+Left/Right` - Jump to previous/next enhancement
- `a` - Approve current enhancement
- `r` - Reject with feedback
- `p` - Preview current section
- `Tab` - Cycle through tracks
- `Enter` - Select enhancement at cursor

---

## Prompt Files

### New Directory: `prompts/video-edit/`

```
prompts/video-edit/
  main.md                    # Video editing orchestrator prompt
  workflow.md                # Workflow description
  phases/
    ingest.md
    script-parse.md
    analysis.md
    enhancement-plan.md
    asset-generation.md
    composition.md
    preview.md
    export.md
```

---

## Entry Point Changes

### `src/index.tsx`
- Remove `--type video` flag (old creation mode)
- Default to video editing workflow
- Or rename to `--type video-edit` initially during development

### `src/App.tsx`
- Update startup workflow for video editing mode
- New states: `select_input_source → load_script → ready`
- Route to video-edit tool registry

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/index.tsx` | New task type, remove old video mode |
| `src/App.tsx` | New startup workflow states |
| `src/tasks/video/` | **Remove entirely** (replaced by video-edit) |
| `src/services/comfyui/WorkflowRegistry.ts` | Add motion graphics workflows |

## Files to Create

| File | Purpose |
|------|---------|
| `src/tasks/video-edit/index.ts` | Main entry point |
| `src/tasks/video-edit/workflow/types.ts` | New type definitions |
| `src/tasks/video-edit/workflow/ProjectManager.ts` | Project state management |
| `src/tasks/video-edit/tools/*.ts` | All new tools (6 files) |
| `src/services/ffmpeg/FFmpegService.ts` | FFmpeg integration |
| `src/services/script-parser/ScriptParser.ts` | Script parsing |
| `src/services/nle-export/NLEExporter.ts` | NLE project export |
| `src/services/timeline/TimelineManager.ts` | Timeline state management |
| `src/components/timeline/*.tsx` | Timeline UI components |
| `prompts/video-edit/*.md` | All prompts (9 files) |

---

## Implementation Phases

### Phase 1: Foundation
1. Create new types in `src/tasks/video-edit/workflow/types.ts`
2. Create `FFmpegService` with metadata extraction and thumbnails
3. Create `ScriptParser` with auto-detection
4. Implement `ingestTools` and `scriptTools`
5. Create new `ProjectManager` for video-edit workflow

### Phase 2: Analysis & Enhancement Planning
1. Implement `analysisTools` (enhancement opportunity detection)
2. Implement `enhancementTools` (suggestions, approval workflow)
3. Create enhancement plan prompts
4. Build basic CLI enhancement review UI

### Phase 3: Asset Generation
1. Add motion graphics workflows to ComfyUI registry
2. Implement `generate_motion_graphic`, `generate_ai_video_clip`
3. Implement audio generation/import tools
4. Build asset approval workflow

### Phase 4: Timeline & Composition
1. Create `TimelineManager` service
2. Implement `timelineTools` and `compositionTools`
3. Build `TimelineView` React Ink component
4. Implement FFmpeg composition functions (PIP, B-roll, split-screen)

### Phase 5: Preview & Export
1. Implement preview generation (FFmpeg)
2. Create `NLEExporter` (FCP7 XML, FCPXML)
3. Implement `exportTools`
4. Full timeline preview with segment approval

### Phase 6: Polish & Cleanup
1. Remove old video creation code (`src/tasks/video/`)
2. Update prompts for all phases
3. Integration testing
4. Documentation updates

---

## Success Criteria

1. User can import a video from local file, URL, or cloud storage
2. User can provide a script in any common format (SRT, VTT, timestamped text, plain)
3. Agent identifies enhancement opportunities and suggests placements
4. User can approve/reject each enhancement with feedback
5. Agent generates AI images, video clips, motion graphics, audio
6. User can preview enhanced sections in CLI timeline
7. Final video exports with all approved enhancements
8. NLE project files export successfully to DaVinci, Premiere, FCP

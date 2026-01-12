# Video Editing Workflow

## Phase Overview

The video editing workflow consists of 8 phases, each with specific objectives and tools.

## Phase 1: INGEST

**Objective:** Import the source video and extract metadata.

**Steps:**
1. Import video using `import_video` (local file, URL, or cloud storage)
2. Extract metadata using `extract_metadata` (duration, resolution, fps, codec)
3. Generate thumbnails using `generate_thumbnails` for timeline preview
4. Complete with `complete_ingest`

**Success Criteria:**
- Video file is copied to project directory
- Metadata is extracted and saved
- Thumbnails are generated for timeline visualization

---

## Phase 2: SCRIPT_PARSE

**Objective:** Parse the user's script and align it with the video.

**Steps:**
1. Detect script format using `detect_script_format`
2. Parse script using `parse_script`
3. Align segments to video timecodes using `align_script_to_video`
4. Optionally add user hints using `add_user_hint`
5. Complete with `complete_script_parse`

**Supported Formats:**
- SRT subtitles
- VTT subtitles
- Screenplay format
- Timestamped text
- Plain text

**Success Criteria:**
- Script is parsed into segments
- Segments have timing information
- Keywords are extracted for analysis

---

## Phase 3: ANALYSIS

**Objective:** Identify opportunities for visual and audio enhancements.

**Steps:**
1. Analyze script using `identify_enhancement_opportunities`
2. Extract frames at key moments using `extract_frame`
3. Review and refine opportunities
4. Complete with `complete_analysis`

**What to Look For:**
- Descriptive passages that could benefit from visuals
- Data/statistics that could be visualized
- Emotional moments that could use music
- Action sequences that could use sound effects
- Speaker introductions that need lower thirds

**Success Criteria:**
- Enhancement opportunities are identified
- Opportunities are ranked by confidence
- Analysis document is generated

---

## Phase 4: ENHANCEMENT_PLAN

**Objective:** Create and approve the enhancement plan.

**Steps:**
1. Suggest enhancements using `suggest_enhancement`
2. Present each enhancement to user for approval
3. Handle approvals with `approve_enhancement`
4. Handle rejections with `reject_enhancement`
5. Allow modifications with `regenerate_enhancement`
6. Track progress with `list_enhancements` and `get_next_pending_enhancement`
7. Complete with `complete_enhancement_plan`

**Per-Item Approval:**
Each enhancement must be individually approved:
- Present the enhancement details
- Explain why it was suggested
- Show the time range and composition mode
- Wait for user decision

**Success Criteria:**
- All enhancements are reviewed
- Approved enhancements are ready for generation
- Enhancement plan document is created

---

## Phase 5: ASSET_GENERATION

**Objective:** Generate AI assets for approved enhancements.

**Steps:**
1. Generate images using `generate_image`
2. Generate video clips using `generate_ai_video_clip`
3. Generate motion graphics using `generate_motion_graphic`
4. Generate audio using `generate_ai_audio`
5. Import stock assets using `import_stock_asset`
6. Wait for generation jobs using `wait_for_job`
7. Get user approval for each generated asset
8. Complete phase when all assets are ready

**Per-Item Approval:**
Each generated asset must be approved:
- Show the generated asset
- Explain how it will be used
- Allow regeneration if not satisfactory

**Success Criteria:**
- All approved enhancements have generated assets
- Assets are registered in manifest
- Assets are approved by user

---

## Phase 6: COMPOSITION

**Objective:** Compose the timeline with enhancements.

**Steps:**
1. Create tracks using `create_track`
2. Add clips using `add_clip`
3. Set clip properties using `set_clip_properties`
4. Add transitions using `add_transition`
5. Compose PIP overlays using `compose_pip`
6. Compose B-roll cuts using `compose_broll_cut`
7. Compose split screens using `compose_split_screen`
8. Get timeline state using `get_timeline_state`
9. Complete phase when timeline is ready

**Track Types:**
- `primary` - Main video track
- `broll` - B-roll replacement track
- `pip` - Picture-in-picture overlay track
- `overlay` - Full screen overlay track
- `audio` - Audio track
- `motion_graphics` - Motion graphics track

**Success Criteria:**
- Timeline is composed with all approved assets
- Compositions are rendered correctly
- Timeline structure is valid

---

## Phase 7: PREVIEW

**Objective:** Interactive preview with per-segment approval.

**Steps:**
1. Render preview segments using `render_preview_segment`
2. Generate timeline preview using `generate_timeline_preview`
3. Present each segment for approval
4. Handle approvals with `approve_segment`
5. Handle rejections with `reject_segment`
6. Allow segment modifications
7. Complete when all segments are approved

**Per-Segment Approval:**
Each composed segment must be approved:
- Play/show the segment preview
- Highlight the enhancements in that segment
- Allow revision if needed

**Success Criteria:**
- All segments are previewed
- All segments are approved
- Preview files are generated

---

## Phase 8: EXPORT

**Objective:** Render final video and export NLE projects.

**Steps:**
1. Configure export settings
2. Render final video using `render_final_video`
3. Export to DaVinci using `export_davinci_project`
4. Export to Premiere using `export_premiere_project`
5. Export to FCP using `export_fcpxml`
6. Wait for export jobs using `wait_for_job`
7. Present final outputs to user

**Export Formats:**
- Final video (MP4, MOV, WebM)
- DaVinci Resolve (FCP7 XML)
- Adobe Premiere (FCP7 XML)
- Final Cut Pro X (FCPXML)

**Success Criteria:**
- Final video is rendered
- NLE project files are exported
- User has access to all outputs

---

## Phase Transitions

Use `transition_phase` to move between phases. The system will:
1. Validate current phase is complete
2. Update project state
3. Initialize next phase

Transitions are automatic when completion criteria are met.

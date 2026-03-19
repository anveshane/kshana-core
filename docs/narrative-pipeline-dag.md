# Narrative Video Pipeline DAG

## Execution Flow

```
USER INPUT (story idea)
       ↓
  set_goal() → scan_assets() → create_backward_plan()
       ↓
┌─── NARRATIVE FOUNDATION ──────────────────────────────┐
│  generate_content("plot") → generate_content("story") │
└──────────────────┬────────────────────────────────────┘
                   ↓
    ┌──────────────┼──────────────┐      ← PARALLEL
    ↓              ↓              ↓
 CHARACTER*     SETTING*       SCENE*
 (profiles)    (profiles)    (breakdowns)
    ↓              ↓              |
    ↓              ↓              |
 CHAR_IMAGE*   SETTING_IMAGE*    |       ← PARALLEL (generate_image, type=character_ref/setting_ref)
    └──────┬───────┘              |
           ↓                      |
    ESTABLISHING_IMAGE*  ←────────┘      ← PARALLEL per scene (generate_image, type=establishing, refs=char+setting)
           ↓
    SCENE_VIDEO_PROMPT*                  ← PARALLEL per scene (generate_content, breaks scene → 1-3 shots)
           ↓
    ┌── TIMELINE SKELETON ──┐
    │ create_skeleton        │
    │ split_segment (shots)  │
    └──────────┬─────────────┘
               ↓
    SHOT_IMAGE_PROMPT*                   ← per shot (generate_content)
               ↓
    SCENE_IMAGE*                         ← PARALLEL per shot (generate_image, type=scene, refs=establishing+char+setting)
               ↓                           [SKIPPED if sceneMode=="continuous"]
    SCENE_VIDEO*                         ← per shot (generate_video_from_image, auto-updates timeline)
               ↓
    manage_timeline(validate)
               ↓
    assemble_from_timeline()             ← FFmpeg concat → FINAL_VIDEO ✓
```

## Key Rules

- **Duration budget** constrains scene/shot counts (injected into generate_content)
- **Min shot duration**: 4 seconds (LTX-2.3 minimum)
- **Establishing images MANDATORY** before per-shot images (spatial anchor)
- **Reference images** flow downward: char_ref + setting_ref → establishing → scene images
- **Continuous mode**: If scene uses single long shot, skip per-shot images, use establishing directly
- **Video gen is serialized** (ComfyUI resource constraint) even though shots are logically parallel

## Artifact Dependency Graph

```
plot → story → {character, setting, scene}
character → character_image ─┐
setting → setting_image ─────┤
scene ───────────────────────┤
                             ↓
                    establishing_image
                             ↓
                    scene_video_prompt → shot_image_prompt → scene_image → scene_video
                                                                              ↓
                                                                     timeline → final_video
```

# Shot Breakdown Phase (Graphic Novel)

This phase breaks each scene into 2-4 shots optimized for static panel composition, not video animation.

## Phase Goal

Decompose each scene into individual shots with panel framing, composition direction, and subtitle text — producing the shot breakdown (scene_video_prompt) and per-shot image prompts (shot_image_prompt).

## Current State

{{PHASE_STATE}}

## Input Context

Use `list_project_files` to see available content, then `read_file` to access what you need.

Scene files are in `scenes/scene_[N].md`. Character and setting reference images are tracked in `project.json`.

## Artifacts in This Phase

- **Scene Video Prompt** (repurposed as shot breakdown): Multi-shot breakdown with panel framing and subtitle metadata
- **Shot Image Prompt**: Per-shot image generation prompts with reference image integration

## Key Difference from Narrative

- Focus on **panel framing** (close-up, wide, medium, over-the-shoulder) rather than camera motion or animation
- No motion prompts needed — skip any motion/animation direction
- Include **subtitle text** for each shot: the dialogue or narration that will be overlaid
- Include **panel duration** suggestion (5-8 seconds based on text length)

## Shot Breakdown Structure

For each scene, create a shot breakdown JSON with this structure:

```json
{
  "sceneNumber": 1,
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "wide",
      "description": "Establishing shot of the village at dawn",
      "characters": ["character_name"],
      "setting": "setting_name",
      "subtitleText": "The sun hadn't yet cleared the eastern hills...",
      "panelDuration": 6,
      "referenceImages": {
        "characters": ["assets/images/characters/name.png"],
        "settings": ["assets/images/settings/name.png"]
      }
    }
  ]
}
```

## Panel Framing Guidelines

### Shot Types for Panels
- **wide / establishing**: Full environment, sets the scene — good for opening panels
- **medium**: Character(s) from waist up, balanced with environment
- **close_up**: Character face/expression — emotional emphasis
- **extreme_close_up**: Single detail (eyes, hands, object) — dramatic punctuation
- **over_the_shoulder**: Two characters in conversation
- **two_shot**: Two characters framed together

### Composition Principles
- Vary shot types across a scene for visual rhythm
- Use wide shots to establish, close-ups for emotional beats
- Consider reading flow — panels should guide the eye naturally
- Leave space at the bottom of composition for subtitle text overlay

## Subtitle Text Guidelines

- Extract key dialogue and narration from the scene description
- Include all relevant dialogue for each shot — multiple character lines are fine
- The `compose_panel` tool handles word wrapping and layout for any amount of text
- Narration text should complement, not describe, what the image shows
- For dialogue-heavy shots, include the full exchange — don't truncate to fit

## Workflow

For each approved scene:
1. Read the scene description
2. Break into 2-4 shots with varied framing
3. Assign subtitle text to each shot
4. Set panel duration (5-8s based on text length: more text = longer duration)
5. Create the shot breakdown artifact (scene_video_prompt)
6. Present to user for approval
7. After approval, generate shot_image_prompt for each shot
8. Update timeline: `manage_timeline(action: "split_segment", segment_id: "segment_N", shots: [...])`

## Backward Dependency Check

Before generating any shot image prompt, verify:
1. **Character refs needed by this shot** — check referenceImages for character paths, verify files exist
2. **Setting refs needed by this shot** — check referenceImages for setting paths, verify files exist
3. **If any ref is missing** — generate it first
4. **All refs exist** — proceed with shot_image_prompt generation

## User Approval

Present the shot breakdown for each scene:
1. Show the proposed shots with their framing, subtitle text, and duration
2. Allow the user to adjust shot count, framing, or text
3. Confirm before proceeding to image prompt generation

## Quality Criteria

Before completing this phase:
- [ ] All scenes have approved shot breakdowns
- [ ] Each shot has clear framing direction
- [ ] Subtitle text is assigned and concise
- [ ] Panel durations are appropriate (5-8s each)
- [ ] Reference image dependencies are identified
- [ ] Timeline segments are split for shots

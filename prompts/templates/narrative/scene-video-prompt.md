# Scene Video Prompt Template (LTX-2 Multi-Shot)

Break this scene into 1-3 cinematic shots based on narrative complexity, each optimized for the LTX-2 video generation model which transforms a scene image into a short video clip.

## Scene Information

{{SCENE_CONTENT}}

## Establishing Image

An establishing image has been generated for this scene — a wide shot showing the full physical space with all characters positioned. All shots in this scene share this spatial anchor. Every per-shot image will be derived from the establishing image using it as image1 in Qwen Edit.

The establishing image path is available from the project state. Include it in the output JSON as `establishingImagePath`.

## Scene Mode Decision

Choose one of two modes for this scene:

- **single_shot** (use for simple scenes): One shot of 4-10s. For scenes with a single beat, a brief moment, or a transition.
- **multi_shot** (use for complex scenes): 2-3 shots of 4-8s each. For scenes with dialogue exchanges, action beats, or significant visual variety.
- **continuous**: A single long shot of 8-10 seconds using the establishing image directly as the LTX-2 input frame (`useEstablishingAsFirstFrame: true`). Use when the establishing shot already captures the key moment and only subtle motion is needed.

Set `sceneMode` in the output JSON accordingly.

## Spatial Layout

Describe how characters and key elements are arranged in the establishing image. This helps the shot image generator know where to "zoom into" for each shot. Set `spatialLayout` in the output JSON.

Example: "Protagonist stands at left near the window, antagonist seated at center desk, bookshelf fills the right wall, warm candlelight from overhead chandelier"

## Character Count Guidance

Prefer 1-2 characters per scene where possible. Scenes with 3+ characters required multi-pass compositing for the establishing image (slower, potential quality loss). Only use 3+ character scenes when narratively essential (ensemble moments, confrontations). Consider splitting large ensemble scenes into sequential 2-character interactions.

## Multi-Shot Breakdown

Each scene should be broken into 1-3 shots of 4-8 seconds each based on narrative complexity. Simple moments need just 1 shot. Complex dialogue or action scenes need 2-3 shots. Each shot must serve a narrative purpose — don't add shots just to fill time. LTX-2 generates short clips effectively — a single prompt trying to describe too much action produces poor results.

**CRITICAL: Minimum shot duration is 4 seconds.** The LTX-2 model produces unreliable or empty output below 4s. Prefer 5-8 second shots for best quality. Never plan shots shorter than 4 seconds — if the math requires it, merge short shots together or redistribute duration.

The orchestrator will provide a total duration budget. Distribute scene durations based on narrative weight — action-heavy scenes get more time, transitions get less.

### Shot Type Vocabulary

**By distance:**
- **extreme_wide**: Vast environment, character tiny or absent, establishes scale
- **wide**: Full environment, character head-to-toe, establishes location
- **medium_wide**: Character from knees up, physical action with environment context
- **medium**: Waist-up of character(s), conversational, most common shot
- **medium_close_up**: Chest and head, intimate, captures expression and gesture
- **close_up**: Face fills frame, maximum emotional impact
- **extreme_close_up**: Single feature (eyes, hands, object), intense detail

**By angle:**
- **low_angle**: Camera looks up — subject appears powerful, dominant
- **high_angle**: Camera looks down — subject appears vulnerable, diminished
- **dutch_angle**: Tilted frame — unease, tension, psychological distress
- **birds_eye**: Directly above — abstract, pattern, god's view

**By purpose:**
- **establishing**: Sets context for the scene (usually wide)
- **reaction**: Character responding, focus on expression and body language
- **over_the_shoulder**: Behind one character looking at another
- **two_shot**: Two characters together, showing relationship
- **pov**: Point-of-view, what a character sees
- **insert**: Detail shot of object or action
- **cutaway**: Brief shot of related element outside main action
- **tracking**: Camera follows moving subject

### Shot Sequencing Principles
- Start with an establishing/wide shot to set the scene
- Move to medium shots for action and dialogue
- Use close-ups for emotional peaks
- Use reaction shots to show impact on characters
- End with a shot that transitions naturally to the next scene

## LTX-2 Prompt Engineering Rules

Each shot's prompt must follow these rules:

### Structure
- Write each shot prompt as a **single flowing paragraph**
- Use **present tense, descriptive language**: "a woman walks toward the door" not "a woman walking"
- Describe the shot **chronologically**: how it starts, what action unfolds, what the result is

### Core Elements per Shot

1. **Subject/Character**: Specifics on appearance, clothing, and posture relevant to the motion
2. **Action/Movement**: Clear, detailed descriptions of gestures and physical changes
3. **Environment**: Background details, lighting, colors, and textures — all in motion
4. **Camera Work**: Defined separately in the `cameraWork` field

### Techniques

- **Show, don't label emotions**: "tears stream down her face" not "she is sad"
- **Match detail to shot scale**: More facial detail for close-ups, environmental detail for wide shots
- **Avoid clutter**: No text, logos, or chaotic disorganized motion
- **Keep it achievable**: All described motion must fit naturally within 4-8 seconds
- **Environmental motion adds life**: Wind in hair, drifting smoke, flickering light, rippling water

### Dialogue
- If the scene description includes dialogue, distribute character lines across the appropriate shots
- Set `dialogue` to the spoken line for that shot — LTX-2 generates with audio
- Set `dialogue` to `null` for shots without spoken words

### Don'ts
- Don't describe drastic position changes — motion should be subtle per shot
- Don't add elements not visible in the source image
- Don't request impossible physics
- Don't use bullet points or section headers in the prompt text
- Don't label emotions — describe their physical expression

## Output Format

Output ONLY a JSON object (no markdown fences, no extra text):

```
{
  "sceneNumber": 1,
  "sceneTitle": "Scene Title Here",
  "sceneMode": "multi_shot",
  "spatialLayout": "Description of how characters and elements are arranged in the establishing shot",
  "establishingImagePath": "path/to/establishing/scene_1.png",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "establishing",
      "duration": 5,
      "prompt": "[single flowing paragraph for this shot]",
      "dialogue": null,
      "cameraWork": "slow push-in from wide",
      "referenceImages": ["path/to/relevant-ref.png"]
    },
    {
      "shotNumber": 2,
      "shotType": "close-up",
      "duration": 6,
      "prompt": "[single flowing paragraph for this shot]",
      "dialogue": "Character's spoken line here",
      "cameraWork": "static with subtle drift",
      "referenceImages": ["path/to/character-ref.png"]
    }
  ],
  "totalSceneDuration": 11,
  "referenceImages": ["path/to/all-refs.png"]
}
```

For **continuous mode**, use a single shot with `useEstablishingAsFirstFrame: true`:
```
{
  "sceneNumber": 3,
  "sceneTitle": "Simple Scene Title",
  "sceneMode": "continuous",
  "spatialLayout": "Character centered in frame, walking through doorway",
  "establishingImagePath": "path/to/establishing/scene_3.png",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "wide",
      "duration": 9,
      "prompt": "[single flowing paragraph for the continuous shot]",
      "dialogue": null,
      "cameraWork": "slow tracking shot",
      "referenceImages": ["path/to/establishing/scene_3.png"],
      "useEstablishingAsFirstFrame": true
    }
  ],
  "totalSceneDuration": 9,
  "referenceImages": ["path/to/all-refs.png"]
}
```

**referenceImages** (top-level): Include the `referenceImagePath` for every character and setting that appears in this scene. Get these paths from `read_project()`. If no reference images exist, use an empty array.

**Per-shot referenceImages**: Only include refs relevant to that specific shot.

## Example Output

{ "sceneNumber": 2, "sceneTitle": "The Candlelit Study", "shots": [{ "shotNumber": 1, "shotType": "establishing", "duration": 5, "prompt": "The camera reveals a warmly lit study where two figures stand in tense silence across a mahogany desk, candlelight from tall brass holders casts dancing shadows across leather-bound spines on floor-to-ceiling shelves, golden afternoon light streams through tall windows illuminating dust motes that drift lazily through the heavy air between them.", "dialogue": null, "cameraWork": "slow push-in from wide to medium", "referenceImages": ["assets/images/characters/sarah_chen.png", "assets/images/characters/marcus_webb.png", "assets/images/settings/candlelit_study.png"] }, { "shotNumber": 2, "shotType": "close-up", "duration": 6, "prompt": "Sarah's face fills the frame in warm candlelight, her chest rises with a controlled breath as her eyes narrow and her crossed arms tighten imperceptibly, a subtle tremor passes through her jaw as moisture catches at the corner of her eye, the flickering light plays across the determination hardening her features.", "dialogue": "You had no right to make that decision without me.", "cameraWork": "static close-up with subtle drift right", "referenceImages": ["assets/images/characters/sarah_chen.png"] }, { "shotNumber": 3, "shotType": "reaction", "duration": 5, "prompt": "Marcus shifts his weight from one foot to the other, his jaw set firm while a subtle twitch tugs at the corner of his mouth, his fingers curl and uncurl at his sides as he absorbs the weight of her words, behind him candle flames flicker gently casting soft dancing shadows across the mahogany shelves.", "dialogue": null, "cameraWork": "medium shot, slight pan left", "referenceImages": ["assets/images/characters/marcus_webb.png"] }], "totalSceneDuration": 16, "referenceImages": ["assets/images/characters/sarah_chen.png", "assets/images/characters/marcus_webb.png", "assets/images/settings/candlelit_study.png"] }

**PURPOSE**: Break a scene into 2-4 cinematic shots, each optimized for video generation. Video models generate 4-8 second clips effectively, so each shot must describe focused motion for a single clip. Real video production uses multiple shots per scene — establishing, close-up, medium, reaction, etc.

**Multi-Shot Breakdown Rules:**

1. **2-4 shots per scene**: Break the scene action into distinct cinematic shots. Each shot must map to a **specific narrative moment** from the scene description — not generic framing
2. **4-8 seconds each**: Each shot's motion must be achievable in this window
3. **Shot type vocabulary**:
   - **By distance**: extreme_wide, wide, medium_wide, medium, medium_close_up, close_up, extreme_close_up
   - **By angle**: eye_level, low_angle, high_angle, dutch_angle, birds_eye, worms_eye
   - **By purpose**: establishing, reaction, over_the_shoulder, two_shot, pov, insert, cutaway, tracking
4. **Shot sequencing**: Start with establishing/wide shots, move to medium/close-ups for key moments, use reaction shots for emotional beats
5. **Per-shot referenceImages**: Only include references relevant to that specific shot (e.g., close-up of Alice → only Alice's reference)

**Default Prompt Rules (apply to each shot unless model-specific rules override):**

1. **Single flowing paragraph**: Each shot prompt is ONE continuous paragraph
2. **Present tense, descriptive language**: "a woman walks" not "a woman walking"
3. **Show, don't label emotions**: "tears stream down her face" not "she is sad"
4. **Explicit camera work in cameraWork field**: Define the camera motion separately

**Dialogue Support:**
- If the scene description includes character dialogue, distribute the lines across the appropriate shots
- Set the `dialogue` field to the character's spoken line for that shot
- Set `dialogue` to `null` if the shot has no spoken dialogue

**Output format:**

Output ONLY a JSON object (no markdown fences).

**NOTE:** The example below uses illustrative paths. You MUST replace them with actual verified paths from `read_project()` (where `referenceImageStatus` is `"exists"`) or `list_project_files()`. If no reference images exist, use empty arrays `[]`.

```
{
  "sceneNumber": 3,
  "sceneTitle": "The Confrontation",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "establishing",
      "duration": 5,
      "prompt": "A wide view of the dimly lit study as two figures stand facing each other across a mahogany desk, candlelight flickering across leather-bound books on tall shelves, dust motes drifting through a shaft of golden afternoon light from the tall window.",
      "dialogue": null,
      "cameraWork": "slow push-in from wide to medium",
      "referenceImages": ["<verified path from read_project>", "<verified path from read_project>"]
    },
    {
      "shotNumber": 2,
      "shotType": "close-up",
      "duration": 6,
      "prompt": "Sarah's face fills the frame, her jaw tightens and her eyes narrow with controlled fury, a subtle tremor passes through her crossed arms, the warm candlelight catches a glint of moisture at the corner of her eye as she draws a slow breath.",
      "dialogue": "You had no right to make that decision alone.",
      "cameraWork": "static close-up with subtle drift right",
      "referenceImages": ["<verified path for sarah>"]
    },
    {
      "shotNumber": 3,
      "shotType": "reaction",
      "duration": 5,
      "prompt": "Marcus shifts his weight from one foot to the other, his jaw set firm while his fingers curl and uncurl at his sides, a faint twitch tugs at the corner of his mouth as he absorbs her words, the shadows from the flickering candles play across his tense expression.",
      "dialogue": null,
      "cameraWork": "medium shot, slight pan left",
      "referenceImages": ["<verified path for marcus>"]
    }
  ],
  "totalSceneDuration": 16,
  "referenceImages": ["<all verified paths used across shots>"]
}
```

**CRITICAL — Reference Image Path Rules:**
- **ONLY** use paths that `read_project()` returns with `referenceImageStatus: "exists"`, or that appear in `list_project_files()` output
- **NEVER** fabricate, guess, or invent image paths like `assets/images/characters/name.png` — these will be stripped by the validator
- If `referenceImagePath` is `null` or `referenceImageStatus` is `"missing"` for a character/setting, do NOT include any path for it
- If NO valid reference images exist, set `referenceImages` to an empty array `[]`
- When in doubt, call `list_project_files()` to see what files actually exist on disk

**referenceImages** (top-level): List ALL verified `referenceImagePath` values from `read_project()` for every character and setting in the scene (only those with `referenceImageStatus: "exists"`). Per-shot `referenceImages` should only include refs relevant to that specific shot.

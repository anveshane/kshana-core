**PURPOSE**: Write a condensed screenplay-format story optimized for AI video generation. The output must be producible within the target duration — every character needs an image generated, every setting needs a reference, every scene needs shots. Fewer elements = higher quality per element.

---

## Duration-Based Constraints

These are HARD LIMITS. Exceeding them wastes generation time and budget.

| Duration | Characters | Settings | Scenes | Word Limit |
|----------|-----------|----------|--------|------------|
| 15-30s   | 1-2       | 1        | 1-2    | 300        |
| 31-60s   | 2-3       | 1-2      | 2-4    | 600        |
| 61-120s  | 3-5       | 2-3      | 4-6    | 1200       |
| 121-180s | 4-6       | 3-4      | 5-8    | 1800       |
| 181-300s | 5-8       | 4-5      | 7-10   | 2500       |
| 300s+    | 6-10      | 5-7      | 8-12   | 3500       |

**Use the target duration provided in the project constraints to determine your limits.**

## Why These Limits Matter

Every character you name will need:
- A written profile (~30s LLM time)
- A reference image generated (~15s ComfyUI time)
- Appearance in shot images (more characters = more complex prompts = worse results)

Every setting you name will need:
- A written profile (~30s LLM time)
- A reference image generated (~15s ComfyUI time)

Every scene will need:
- A detailed scene description (~45s LLM time)
- Shot breakdown into 3-5 individual shots
- Each shot needs: image prompt, reference image, motion directive, video generation

**A 1-minute video with 11 characters and 13 settings = 149 generation steps = 2+ hours of compute. The same story with 3 characters and 2 settings = ~40 steps = 30 minutes.**

## Screenplay Format

Write in condensed screenplay format:

```
## [SCENE TITLE]

**[INT/EXT. LOCATION - TIME]**

[Action description. Keep it visual — what the camera sees, not internal thoughts.]

**CHARACTER:** "Dialogue line." *(delivery note)*

[More action. Describe physical movements, lighting changes, key visual moments.]
```

## Rules

1. **Name only characters the camera SEES** — if someone is mentioned but never on screen, don't name them
2. **Consolidate locations** — "the bar" and "outside the bar" can be one setting
3. **Every scene must advance the story** — no establishing-only scenes unless the video is 2+ minutes
4. **Dialogue is optional** — visual storytelling is more powerful for short videos
5. **End with a clear visual punctuation** — a final image, a fade to black moment, a reveal
6. **Include a CAST LIST at the end** — list only the characters that appear on screen with a one-line visual description
7. **Include a LOCATIONS LIST at the end** — list only distinct locations with a one-line visual description

## Cast & Locations Lists

These lists at the end of the story are what the system uses to create character/setting profiles and reference images. Be precise:

```
---
## CAST
- **Detective Chen**: Late 40s, Chinese-American, weathered face, grey trench coat, always has a cigarette
- **Luna**: Early 20s, platinum blonde pixie cut, neon-green jacket, cybernetic left eye

## LOCATIONS
- **The Noodle Bar**: Cramped Chinatown joint, steam from kitchen, red paper lanterns, rain-streaked window
- **The Alley**: Narrow, wet cobblestones, fire escape ladders, single flickering neon sign
```

## What NOT to Do

- Don't write a novel — this is a screenplay, not a book
- Don't name characters who appear for one line of background dialogue
- Don't create separate locations for "hallway" and "room" in the same building — it's one setting
- Don't write internal monologue — the camera can't see thoughts
- Don't exceed the word limit for your duration tier

Output ONLY the screenplay content with cast and locations lists.

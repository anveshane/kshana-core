**PURPOSE**: Compose characters and settings into a single scene image. Reference images provide visual consistency — the prompt controls composition, framing, and lighting.

## When Reference Images EXIST

Use `read_project()` to find each character's `referenceImagePath` and each setting's `referenceImagePath`. Only use paths where the status is `"exists"`.

**Reference image ordering rule:** List characters first, then settings, in the **Reference Images** section. The first listed = `image 1`, second = `image 2`, etc. The prompt MUST explicitly reference every image using `image N` (with a space before the number).

**What the prompt controls vs. what references provide:**
- **References provide**: character appearance, setting architecture/textures — do NOT re-describe these
- **Prompt controls**: composition, action, spatial arrangement, lighting, mood, framing

### Prompt Construction (30-80 words, flowing prose)

Write in this priority order — front-loaded elements get more model attention:

1. **Shot type + subject action** — lead with framing and what the character is doing
2. **Setting placement** — where in the environment, spatial relationships
3. **Lighting** — source, direction, quality, temperature (highest visual impact)
4. **Mood/style annotation** — one sentence max

### Rules

- **30-80 words of prose** — every sentence adds visual information, no filler
- **One frozen instant** — no motion verbs ("walks toward", "turns around"), no temporal language ("slowly", "begins to"). Describe the pose/position captured in this frame
- **No narrative commentary** — "emphasizing her loneliness" is not visible. Describe what the camera sees, not what it means
- **No re-describing references** — don't repeat character appearance details that the reference image already provides. Say "the woman from image 1" not "the woman with sharp angular features and dark eyes from image 1"
- **Reference every image** — unreferenced images are ignored by the model
- **Lighting is mandatory** — always specify source, direction, and quality

### Example (good)

```
A medium shot of the woman from image 1 seated at a desk in the office from image 2, leaning forward with her chin resting on clasped hands. Papers spread before her, coffee cup at the desk edge. Warm overhead lamp creates a pool of light on the desk, her face half-lit from above, deep shadows below the brow. Cool blue ambient light from the window behind. Cinematic, shallow depth of field.
```

### Example (bad — too long, narrative contamination)

```
❌ A sweeping wide shot captures the weary detective from image 1 as she slowly makes her way across the dimly lit office from image 2, her exhaustion evident in every step, the weight of the unsolved case bearing down on her shoulders like a physical burden. The room seems to echo with the ghosts of past investigations, filing cabinets standing like silent sentinels...
```

**Output format:**
```
**Image Prompt:**
[30-80 words of flowing prose — subject action, setting, spatial arrangement, lighting, mood]

**Reference Images:**
- Character: [name]
- Setting: [name]

**Negative Prompt:**
[Brief, style-appropriate — 10-15 words max]

**Aspect Ratio:**
16:9

**Generation Mode:**
image_text_to_image
```

## When NO Reference Images Exist

Use `text_to_image` mode with a fully self-contained description. Since no reference provides appearance, include character physical details and setting description directly in the prompt (80-120 words).

**Output format:**
```
**Image Prompt:**
[80-120 words — full character description, setting, composition, lighting]

**Negative Prompt:**
[Brief, style-appropriate]

**Aspect Ratio:**
16:9

**Generation Mode:**
text_to_image
```

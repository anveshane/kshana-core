# Example Prompts for Manual Testing

These are the exact system + user prompts the executor sends to the LLM for each media type.
Copy-paste these into your LLM interface to test behavior.

---

## 1. Character Image Prompt Generation

### System Prompt

```
You are an expert image prompt engineer. Do NOT think or reason — respond directly with the prompt.
Create a detailed image generation prompt for the described subject.
Include: subject description, composition, lighting, style, and camera angle.
Format your output EXACTLY as:
**Image Prompt:** [detailed prompt]
**Negative Prompt:** [things to avoid]
**Aspect Ratio:** [ratio like 16:9, 1:1, etc.]
Output ONLY these three sections. No thinking, no explanations, no preamble.

<model_skills>
**PURPOSE**: Write an image generation prompt that establishes the visual IDENTITY of a single character. This image will be used as a reference when compositing scenes.

**READ the character profile provided in the user message, then EXTRACT and include ALL of the following:**

1. **AGE** — State the character's age or age range explicitly (e.g., "12-year-old", "adult in her 20s", "elderly man in his 70s", "ancient being of indeterminate age"). If the profile does not state age, write "adult".

2. **ETHNICITY / SPECIES** — For humans: state ethnicity or ethnic appearance explicitly for generation consistency (e.g., "South Asian woman", "Black man", "East Asian teenager", "Middle Eastern elderly man", "mixed-race woman of Black and Japanese heritage"). If the profile implies ethnicity through names, cultural context, or physical descriptions, infer and state it. If truly unspecified, write "ethnicity unspecified". For non-humans: state species or creature type (e.g., "alien humanoid", "crystalline being").

3. **SKIN / SURFACE** — For humans: skin tone and complexion (e.g., "warm medium-brown skin with golden undertones", "light olive skin, freckled"). For non-humans: surface texture and color.

4. **BUILD** — Height, body type, and proportions (e.g., "lean and athletic, 5'5"", "wiry slender frame, 4'8" tall").

5. **HAIR OR HEAD** — If the character HAS hair: describe color, length, and style. If the character has NO hair: write "no hair" and describe what covers the head instead.

6. **FACE** — Describe eyes (color, shape), nose, mouth, jawline, and any distinguishing marks.

7. **CLOTHING OR BARE SKIN** — If the character wears clothing: name specific garments with colors and materials. If the character wears no clothing: write "no clothing" and describe the exposed surface.

8. **POSE** — Give one specific static pose that keeps all features visible (e.g., "standing upright facing forward, arms relaxed at sides").

9. **UNIQUE FEATURES** — Scars, markings, missing limbs, glowing elements, accessories, tattoos, non-human anatomy.

**REQUIRED ELEMENTS — include these in every prompt regardless of character type:**
- Shot type: "full-body portrait" unless the profile specifies otherwise
- Background: plain neutral studio background — never a location, room, landscape, or environment from the story
- Lighting: soft, even, front-facing studio lighting — never dramatic, cinematic, moody, or directional
- Subject count: one subject only — no other people, animals, or scene elements
- Anatomy: "correct anatomy, no extra limbs, no text, no watermarks"

**OUTPUT FORMAT:**
**Image Prompt:**
[One paragraph, 80–250 words, flowing prose. All 9 fields above embedded naturally in sentences. Must include shot type, plain neutral studio background, soft even studio lighting, one subject only.]

**Negative Prompt:**
background scene, environment, landscape, buildings, furniture, multiple people, busy background, motion blur, cropped face, text, watermarks

**Aspect Ratio:**
1:1
</model_skills>
```

### User Prompt

```
Create Character Reference Images for "elara_vance"

<project_constraints>
**Visual style:** cinematic_realism
**Target video duration:** 180 seconds (3m 0s)
</project_constraints>

<context>
### Task
**Creating:** Character Reference Images: Elara Vance
**Type:** character_image
**Item:** elara_vance

### Characters: Elara Vance
**File:** characters/elara_vance.md

# Elara Vance

**Role:** Protagonist — Memory Archivist

**Age:** Early 30s

**Physical Description:**
- Tall and lean, with a slightly hunched posture from years of working in cramped extraction booths
- Weathered skin with dark undertones from the acidic rain of the Dregs
- Dark hair, shoulder-length, usually tied back loosely with stray strands framing her face
- Intense, focused eyes that carry a permanent look of exhaustion and steely pragmatism
- Wears practical, weathered clothing — utility jacket, dark technical shirt, cargo pants

**Personality:** Methodical, morally conflicted, driven by guilt over her daughter's disappearance. She is a pragmatist who has learned to suppress emotion to survive, but the discovery of the blue light reignites her buried hope.

**Key Features:**
- Neural implant (cold stone) embedded in her chest — now dormant
- Carries an encrypted memory drive hidden on her person at all times
- Hands that are steady during work but tremble slightly when she's emotionally overwhelmed
</context>
```

---

## 2. Scene Image Prompt Generation (with reference images)

### System Prompt

Same as above but with scene_image_guide and flux2_klein_edit skill instead.

### User Prompt

```
Create Scene Images for "scene_1"

<project_constraints>
**Visual style:** cinematic_realism
**Target video duration:** 180 seconds (3m 0s)
**Scene:** scene_1 (~45s total)
**Shots in this scene:** 3
**This shot's duration:** ~15 seconds
**Shot number:** 1
</project_constraints>

<context>
### Task
**Creating:** Scene Images: scene_1
**Type:** scene_image
**Item:** scene_1

### Scenes: Memory Extraction
**File:** chapters/chapter_1/scenes/scene_1.md

[scene description content here]

### Character Reference Images: Elara Vance
**File:** prompts/images/characters/elara_vance.prompt.md

[character image prompt content here — used as reference context]
</context>
```

---

## 3. Video Motion Prompt Generation

### System Prompt

```
You are a video direction expert. Do NOT think or reason — respond directly with the prompt.
Generate a detailed motion/animation prompt describing camera movement, character actions, and timing.
Output ONLY the motion prompt. No thinking, no explanations, no preamble.

<model_skills>
[scene_video_guide.md content would go here]
[scene_video_prompt.comfyui.ltx23.md content would go here]
</model_skills>
```

### User Prompt

```
Create Multi-Shot Motion Prompts for "scene_1"

<project_constraints>
**Visual style:** cinematic_realism
**Target video duration:** 180 seconds (3m 0s)
**This scene's duration:** ~45 seconds
**Shot planning:** Break this scene into shots that total ~45s. Each shot should be 3-10 seconds.
**Scene 1 of 4**
</project_constraints>

<context>
### Task
**Creating:** Multi-Shot Motion Prompts: Memory Extraction
**Type:** scene_video_prompt
**Item:** scene_1

### Scenes: Memory Extraction
**File:** chapters/chapter_1/scenes/scene_1.md

[full scene description with action, dialogue, visual details]
</context>
```

---

## Note on System Prompt Size

The current system prompt for character image generation is **~10,167 chars**:
- Category prompt: ~300 chars
- Default guide (character_image_guide.md): ~4,151 chars
- Model skill (character_image_prompt.comfyui.zimage.md): ~5,624 chars

The model skill file contains detailed instructions for the ZImage model (shot types, age handling, lighting, style specs, safety constraints). This is the primary reason for the large system prompt.

Options to reduce:
1. **Trim the skill file** — remove verbose explanations, keep only the rules
2. **Skip the model skill for prompt generation** — only inject the default guide (saves ~5.6K chars)
3. **Merge guide + skill into one concise file** — eliminate duplication between the two

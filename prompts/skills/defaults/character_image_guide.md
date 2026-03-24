**PURPOSE**: Write an image generation prompt that establishes the visual IDENTITY of a single character. This image will be used as a reference when compositing scenes.

**READ the character profile provided in the user message, then EXTRACT and include ALL of the following:**

1. **AGE** — State the character's age or age range explicitly (e.g., "12-year-old", "adult in her 20s", "elderly man in his 70s", "ancient being of indeterminate age"). If the profile does not state age, write "adult".

2. **ETHNICITY / SPECIES** — For humans: state ethnicity or ethnic appearance explicitly for generation consistency (e.g., "South Asian woman", "Black man", "East Asian teenager", "Middle Eastern elderly man", "mixed-race woman of Black and Japanese heritage"). If the profile implies ethnicity through names, cultural context, or physical descriptions, infer and state it. If truly unspecified, write "ethnicity unspecified". For non-humans: state species or creature type (e.g., "alien humanoid", "crystalline being").

3. **SKIN / SURFACE** — For humans: skin tone and complexion (e.g., "warm medium-brown skin with golden undertones", "light olive skin, freckled"). For non-humans: surface texture and color (e.g., "pale translucent grayish-white chitinous skin with metallic sheen and faint geometric subsurface patterns").

4. **BUILD** — Height, body type, and proportions (e.g., "lean and athletic, 5'5"", "wiry slender frame, 4'8" tall", "nine feet tall with extremely slender elongated limbs and a narrow skeletal torso").

5. **HAIR OR HEAD** — If the character HAS hair: describe color, length, and style (e.g., "jet-black hair past shoulders in soft waves", "short silver-streaked brown hair, neatly combed"). If the character has NO hair: write "no hair" and describe what covers the head instead (e.g., "no hair, smooth dome with delicate crystalline protrusions crowning the forehead").

6. **FACE** — Describe eyes (color, shape), nose, mouth, jawline, and any distinguishing marks. For non-human characters, describe alien equivalents in full (e.g., "two large void-black almond-shaped eyes that absorb light, no nose, no mouth, angular elongated face with deeply recessed cheekbones").

7. **CLOTHING OR BARE SKIN** — If the character wears clothing: name specific garments with colors and materials (e.g., "worn earth-toned cotton tunic with frayed hem, dark leggings, barefoot"). If the character wears no clothing: write "no clothing" and describe the exposed surface (e.g., "no clothing, bare chitinous exoskeleton with segmented geometric plates and faint bioluminescent glow along the torso seams").

8. **POSE** — Give one specific static pose that keeps all features visible (e.g., "standing upright facing forward, arms relaxed at sides", "three-quarter stance, one hand resting on a staff, face turned toward camera").

9. **UNIQUE FEATURES** — Scars, markings, missing limbs, glowing elements, accessories, tattoos, non-human anatomy (e.g., "small scar above left eyebrow, single chain necklace with locket", "missing left forearm sealed with hardened biological material, cracked torso skin emitting bioluminescent glow from within").

**REQUIRED ELEMENTS — include these in every prompt regardless of character type:**
- Shot type: "full-body portrait" unless the profile specifies otherwise
- Background: plain neutral studio background — never a location, room, landscape, or environment from the story
- Lighting: soft, even, front-facing studio lighting — never dramatic, cinematic, moody, or directional
- Subject count: one subject only — no other people, animals, or scene elements
- Anatomy: "correct anatomy, no extra limbs, no text, no watermarks"

**OUTPUT FORMAT:**
```
**Image Prompt:**
[One paragraph, 80–250 words, flowing prose. All 9 fields above embedded naturally in sentences. Must include shot type, plain neutral studio background, soft even studio lighting, one subject only.]

**Negative Prompt:**
background scene, environment, landscape, buildings, furniture, multiple people, busy background, motion blur, cropped face, text, watermarks

**Aspect Ratio:**
1:1
```
**PURPOSE**: Write an image generation prompt that establishes the visual IDENTITY of a single character. This image will be used as a reference when compositing scenes.

**READ the character profile AND the world style bible (if provided) before writing anything.** The world style bible defines the visual universe — its color palette, material palette, lighting mood, and aesthetic constraints MUST flow into every descriptive choice you make for the character. The image generator receives ONLY your prompt text; it has zero knowledge of the story, period, culture, or world.

**STEP 1 — ABSORB THE WORLD STYLE BIBLE (if provided)**

Before describing any character detail, extract and internalize these from the world style bible:

- **Color palette**: Which hues, tones, and saturations define this world? (e.g., "warm amber and charcoal tones", "desaturated earth tones with muted greens"). Every color you assign to skin, hair, clothing, and accessories must harmonize with this palette.
- **Material palette**: What textures and materials belong in this world? (e.g., "handspun cotton, hammered copper, raw clay", "chrome alloys, synthetic polymers, holographic film"). Use ONLY materials consistent with the world.
- **Aesthetic mood**: What is the overall visual feel? (e.g., "ancient and weathered", "gritty noir", "sterile and clinical"). Let this guide your adjective choices throughout.
- **"Avoid" list**: What does the world style explicitly forbid? (e.g., "bright saturated colors, modern neons, clean whites"). These go into the negative prompt AND must be actively avoided in the positive prompt — do not describe the character using anything on this list.

If no world style bible is provided, skip this step and use the character profile alone.

**STEP 2 — EXTRACT CHARACTER DETAILS**

Read the character profile, then include ALL of the following in the prompt:

1. **AGE** — State the character's age or age range explicitly (e.g., "12-year-old", "adult woman in her late 20s", "elderly man in his 70s"). If the profile does not state age, write "adult".

2. **ETHNICITY / SPECIES** — This is MANDATORY. Never omit, never write "unspecified" if any signal exists.
   - For humans: state ethnicity explicitly using clear, specific terms the image model can render (e.g., "South Asian woman", "Black man", "East Asian teenager", "Middle Eastern elderly man", "mixed-race woman of Black and Japanese heritage", "Indigenous Australian man", "pale-skinned Northern European woman").
   - **Inference rule**: If the profile does not state ethnicity outright but provides names, cultural context, geographic setting, or physical descriptions that imply it — you MUST infer and state the ethnicity. Examples: a character named "Arjun" in ancient Magadha → "South Asian man"; a character named "Keiko" in Edo-period Kyoto → "East Asian Japanese woman"; a character named "Kwame" in a West African kingdom → "West African man".
   - Only write "ethnicity unspecified" as an absolute last resort when the profile gives zero cultural, geographic, or naming signals AND no physical description that implies heritage.
   - For non-humans: state species or creature type (e.g., "alien humanoid", "crystalline being").

3. **SKIN / SURFACE** — For humans: skin tone and complexion using specific descriptors (e.g., "warm deep-brown skin with golden undertones", "light olive skin, freckled across the cheeks", "rich dark-brown complexion with cool undertones"). Skin tone must be consistent with the stated ethnicity. If the world style specifies a color palette, describe skin using tones that read naturally under that palette's lighting. For non-humans: surface texture and color (e.g., "pale translucent grayish-white chitinous skin with metallic sheen and faint geometric subsurface patterns").

4. **BUILD** — Height, body type, and proportions (e.g., "lean and athletic, 5'5"", "wiry slender frame, 4'8" tall", "nine feet tall with extremely slender elongated limbs and a narrow skeletal torso").

5. **HAIR OR HEAD** — If the character HAS hair: describe color, length, and style (e.g., "jet-black hair past shoulders in soft waves", "short silver-streaked brown hair, neatly combed"). Hair color should harmonize with the world style palette where applicable. If the character has NO hair: write "no hair" and describe what covers the head instead (e.g., "no hair, smooth dome with delicate crystalline protrusions crowning the forehead").

6. **FACE** — Describe eyes (color, shape), nose, mouth, jawline, and any distinguishing marks. Facial features should be consistent with stated ethnicity. For non-human characters, describe alien equivalents in full (e.g., "two large void-black almond-shaped eyes that absorb light, no nose, no mouth, angular elongated face with deeply recessed cheekbones").

7. **CLOTHING OR BARE SKIN** — If the character wears clothing: name specific garments with colors and materials drawn from the world style's material and color palettes. Clothing colors MUST fall within the world style's color palette — do not introduce hues the world style does not permit.

   **CRITICAL: Use period-specific and culture-specific garment terms, NOT modern equivalents.** The image model maps generic words to modern objects.
   - Footwear: "flat wooden paduka sandals" NOT "leather sandals" (produces modern chappals)
   - Upper garment: "draped uttariya cloth over one shoulder" NOT "shawl" (produces modern fabric)
   - Lower garment: "antariya dhoti wrapped and tucked at the waist" NOT "pants" or "trousers"
   - Weapons: "iron katar punch-dagger at belt" NOT "knife"
   - Jewelry: "hammered copper armband" NOT "bracelet"
   - Headwear: "linen nemyss headcloth" NOT "headscarf"
   - Outerwear: "felted wool lacerna cloak pinned at the shoulder" NOT "cape"

   Period-specific examples:
   - Ancient India (300 BC): "ancient Mauryan Empire era, draped unstitched cotton garments — uttariya cloth over one shoulder, antariya dhoti at the waist, flat wooden paduka sandals, no stitched clothing"
   - Medieval Europe (14th c.): "14th century Gothic period, undyed wool cotehardie with leather belt and brass buckle, linen braies beneath, pointed poulaine shoes"
   - Edo Japan: "Edo period Japan, indigo-dyed cotton kosode kimono with narrow obi sash, white tabi socks, wooden geta sandals"
   - Film Noir (1940s): "1940s American noir aesthetic, charcoal double-breasted wool suit with wide peaked lapels, silk necktie, leather oxford shoes, felt fedora"

   If the character wears no clothing: write "no clothing" and describe the exposed surface (e.g., "no clothing, bare chitinous exoskeleton with segmented geometric plates and faint bioluminescent glow along the torso seams").

8. **POSE** — Give one specific static pose that keeps all features visible (e.g., "standing upright facing forward, arms relaxed at sides", "three-quarter stance, one hand resting on a staff, face turned toward camera").

9. **UNIQUE FEATURES** — Scars, markings, missing limbs, glowing elements, accessories, tattoos, non-human anatomy (e.g., "small scar above left eyebrow, single tarnished copper chain with locket", "missing left forearm sealed with hardened biological material, cracked torso skin emitting bioluminescent glow from within"). Accessories and props must use materials from the world style palette.

10. **HISTORICAL / WORLD CONTEXT** — If the character profile or world style bible indicates a specific time period, culture, or setting era, embed a brief era tag near the start of the prompt so the image model establishes the correct visual baseline BEFORE interpreting any other terms (e.g., "ancient Mauryan Empire era, circa 300 BCE", "1940s American noir", "far-future post-human civilization"). If no specific period applies, omit this element.

**REQUIRED ELEMENTS — include these in every prompt regardless of character type:**
- Shot type: "full-body portrait" unless the profile specifies otherwise
- Background: plain neutral studio background — never a location, room, landscape, or environment from the story
- Lighting: soft, even, front-facing studio lighting — never dramatic, cinematic, moody, or directional
- Subject count: one subject only — no other people, animals, or scene elements
- Anatomy: "correct anatomy, no extra limbs, no text, no watermarks"

**SELF-CHECK BEFORE OUTPUT — Verify each of these. If any fails, revise the prompt before returning it:**
- [ ] Ethnicity or species is explicitly stated with a clear, specific term (not "unspecified" if any signal existed in the profile)
- [ ] Skin tone is described and consistent with the stated ethnicity
- [ ] Every color in the prompt (clothing, hair accessories, props) falls within the world style's color palette (if one was provided)
- [ ] Every material in the prompt (fabric, metal, leather type) belongs in the world style's material palette (if one was provided)
- [ ] Nothing in the prompt contradicts the world style's "Avoid" list
- [ ] Garment terms are period/culture-specific, not modern generic words
- [ ] The era tag is present if a historical or fantasy period was specified

**OUTPUT FORMAT:**
```
**Image Prompt:**
[One paragraph, 80–250 words, flowing prose. Begin with the era context (if any) and ethnicity, then weave all details naturally. Must include shot type, plain neutral studio background, soft even studio lighting, one subject only. All colors and materials must harmonize with the world style palette.]

**Negative Prompt:**
background scene, environment, landscape, buildings, furniture, multiple people, busy background, motion blur, cropped face, text, watermarks, [add ALL "Avoid" items from the world style bible here — e.g., modern clothing, bright saturated colors, contemporary accessories, neon lighting]

**Aspect Ratio:**
1:1
```
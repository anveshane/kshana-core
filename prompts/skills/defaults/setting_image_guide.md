**PURPOSE**: Establish the visual IDENTITY of the location ONLY. This image will be used as a reference when compositing scenes. It must contain ONLY the environment — no characters, people, or figures.

**Include these details** (infer from source material if not provided):

1. **Shot type & composition**: Camera angle and framing (e.g., "Wide establishing shot, low angle")
2. **Location description**: Specific place with architectural/environmental details
3. **Key visual elements**: 3-5 elements that define the space — textures, materials, objects
4. **Lighting & atmosphere**: Direction, quality, color temperature
5. **Time of day & weather**: Specific conditions
6. **Mood**: Specific emotional tone (not vague words like "moody")
7. **Style**: Medium and technical specs appropriate to the project style
8. **Constraints**: No people, no text/watermarks, clean composition

## What NOT to Include

Setting reference images establish ONLY the physical environment. Strip all non-visual content:

- **No narrative elements**: No ships arriving/departing, no events happening, no "aftermath of battle," no story action
- **No characters or figures**: No people, crowds, soldiers, aliens — even as background elements
- **No abstract concepts**: "screens displaying childhood memories" cannot be photographed — describe what screens physically look like instead (blank, showing static, displaying grid patterns)
- **No emotional narration**: "a sense of profound horror" wastes prompt tokens — describe the physical details that create that feeling
- **No temporal language**: "slowly retreating", "pulsing rhythmically" — a still image captures one instant

**Describe only what a camera physically captures in a single frame.**

## Photographic Anchoring (Critical for Sci-Fi / Fantasy)

For mundane settings (classroom, office, street), image models produce photorealistic output automatically. For fantastical settings, **anchor the description in real-world physical materials** so the model renders it as a photograph of a real place, not concept art.

**DO:** Describe sci-fi/fantasy settings as practical film sets built with real materials:
- "a corridor with walls made of welded steel plates and industrial piping, painted matte black, with blue LED strip lighting recessed into floor channels"
- "a command center built from military surplus equipment, concrete walls, banks of CRT monitors, overhead fluorescent tubes with one flickering"
- "a cave interior with walls coated in resin to create an organic texture, practical blue uplighting from floor-mounted LED panels"

**DON'T:** Use concept art / fantasy language that has no photographic equivalent:
- ~~"biomechanical chitinous walls with iridescent sheen and hexagonal patterns"~~ → "walls covered in molded fiberglass panels shaped like insect carapace, painted dark metallic gray with hints of green iridescence under the key light"
- ~~"energy conduits pulsing with inner light in rhythmic waves"~~ → "transparent acrylic tubes mounted along the walls, filled with blue-tinted liquid and backlit by steady LED strips"

**The rule:** If you can describe how a prop department would build it, the model can photograph it.

## Rules

- ONLY the environment — no people, characters, human figures, or silhouettes
- Focus on what makes this location visually UNIQUE and recognizable
- Name real-world materials: `poured concrete`, `brushed aluminum`, `aged oak planks`
- For urban scenes: name specific architectural styles (Brutalist, Art Deco, Soviet-era prefab)
- For sci-fi/fantasy: reference real-world analogues ("like an industrial submarine interior", "resembling a decommissioned nuclear facility")

## Quality Checklist

- [ ] **No narrative contamination** — no story events, no characters, no vehicles in motion, no action
- [ ] **No abstract concepts** — everything described is physically photographable
- [ ] **Sci-fi/fantasy is anchored** — described as practical sets with real materials, not concept art language
- [ ] Shot type and composition angle specified
- [ ] 3–5 key visual elements that define the space
- [ ] Lighting explicitly described with direction and quality
- [ ] 80–250 words, structured and precise

**Output format:**
```
**Image Prompt:**
[Paragraph covering all details above]

**Negative Prompt:**
people, person, human, character, figure, silhouette, crowd, text, watermarks

**Aspect Ratio:**
1:1
```

**PURPOSE**: Establish the visual IDENTITY of the location ONLY. This image will be used as a reference when compositing scenes. It must contain ONLY the environment — no characters, people, or figures of any kind.

## Step 1: Extract From the Setting Profile

Read the setting profile carefully and extract:
- What is the physical space? (room, exterior, landscape, vehicle interior)
- What materials, surfaces, and objects define it?
- What is the scale? (intimate, room-sized, vast, industrial)
- What is the lighting source and quality?
- What architectural or environmental style does it belong to?
- What atmospheric conditions exist? (haze, mist, dust, steam, condensation, dry still air, heat shimmer)

If details are not stated in the profile, **infer visually plausible specifics** — do not leave placeholders or write "details not specified."

## Step 2: Build the Prompt

Include ALL of the following in every prompt. Every section is required — do not skip any.

---

### 1. Shot Type & Composition
Specify camera angle and framing explicitly:
- `wide establishing shot, low angle`
- `medium-wide interior view, eye level`
- `panoramic overhead view`

---

### 2. Spatial Depth — THREE LAYERS REQUIRED
Every prompt must explicitly describe **three named spatial layers**. Label them:

**Foreground** — closest elements (floor texture, objects within reach)
**Midground** — the main space (furniture, structures, defining objects)
**Background** — far wall, horizon, receding depth (vanishing point, distant elements)

Write each layer as a sentence or clause. Do not merge them. Do not describe objects without assigning them to a layer.

Example: "In the foreground, cracked tile flooring with dust accumulated in the grout lines. In the midground, rows of rusted metal shelving hold ceramic containers and coiled wire. In the background, a collapsed concrete wall with broken industrial windows recedes into shadow."

---

### 3. Atmospheric Condition — REQUIRED IN EVERY PROMPT
Name a specific physical atmospheric condition present in the space. This is required — do not omit it.

Choose one or more that fits the setting:
- `dust motes suspended in the light beams`
- `thin haze from steam pipes near the ceiling`
- `condensation on cold metal surfaces`
- `heat shimmer rising from the hot floor`
- `morning mist hanging low over the ground`
- `dry still air, no visible particles`
- `smoke residue coating upper surfaces`
- `thin fog settling in the low areas`

If the setting is arid and dry, state that explicitly: "dry still air with no particulates, surfaces coated in fine dust."

---

### 4. Architectural or Environmental Style — REQUIRED, MUST BE NAMED
Identify a specific real-world architectural style or analogue. Never write "futuristic room," "alien environment," or "fantasy setting."

- Brutalist concrete, Art Deco plasterwork, Victorian cast iron, Soviet-era prefab, industrial brutalism, mid-century institutional
- For sci-fi/fantasy: "styled like a decommissioned Soviet submarine interior," "resembling a 1970s Cold War-era research bunker," "like an abandoned offshore oil platform interior"
- For natural environments: "alpine tundra," "high desert mesa with basalt formations," "decaying temperate forest floor"
- For fantastical spaces: describe them as **practical film sets built from real materials** (see Sci-Fi/Fantasy Anchoring section below)

---

### 5. Physical Materials — NAME SPECIFIC SURFACES
List real-world material names for every major surface. Minimum 3 materials.

- Floors: `poured concrete`, `worn oak planks`, `cracked ceramic tile`, `compacted dirt`, `polished basalt`
- Walls: `exposed brick`, `brushed aluminum panels`, `weathered plaster`, `raw stone`, `corrugated steel`
- Ceilings: `exposed steel joists`, `vaulted plasterwork`, `corrugated metal`, `carved rock`
- Objects: `tempered glass`, `cast iron`, `vulcanized rubber`, `aged leather`, `molded fiberglass`

---

### 6. Scale Indicators — REQUIRED
Convey spatial scale explicitly using at least one of:
- Ceiling height: `low ceiling, roughly 8 feet`, `vaulted ceiling 40 feet overhead`, `open sky above`
- Room footprint: `a narrow corridor barely wide enough for two people`, `a vast chamber the size of an aircraft hangar`
- Depth cues: `the far wall barely visible 100 feet away`, `the space closes to a dead end 15 feet ahead`

---

### 7. Key Objects — 3 to 5 Specific Items
Name distinct structural or environmental objects that define the space.

- Not: "some equipment" — instead: "a rusted cast-iron furnace, a metal cot frame bolted to the wall, ceramic utility shelving"
- Not: "debris" — instead: "shattered ceiling plaster, overturned wooden chairs, a cracked porcelain sink"

**Containers, pods, cells, tanks, or capsules:** Describe the container's exterior form and material only. They are empty. Never describe, imply, or reference any occupant, form, figure, or presence inside them. Write: "rows of smooth fiberglass pods, each sealed with a tinted acrylic panel, mounted to the curved wall" — not "pods containing suspended forms."

---

### 8. Lighting — Source, Direction, Quality, Color Temperature
All four components required:
- Source: `overhead fluorescent tubes`, `sunlight from east-facing windows`, `floor-mounted uplights`, `no visible source, ambient glow`
- Direction: `raking side light from the left`, `overhead flat light`, `backlit from behind`
- Quality: `hard shadows`, `soft diffused light`, `harsh direct beam`, `soft bounce fill`
- Color temperature: `warm amber (3000K)`, `cool daylight (5500K)`, `sickly green-tinted fluorescent`, `deep blue moonlight`

---

### 9. Color Palette — REQUIRED
Name 2–3 dominant colors. Do not describe color abstractly — be literal.

Examples: `deep charcoal and rust orange`, `pale gray and washed-out white`, `rich ochre and shadow brown`, `muted olive green and gunmetal gray`, `pale gold and cream white`

---

### 10. Mood — Physical Details Only
Do not write "a sense of dread" or "profound sadness." Describe only the physical details that create the mood.

- Instead of "eerie" → "uneven lighting leaves large sections in shadow, a single fluorescent tube flickers at irregular intervals"
- Instead of "warm and welcoming" → "golden light pools on the worn oak counter, steam rises from a copper kettle on the iron stove"
- Instead of "desolate" → "surfaces coated in undisturbed dust, fallen ceiling plaster in heaps on the floor, no sign of recent disturbance"

---

## What NOT to Include

### No People, Characters, or Character-Specific Props — Absolute Rule
No people, crowds, soldiers, aliens, silhouettes, or human/humanoid forms of any kind. This includes:
- "background figures" → forbidden
- "a lone figure in the distance" → forbidden
- "a suspended form" inside a pod → forbidden
- "a shape that might be human" → forbidden
- "evidence of struggle" implying a person → describe only the physical damage

**No character-specific props or personal belongings.** The setting image is a clean environment — no shoes, bags, clothing, food, personal items, or objects that belong to a specific character. These will be composited in later during shot generation.
- "a pair of chappals next to running shoes" → forbidden (character props)
- "a tiffin bag on the bench" → forbidden (character prop)
- "a diary on the table" → forbidden (character prop)
- Generic environment objects are fine: "a bench," "lockers," "starting blocks on the track"

If the setting canonically contains living beings, describe the **architecture and physical space as if unoccupied**. The space is empty. Describe only walls, floors, structures, and generic environmental objects.

### No Narrative Contamination
Describe only what a camera captures in a single still frame. Do not describe:
- Events, actions, or story moments (no ships arriving, no battles, no "aftermath of conflict")
- Moving elements ("slowly pulsing," "flickering rhythmically") — describe the static state of the object
- Emotional narration ("the room feels heavy with loss")
- Abstract concepts that cannot be photographed ("memory fragments displayed on screens" → describe what is physically visible: static, a grid pattern, blank glass)

---

## Sci-Fi and Fantasy Anchoring — Practical Set Rule

For fantastical settings, describe them as **practical film sets built from real materials**. The goal is a photograph, not concept art.

**DO** describe how a prop department would build it:
- "walls made of welded steel plates coated in matte black industrial paint, with blue LED strip lighting recessed into floor channels"
- "a cave interior with walls coated in resin to create an organic texture, floor-mounted practical LED uplights casting blue light upward"
- "corridors built from military surplus equipment and cast concrete, banks of CRT monitors on metal shelving, overhead fluorescent tubes"

**DON'T** use concept art language:
- "biomechanical chitinous walls with iridescent sheen" → "walls covered in molded fiberglass panels shaped like insect carapace, painted dark metallic gray with hints of green iridescence"
- "energy conduits pulsing with light" → "transparent acrylic tubes mounted on the walls, backlit by steady blue LED strips"
- "crystalline alien structures" → "formations of angular clear resin mounted to the rock face, backlit from within by cool white LED panels"

**The rule:** If you can describe how a prop department builds it on a film set, the image model can photograph it.

---

## Quality Checklist

Before finalizing, verify:
- [ ] Shot type and angle explicitly stated
- [ ] Three spatial layers explicitly described and labeled (foreground / midground / background)
- [ ] An atmospheric condition named (haze, dust, mist, condensation, dry still air, etc.)
- [ ] Architectural or environmental style **named** (not generic)
- [ ] At least 3 specific real-world materials named
- [ ] Scale explicitly conveyed (ceiling height, room footprint, or depth cue)
- [ ] 3–5 distinct structural objects named
- [ ] Lighting: source, direction, quality, and color temperature all present
- [ ] Dominant color palette named (2–3 specific colors)
- [ ] **Zero people, figures, or characters** — including in containers, backgrounds, or silhouettes
- [ ] No narrative events, no story action, no abstract concepts
- [ ] Sci-fi/fantasy described as practical sets with real materials

---

**Output format:**
```
**Image Prompt:**
[Paragraph covering all details above]

**Negative Prompt:**
people, person, human, character, figure, silhouette, crowd, text, watermarks

**Aspect Ratio:**
1:1
```
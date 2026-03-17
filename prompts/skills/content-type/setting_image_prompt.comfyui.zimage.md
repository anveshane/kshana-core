# Z-Image Turbo: Setting Image Prompting Skill

You craft detailed, production-ready prompts for Z-Image Turbo setting/environment image generation. Your output produces high-quality location and environment images with precise control over atmosphere, lighting, and composition.

## How Z-Image Turbo Works

Z-Image Turbo is a 6B single-stream diffusion transformer (S3-DiT) optimized for fast, instruction-following generation in 8–12 steps. It processes text and image tokens together in one sequence, which means:

- **No negative prompts.** The model ignores `negative_prompt` entirely. CFG is set to 0.
- **Positive-only control.** You control everything — style, safety, artifacts — via the positive prompt alone.
- **Instruction-following.** The model follows written instructions unusually well. Long, structured, camera-style prompts work best.

## Core Prompt Structure for Settings

Build setting image prompts using this scaffold, in order:

```
[Shot type & composition] + [Location description] + [Key environmental details] + [Lighting & atmosphere] + [Time of day / weather] + [Mood / tone] + [Style / medium] + [Technical specs] + [Cleanup constraints]
```

### Shot Type & Composition
- `wide establishing shot`, `medium-wide interior view`, `panoramic landscape`
- `low angle looking up at the building`, `bird's eye view of the street`
- `centered composition`, `rule of thirds framing`

### Location Description
- Be specific about the place: `a narrow cobblestone alley in an old European city`, not just `a street`
- Include architectural details: `arched stone doorways`, `wooden shuttered windows`, `crumbling brick walls`
- Specify scale cues: `towering skyscrapers in the distance`, `intimate small-room interior`

### Key Environmental Details
- 3–5 specific visual elements that define the space
- Textures and materials: `weathered stone`, `polished concrete`, `lush green foliage`
- Objects that ground the space: `scattered papers on the desk`, `steam rising from manhole covers`

### Lighting & Atmosphere
Z-Image responds very well to lighting keywords. For settings, these are critical for mood:
- `golden hour sunlight streaming through windows`
- `overcast diffused light, flat gray sky`
- `warm interior lighting from table lamps and candles`
- `harsh fluorescent office lighting`
- `moonlit scene with cool blue tones`
- `dramatic volumetric light rays through dust`

### Time of Day / Weather
- `early morning mist`, `high noon harsh shadows`, `late afternoon golden light`
- `overcast sky`, `light rain on the pavement`, `snow-covered`
- `clear starry night sky`

### Style / Medium
- `realistic photography, 24mm wide-angle lens, deep depth of field`
- Wide lenses for environments: `24mm`, `35mm`, `16mm ultra-wide`
- Depth of field: `deep focus throughout`, `foreground blur leading to sharp midground`

### Cleanup Constraints
Even without negative prompts, Z-Image learns "avoid X" semantics in the positive prompt:
- `no people, no figures, empty uninhabited scene`
- `no text, no watermark, no logos, no UI elements`
- `no lens distortion, correct perspective, straight vertical lines`
- `clean composition, no visual clutter outside the intended elements`

## Prompt Length

- **Sweet spot: 80–250 words** of clear, structured description
- Long and precise = good. Long and poetic/novel-like = worse.
- Native resolution: 1024×1024. Use 8–12 steps. CFG = 0.

## Quality Fix Patterns

| Issue | Fix phrase |
|-------|-----------|
| Unwanted people | `no people, no figures, empty uninhabited scene` |
| Cluttered composition | `clean composition, minimal visual elements, uncluttered` |
| Blur / noise | `sharp focus throughout, clean detailed image, no noise` |
| Logos / watermarks | `no text, no watermark, no branding, no signage` |
| Distortion | `no lens distortion, correct perspective, straight vertical lines` |
| Repetitive patterns | `varied architectural details, no repetitive tiling` |

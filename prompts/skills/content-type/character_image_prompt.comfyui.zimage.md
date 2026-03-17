# Z-Image Turbo: Character Image Prompting Skill

You craft detailed, production-ready prompts for Z-Image Turbo character image generation. Your output produces high-quality character portraits and full-body shots with precise control over appearance, clothing, and composition.

## How Z-Image Turbo Works

Z-Image Turbo is a 6B single-stream diffusion transformer (S3-DiT) optimized for fast, instruction-following generation in 8–12 steps. It processes text and image tokens together in one sequence, which means:

- **No negative prompts.** The model ignores `negative_prompt` entirely. CFG is set to 0.
- **Positive-only control.** You control everything — style, safety, artifacts — via the positive prompt alone.
- **Instruction-following.** The model follows written instructions unusually well. Long, structured, camera-style prompts work best.

Think of Z-Image Turbo as a very obedient camera crew + art director: if you don't say it, it's allowed. If you say it vaguely, it will improvise.

## Core Prompt Structure

Build character image prompts using this scaffold, in order:

```
[Shot type & subject] + [Age & appearance] + [Clothing & modesty] + [Background/environment] + [Lighting] + [Mood/expression] + [Style/medium] + [Technical specs] + [Safety/cleanup constraints]
```

### Shot & Subject
- Specify shot type explicitly: `close-up headshot`, `medium shot`, `full-body portrait`, `three-quarter view`
- Specify camera angle: `front view`, `45° angle`, `profile view`, `looking slightly up`
- Name the subject with role context: `an adult woman in her 30s`, `an elderly man`, `a young adult software developer`

### Age & Appearance
- Always include "adult" next to human subjects to reduce ambiguity
- Specify 2–4 traits: hair (color, length, style), build, skin tone, distinguishing features
- Override token baggage by being explicit about diverse traits rather than relying on role labels

### Clothing & Modesty
- Be explicit and specific: `wearing a dark business suit and shirt`, `casual jeans and a light jacket`
- Include coverage cues: `fully clothed`, `modest professional outfit`, `arms and legs covered`
- Specify color palette: `warm palette`, `cool tones`, `muted earth colors`

### Background / Environment
- Simple backgrounds work best: `plain studio background`, `soft blurred gray background`, `minimal interior`
- Constrain clutter: `simple, uncluttered background, nothing distracting behind the subject`

### Lighting
Z-Image responds very well to lighting keywords:
- `soft diffused daylight from the front`
- `cinematic warm key light`
- `studio portrait lighting`
- `rim lighting with soft fill`
- `soft box lighting from top left`

### Mood & Expression
- Be specific: `calm confident expression`, `friendly smile`, `focused and determined gaze`
- Avoid vague terms: say `natural relaxed posture` not `good vibes`

### Style / Medium
- `realistic photography, 85mm lens, shallow depth of field`
- `flat vector illustration, limited color palette, clean modern design`
- `watercolor painting, soft washes, delicate brushwork`

### Technical Specs
- Lens: `50mm`, `85mm`, `35mm`
- Depth of field: `shallow depth of field`, `sharp focus throughout`
- Quality: `4K quality`, `detailed but natural skin`, `extremely sharp details`

### Safety & Cleanup Constraints
Always end with constraint phrases. Even without negative prompts, the model learns "avoid X" semantics:
- `no text, no watermark, no logos`
- `correct human anatomy, natural hands and fingers, no extra limbs`
- `sharp focus, no motion blur, no grainy noise`
- `plain background, not busy or cluttered`

## Removing Token Baggage

Role labels like "CEO", "witch", "fashion model" carry unwanted defaults (gender, body type, makeup). Override them:

- **Swap loaded tokens for neutral ones:** `office worker` instead of `businessman`, `professional` instead of `executive`
- **Use role + 2–3 traits:** `a software developer, adult woman, short dark hair, glasses, wearing a hoodie and jeans, focused expression` — far more controllable than just `programmer`
- **Specify diversity explicitly:** `diverse ethnicities and genders`, `realistic body types, no exaggerated proportions`

## Prompt Length

- **Sweet spot: 80–250 words** of clear, structured description
- Long and precise = good. Long and poetic/novel-like = worse.
- The model supports up to 512 tokens by default (1024 extended). Structure beats verbosity.
- Native resolution: 1024×1024. Use 8–12 steps.

## Quality Fix Patterns

Embed these in the positive prompt instead of relying on negative prompts:

| Issue | Fix phrase |
|-------|-----------|
| Extra fingers/limbs | `correct human anatomy, natural hands and fingers, no extra limbs` |
| Blur / noise | `sharp focus on the subject, clean detailed image, no motion blur` |
| Background clutter | `simple, uncluttered background, nothing distracting` |
| Logos / watermarks | `no text, no UI elements, no watermark, no branding` |
| Weird eyes | `natural eye placement, symmetrical features` |

## Quality Checklist

Before finalizing a character image prompt, verify:
- [ ] Subject has explicit age context ("adult")
- [ ] 2–4 physical appearance traits specified
- [ ] Clothing described explicitly with coverage level
- [ ] Shot type and camera angle stated
- [ ] Lighting direction and quality specified
- [ ] Background kept simple and constrained
- [ ] Style/medium and technical specs included
- [ ] Safety/cleanup constraints at the end
- [ ] No reliance on negative prompts — all constraints are in the positive prompt
- [ ] 80–250 words, structured and precise

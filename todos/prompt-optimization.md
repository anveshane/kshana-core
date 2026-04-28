# Prompt Optimization (Autoresearch)

## Optimized
- [x] scene_guide.md — 94.4% (12 questions)
- [x] scene_video_prompt_guide.md — 97.6% (16 questions, includes dialogue + transitions)
- [x] motion_directive_guide.md — 94.0% (14 questions, cinematographer prose, character anchoring)
- [x] screenplay_guide.md — 97.6% (22 questions, varied durations 30s-180s)

## Not Yet Optimized
- [ ] plot_guide.md — new, untested
- [ ] character_image_guide.md — has period context added but not autoresearched
- [ ] setting_image_guide.md — not autoresearched
- [ ] shot_image_guide.md — not autoresearched
- [ ] world_style_guide.md — not autoresearched

## Rubrics Created
- scene-binary.json (13 questions)
- scene-video-prompt-binary.json (16 questions)
- motion-directive-binary.json (14 questions)
- screenplay-binary.json (22 questions)
- character-image-binary.json (14 questions, includes PERIOD_CONTEXT + WORLD_STYLE_CONSISTENCY)
- setting-image-binary.json (existing)
- shot-image-binary.json (existing)

## Key Changes
- Story → Screenplay format (duration-constrained, standard screenplay format)
- Duration-based entity limits in collection extractor
- Character/setting images now receive world_style as dependency (for period context)
- Serial mode: all LLM content before any media generation
- Todos ordered in serial execution order

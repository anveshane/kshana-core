### Infographics Placement Phase

**What this phase does**: Identify moments from the transcript that need infographics (charts, diagrams, statistics, data visualizations) and create detailed infographic placements with exact timestamps, type, and prompts. Align infographics **inside** image placements so they render as overlays on top of images.

**Prerequisites**:
- Content plan at `agent/plans/content-plan.md`
- Transcript at `agent/content/transcript.md`
- Image placements at `agent/content/image-placements.md` (to align overlay timing)
- `$transcript`, `$content_plan`, and `$image_placements` context variables

**Steps (execute in order)**:

1. **Verify prerequisites exist**:
   - Check `agent/plans/content-plan.md`, `agent/content/transcript.md`, and `agent/content/image-placements.md`
   - Verify `$transcript`, `$content_plan`, and `$image_placements` are available

2. **Call the infographics placer subagent**:
```
Task(
  subagent_type: 'infographics-placer',
  task: 'Analyze the transcript ($transcript) to identify key moments that need INFOGRAPHICS (charts, diagrams, statistics, lists, data viz). Use the content plan ($content_plan) for guidance. Use $image_placements to align infographic timings **inside** image placements (overlay mode). Create detailed infographic placement plan with exact timestamps, type (bar_chart, line_chart, diagram, statistic, list), and prompts. Output MUST start with INFOGRAPHIC_PLACER: and use format: - Placement N: start-end | type=... | prompt.',
  context_refs: ['$transcript', '$content_plan', '$image_placements']
)
```

3. **Extract and save the infographic placements**:
   - Task result: `{ status: 'completed', output: '<infographic placements text>', ... }`
   - Extract `result.output` and save to `agent/content/infographic-placements.md`:
```
write_file(
  file_path: 'agent/content/infographic-placements.md',
  content: '[result.output from Task - infographic placements]'
)
```
   Or use `write_infographic_placement_plan(content: result.output)`.

4. **Mark phase complete and transition**:
```
update_project(
  action: 'update_phase',
  data: { phase: 'infographics_placement', status: 'completed' }
)
update_project(
  action: 'transition_phase'
)
```

**IMPORTANT:**
- Create placements ONLY for infographics. No images, no video.
- Infographics should be **contained within** image placements so they render as overlays.
- Prompts should assume transparency: overlay cards, no full-bleed backgrounds, preserve margins.
- Output must start with `INFOGRAPHIC_PLACER:` and use `type=bar_chart|line_chart|diagram|statistic|list`.
- Save to `agent/content/infographic-placements.md` before transitioning.

**DO NOT:**
- Create image or video placements
- Place infographics outside image placements
- Skip saving or transitioning

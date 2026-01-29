### Infographics Generation Phase

Generate infographics for each placement in `agent/content/infographic-placements.md` via Remotion.

**SIMPLE WORKFLOW:**
1. Call the `generate_all_infographics` tool to process all infographic placements automatically.
2. The tool will:
   - Read and parse `agent/content/infographic-placements.md`
   - For each placement, render an infographic clip (chart, diagram, statistic, etc.) using Remotion
   - Save outputs to `agent/infographic-placements/` (or to `outputs/` when `output_dir: 'outputs'`) and register in the manifest
3. After the tool completes, mark phase complete and transition.

**STEP 1: Call generate_all_infographics**

```
generate_all_infographics(
  file_path: 'agent/content/infographic-placements.md'
)
```

To save infographic MP4s under the project's `outputs/` folder and register paths as `outputs/<file>.mp4`, pass `output_dir: 'outputs'`:

```
generate_all_infographics(
  file_path: 'agent/content/infographic-placements.md',
  output_dir: 'outputs'
)
```

Wait for the tool to complete. It processes all placements.

**STEP 2: Mark phase complete and transition**

```
update_project(
  action: 'update_phase',
  data: { phase: 'infographics_generation', status: 'completed' }
)
update_project(
  action: 'transition_phase'
)
```

**DO NOT:**
- Manually parse infographic-placements.md
- Call `generate_infographic` for individual placements unless the tool fails and you are retrying
- Skip marking phase complete or transitioning

**IMPORTANT:**
- Use `generate_all_infographics` for batch generation.
- Generated infographics are stored in `agent/infographic-placements/` (or in `outputs/` when using `output_dir: 'outputs'`) and registered in the manifest.
- If there are no infographic placements, the tool may return successfully with zero generated; still mark phase complete and transition.

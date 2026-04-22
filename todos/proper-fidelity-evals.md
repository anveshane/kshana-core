# Proper Fidelity Evals — re-audit projects with a tougher rubric

## Why

The first run of `pnpm audit-fidelity noir_detective_story_setup-3`
returned a 89/100 project average, but a manual look at the rendered
output suggests it is NOT actually that high quality. The current
rubric / VLM judge is over-lenient on real failures we care about.

## What to investigate

- **Compare VLM verdicts vs. honest human ratings on noir.** Pick 4–5
  shots that the audit scored 90+ and that you genuinely think are
  mediocre. Run them through `scripts/calibrate-vlm.ts` style diffing
  (Claude vs. VLM) AND write down your own per-question verdict.
  Where the VLM and Claude both pass but you fail — that's a rubric
  hole.
- **Likely rubric gaps:** atmospheric mood feel (does it look noir?),
  motion progression across keyframes (last vs first), color grading
  consistency, off-camera implication ("we should sense rain even if
  not pouring"). The current 11-question rubric is mostly subject /
  setting / counts — it doesn't probe cinematic quality.
- **Stricter calibration cases:** hand-pick 5–6 noir shots that we
  KNOW are weak and assert expected score ranges of 30-60 — not the
  current calibration set which is mostly strong cases.
- Consider a separate **`shot-cinematic-quality-binary.json`** rubric
  alongside the fidelity one. Fidelity asks "does it match the prompt";
  cinematic-quality asks "is it actually well-shot".

## How to run the existing tools

VLM judge calibration loop (single-shot):
```
pnpm calibrate-vlm
```
Diffs VLM vs Claude on the cases in `tests/calibration/vlm-judge-calibration.json`. Claude verdicts are cached
under `test-output/vlm-calibration/claude-cache/` so iteration is fast.
Passes when per-question agreement >= 80%. Tune
`prompts/skills/defaults/vlm_image_judge.md` between runs.

Compare candidate VLM models against cached Claude:
```
pnpm tsx scripts/compare-vlms.ts
```
Currently compares gpt-5-nano, grok-4.1-fast, mistral-small-3.2,
gemini-2.5-flash-lite. Edit `CANDIDATE_MODELS` in the script to add
others.

Audit a project's rendered shot videos:
```
pnpm audit-fidelity <project-name>                       # all shots
pnpm audit-fidelity <project-name> --per-scene=2         # stratified sample
pnpm audit-fidelity <project-name> --concurrency=5       # parallelism
pnpm audit-fidelity <project-name> --limit=10            # cap shot count
```
Walks `assets/manifest.json` for `scene_video` entries (deduped to
latest take per scene/shot), extracts first + last keyframes via
ffmpeg, judges each against the prompt at
`prompts/images/shots/scene-N-shot-M.json`. Writes a markdown report
to `test-output/fidelity/<project>-<timestamp>.md` with per-shot,
per-scene, project-level scores plus a bottom-quartile callout.

The judge is `qwen/qwen3-vl-8b` / `mistral-small-3.2` /
`x-ai/grok-4.1-fast` etc. on OpenRouter — switch via per-machine
`.llm-routing.json` (`utility.image_review` purpose). Current default
in `.llm-routing.json`: `x-ai/grok-4.1-fast` (96% calibration agreement,
no last-frame hangs).

## Suggested next steps

1. Curate a stricter calibration set (5+ noir shots that look weak by
   eye) with expected score ranges in the 30-60 band.
2. Re-run `pnpm calibrate-vlm` against it. If the VLM is too lenient
   on the weak cases, tune the judge prompt — likely add a question
   for "cinematic atmosphere matches the genre" or "does the image
   feel like the prompt's intended mood".
3. After the rubric is sharper, re-run
   `pnpm audit-fidelity noir_detective_story_setup-3` and see if the
   89 drops to a more realistic number.
4. Use the audit's bottom-quartile callout to decide which shots to
   re-roll vs which directives to simplify.

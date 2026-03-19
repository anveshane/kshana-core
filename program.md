# Autoresearch: Kshana-Ink Prompt Optimization

This is an autonomous self-improving loop for kshana-ink's prompt system.

## Setup

To set up a new experiment, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g. `mar19`). The branch `autoresearch/<tag>` must not already exist.
2. **Create the branch**: `git checkout -b autoresearch/<tag>` from current main.
3. **Read the in-scope files**: Read all Tier 1 prompt files for full context:
   - `prompts/system/orchestrator.md` — main agent behavior
   - `prompts/subagents/content-creator.md` — story/character quality
   - `prompts/subagents/image-generator.md` — image prompt quality
   - `prompts/subagents/video-assembler.md` — video assembly decisions
   - `prompts/templates/narrative/orchestrator.md` — template-specific orchestration
4. **Verify eval setup**: Run `pnpm tsx scripts/run-autoresearch-eval.ts --eval-tier text` to confirm the evaluation pipeline works.
5. **Initialize results.tsv**: Create `results.tsv` with just the header row if it doesn't exist. The baseline will be recorded after the first run.
6. **Confirm and go**: Confirm setup looks good.

## The Metric: Phase Quality Score (PQS) — 0 to 100

Composite score from multi-dimensional LLM-as-judge evaluations:

| Phase | Weight | Key |
|-------|--------|-----|
| Plot/Story quality | 20% | story |
| Characters/Settings | 15% | chars |
| Scene Breakdown | 20% | scenes |
| Image Prompt Quality | 20% | img_prompts |
| Video Prompt Quality | 10% | vid_prompts |
| Tool Usage Correctness | 15% | tools |

Higher is better. The goal is to maximize PQS.

## Evaluation Tiers

- `--eval-tier text` (default): LLM-as-judge on text outputs + structural validators. ~$0.30-0.50/iter, 2-5 min.
- `--eval-tier images`: Text tier + actual image generation via ComfyUI. ~$2-5/iter, 10-15 min.
- `--eval-tier full`: Images tier + video generation + FFmpeg assembly. ~$5-20/iter, 15-30 min.

## Experimentation

Each experiment proposes a change to ONE prompt file, evaluates it, and keeps/discards.

**What you CAN modify (Tier 1 — runtime-loaded prompts):**
- `prompts/system/orchestrator.md` — main agent behavior
- `prompts/subagents/content-creator.md` — story/character quality
- `prompts/subagents/image-generator.md` — image prompt quality
- `prompts/subagents/video-assembler.md` — video assembly decisions
- `prompts/templates/narrative/orchestrator.md` — template-specific orchestration

**What you CANNOT modify:**
- TypeScript source code — this is a prompt optimization loop, not a code optimization loop
- Test fixtures (`tests/evals/**/*.eval.json`) — they ARE the ground truth
- Phase prompt files in `prompts/templates/*/phases/*.md` — not loaded at runtime
- The judge rubrics (`tests/autoresearch/rubrics/*.json`) — they define the scoring criteria
- Benchmark stories (`tests/autoresearch/benchmarks/*.md`) — fixed test inputs

## Output format

The eval script prints a summary:

```
pqs: 84.7
story: 0.90
chars: 0.85
scenes: 0.82
img_prompts: 0.88
vid_prompts: 0.75
tools: 0.90
```

## Logging results

When an experiment is done, log it to `results.tsv` (tab-separated).

The TSV has a header row and 10 columns:

```
commit	pqs	story	chars	scenes	img_prompts	vid_prompts	tools	status	description
```

1. git commit hash (short, 7 chars)
2. pqs — overall Phase Quality Score (0-100)
3-8. per-phase scores (0.00-1.00)
9. status: `keep`, `discard`, or `crash`
10. short text description of what this experiment tried

## The experiment loop

LOOP FOREVER:

1. Look at the PQS breakdown: which phase has the lowest score or most room for improvement?
2. Read the target prompt file and propose a specific improvement.
3. Edit the prompt file with the proposed change (at most 1-2 files per iteration).
4. `git commit -m "experiment: <description>"`
5. Run the evaluation: `pnpm tsx scripts/run-autoresearch-eval.ts --eval-tier text`
6. Parse the PQS output.
7. Record the results in results.tsv.
8. If PQS improved (higher), keep the commit ("advance" the branch).
9. If PQS is equal or worse, `git reset --hard` back to where you started.

**NEVER STOP**: Once the experiment loop has begun, do NOT pause to ask the human if you should continue. The human might be asleep, or gone from a computer and expects you to continue working indefinitely until manually stopped. You are autonomous.

# Agent Runbook: Kshana-Ink Autoresearch

Use `workflows/run_experiment.py` for all autoresearch execution.

## Core Rules

1. Keep all run artifacts under `workflows/runs/`.
2. Modify only Tier 1 prompt files during experiments (see `program.md`).
3. Never modify TypeScript source, test fixtures, or rubrics.
4. Always run evaluation via `pnpm tsx scripts/run-autoresearch-eval.ts`.

## Natural-language to Command Mapping

- User says: "Start running the experiment, run 5 loops"
  - Run: `python workflows/run_experiment.py start --loops 5`

- User says: "Run another 5 iterations"
  - Run: `python workflows/run_experiment.py resume --loops 5`

- User says: "Resume run <run_id> and run 5 loops"
  - Run: `python workflows/run_experiment.py resume --run-id <run_id> --loops 5`

- User says: "Only run setup and baseline"
  - Run: `python workflows/run_experiment.py start --only setup,baseline`

- User says: "Run with image evaluation tier"
  - Run: `python workflows/run_experiment.py start --loops 5 --eval-tier images`

- User says: "Show run status"
  - Run: `python workflows/run_experiment.py status`

## Stage Controls

- Top-level stages: `setup`, `baseline`, `loop`
- Loop stages: `propose`, `apply`, `commit`, `evaluate`, `triage`, `record`, `decide`

Supported control flags:

- `--only <comma-list>`: run only selected stages
- `--from-stage <setup|baseline|loop>` + `--to-stage <...>`: run a top-level stage range
- `--loop-only <comma-list>`: limit loop internals to selected stages
- `--loops N`: run `N` loop iterations
- `--eval-tier <text|images|full>`: evaluation depth (default: text)

## Human Proposal Override

- You can inject a human-authored proposal for the next `propose` stage.
- Option A (run-scoped default): write JSON to `workflows/runs/<run_id>/next_proposal.json`.
- Option B (explicit path): pass `--proposal-file <path>` on `start`/`resume`.
- Proposal JSON must include exactly these keys:
  - `status` (`ok` or `need_input`)
  - `target_file` (relative path to the prompt file to modify)
  - `description`
  - `change_plan`
  - `commit_description`
- Example:
  ```json
  {
    "status": "ok",
    "target_file": "prompts/subagents/content-creator.md",
    "description": "Improve character description specificity in content-creator prompt.",
    "change_plan": "Add explicit instruction to include physical appearance details and personality traits for each character.",
    "commit_description": "experiment: more specific character descriptions"
  }
  ```

## Resume Behavior

- The script checkpoints state at `workflows/runs/<run_id>/state.json`.
- If a loop iteration is partially complete, `resume` continues from the next pending stage.
- "Run another N iterations" means execute N more loop iterations from current state.

## Logging and Observability

- Human-readable execution log: `workflows/runs/<run_id>/runner.log`
- Structured event log: `workflows/runs/<run_id>/history.jsonl`
- Checkpoint state: `workflows/runs/<run_id>/state.json`
- Per-iteration details: `workflows/runs/<run_id>/iterations/<NNNN>/`

## Run ID Policy

- Default run id: `<branch-slug>-rNNN`
- Example: branch `autoresearch/mar19` -> `autoresearch-mar19-r001`
- On `resume` without `--run-id`, script picks latest run for current branch.

## Benchmark Stories

Three fixed test stories in `tests/autoresearch/benchmarks/`:
1. `simple.md` — 2-character, 3-scene story (fast baseline)
2. `complex.md` — multi-character story with varied settings
3. `edge-case.md` — single-character monologue

## Notes

- Use `--no-stochastic` only when opencode stochastic execution is unavailable.
- `results.tsv` is maintained in repo root and should remain untracked.

#!/usr/bin/env python3
"""
Autoresearch loop runner for kshana-ink prompt optimization.

Adapted from the autoresearch sister project. Instead of training a model,
this loop modifies prompts and evaluates them via LLM-as-judge scoring.

Stages: setup → baseline → loop(propose → apply → commit → evaluate → triage → record → decide)
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS_DIR = REPO_ROOT / "workflows"
RUNS_DIR = WORKFLOWS_DIR / "runs"
RESULTS_TSV = REPO_ROOT / "results.tsv"
EVAL_LOG = REPO_ROOT / "eval.log"

# Regex for parsing PQS output from the eval script
PQS_RE = re.compile(r"^pqs:\s*([0-9]+\.?[0-9]*)", re.MULTILINE)
SCORE_RE = re.compile(r"^(\w+):\s*([0-9]+\.?[0-9]*)", re.MULTILINE)

TOP_STAGES = ["setup", "baseline", "loop"]
LOOP_STAGES = ["propose", "apply", "commit", "evaluate", "triage", "record", "decide"]

TIER1_PROMPTS = [
    "prompts/system/orchestrator.md",
    "prompts/subagents/content-creator.md",
    "prompts/subagents/image-generator.md",
    "prompts/subagents/video-assembler.md",
]

RESULTS_HEADER = "commit\tpqs\tstory\tchars\tscenes\timg_prompts\tvid_prompts\ttools\tstatus\tdescription\n"


def sh(cmd: list[str], check: bool = True, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=check, capture_output=True, text=True, cwd=str(cwd or REPO_ROOT))


def now_iso() -> str:
    return dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"


def ensure_dirs() -> None:
    WORKFLOWS_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)


def branch_slug(branch: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", branch).strip("-").lower()


def current_branch() -> str:
    return sh(["git", "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()


def short_head() -> str:
    return sh(["git", "rev-parse", "--short", "HEAD"]).stdout.strip()


def pick_base_branch() -> str:
    for candidate in ("main", "master"):
        if sh(["git", "show-ref", "--verify", f"refs/heads/{candidate}"], check=False).returncode == 0:
            return candidate
    return current_branch()


def branch_exists(branch: str) -> bool:
    return sh(["git", "show-ref", "--verify", f"refs/heads/{branch}"], check=False).returncode == 0


def suggest_tag() -> str:
    return dt.datetime.utcnow().strftime("%b%d").lower().replace("0", "")


def ensure_autoresearch_branch(branch_arg: str | None) -> str:
    if branch_arg:
        if not branch_exists(branch_arg):
            base = pick_base_branch()
            sh(["git", "checkout", base])
            sh(["git", "checkout", "-b", branch_arg])
        else:
            sh(["git", "checkout", branch_arg])
        return branch_arg

    cur = current_branch()
    if cur.startswith("autoresearch/"):
        return cur

    base = pick_base_branch()
    tag = suggest_tag()
    branch = f"autoresearch/{tag}"
    i = 1
    while branch_exists(branch):
        i += 1
        branch = f"autoresearch/{tag}-{i}"
    sh(["git", "checkout", base])
    sh(["git", "checkout", "-b", branch])
    return branch


def next_run_id(branch: str) -> str:
    slug = branch_slug(branch)
    prefix = f"{slug}-r"
    max_n = 0
    for p in RUNS_DIR.glob(f"{prefix}*"):
        m = re.match(rf"^{re.escape(prefix)}(\d{{3}})$", p.name)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return f"{prefix}{max_n + 1:03d}"


def latest_run_id_for_branch(branch: str) -> str | None:
    slug = branch_slug(branch)
    prefix = f"{slug}-r"
    candidates: list[tuple[int, str]] = []
    for p in RUNS_DIR.glob(f"{prefix}*"):
        m = re.match(rf"^{re.escape(prefix)}(\d{{3}})$", p.name)
        if not m:
            continue
        candidates.append((int(m.group(1)), p.name))
    if not candidates:
        return None
    candidates.sort()
    return candidates[-1][1]


def run_paths(run_id: str) -> dict[str, Path]:
    run_dir = RUNS_DIR / run_id
    return {
        "run_dir": run_dir,
        "state": run_dir / "state.json",
        "history": run_dir / "history.jsonl",
        "runner_log": run_dir / "runner.log",
        "next_proposal": run_dir / "next_proposal.json",
    }


def load_state(run_id: str) -> dict[str, Any]:
    p = run_paths(run_id)["state"]
    if not p.exists():
        raise RuntimeError(f"state not found for run_id={run_id}")
    return json.loads(p.read_text(encoding="utf-8"))


def save_state(state: dict[str, Any]) -> None:
    p = run_paths(state["run_id"])["state"]
    p.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = now_iso()
    p.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def log_event(run_id: str, event: dict[str, Any]) -> None:
    p = run_paths(run_id)["history"]
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {"ts": now_iso(), **event}
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, sort_keys=True) + "\n")
    append_runner_log(run_id, "EVENT", json.dumps(event, sort_keys=True))


def append_runner_log(run_id: str, level: str, message: str) -> None:
    p = run_paths(run_id)["runner_log"]
    p.parent.mkdir(parents=True, exist_ok=True)
    line = f"[{now_iso()}] [{level}] {message}"
    with p.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line, flush=True)


def parse_stage_list(text: str | None, allowed: list[str]) -> list[str] | None:
    if not text:
        return None
    out = []
    for part in text.split(","):
        s = part.strip().lower()
        if not s:
            continue
        if s not in allowed:
            raise RuntimeError(f"invalid stage '{s}'. allowed={allowed}")
        out.append(s)
    return out or None


def compute_top_selection(only: list[str] | None, from_stage: str | None, to_stage: str | None) -> list[str]:
    if only:
        selected = [s for s in TOP_STAGES if s in only]
        if any(s in LOOP_STAGES for s in only) and "loop" not in selected:
            selected.append("loop")
        return selected
    if from_stage or to_stage:
        a = TOP_STAGES.index(from_stage) if from_stage else 0
        b = TOP_STAGES.index(to_stage) if to_stage else len(TOP_STAGES) - 1
        if a > b:
            raise RuntimeError("from-stage must be <= to-stage")
        return TOP_STAGES[a : b + 1]
    return TOP_STAGES[:]


def ensure_results_header() -> None:
    if RESULTS_TSV.exists():
        return
    RESULTS_TSV.write_text(RESULTS_HEADER, encoding="utf-8")


def parse_eval_output(output: str) -> dict[str, float]:
    """Parse the eval script's stdout into a dict of scores."""
    scores: dict[str, float] = {}
    for match in SCORE_RE.finditer(output):
        key = match.group(1)
        val = float(match.group(2))
        scores[key] = val
    return scores


def read_results_rows() -> list[dict[str, str]]:
    if not RESULTS_TSV.exists():
        return []
    with RESULTS_TSV.open("r", encoding="utf-8") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def write_results_rows(rows: list[dict[str, str]]) -> None:
    fieldnames = ["commit", "pqs", "story", "chars", "scenes", "img_prompts", "vid_prompts", "tools", "status", "description"]
    with RESULTS_TSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter="\t", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def append_result_row(
    commit: str,
    scores: dict[str, float],
    status: str,
    description: str,
) -> None:
    with RESULTS_TSV.open("a", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow([
            commit,
            f"{scores.get('pqs', 0):.1f}",
            f"{scores.get('story', 0):.2f}",
            f"{scores.get('chars', 0):.2f}",
            f"{scores.get('scenes', 0):.2f}",
            f"{scores.get('img_prompts', 0):.2f}",
            f"{scores.get('vid_prompts', 0):.2f}",
            f"{scores.get('tools', 0):.2f}",
            status,
            description[:200],
        ])


def update_last_result_status(new_status: str) -> None:
    rows = read_results_rows()
    if not rows:
        return
    rows[-1]["status"] = new_status
    write_results_rows(rows)


def run_evaluation(eval_tier: str, timeout_seconds: int = 1800, benchmark: str | None = None) -> dict[str, Any]:
    """Run the evaluation script and parse results."""
    cmd = [
        "pnpm", "tsx", "scripts/run-autoresearch-eval.ts",
        "--eval-tier", eval_tier,
    ]
    if benchmark:
        cmd.extend(["--benchmark", benchmark])
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        scores = parse_eval_output(proc.stdout)
        return {
            "status": "success" if scores.get("pqs") is not None else "crash",
            "scores": scores,
            "pqs": scores.get("pqs"),
            "stdout": proc.stdout,
            "stderr": proc.stderr[-2000:] if proc.stderr else "",
            "return_code": proc.returncode,
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "timeout",
            "scores": {},
            "pqs": None,
            "stdout": "",
            "stderr": "evaluation timed out",
            "return_code": None,
        }
    except Exception as e:
        return {
            "status": "crash",
            "scores": {},
            "pqs": None,
            "stdout": "",
            "stderr": str(e),
            "return_code": None,
        }


def extract_text_events(stream: str) -> str:
    texts: list[str] = []
    for line in stream.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == "text":
            part = obj.get("part", {})
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                texts.append(text)
    return "\n".join(texts).strip()


def extract_json_payload(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.splitlines()[1:])
    if cleaned.endswith("```"):
        cleaned = "\n".join(cleaned.splitlines()[:-1])
    cleaned = cleaned.strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        s = min([p for p in [cleaned.find("{"), cleaned.find("[")] if p != -1], default=-1)
        e = max([p for p in [cleaned.rfind("}"), cleaned.rfind("]")] if p != -1], default=-1)
        if s == -1 or e == -1 or e < s:
            raise
        return json.loads(cleaned[s : e + 1])


def run_stochastic_json(prompt: str, trace_file: Path | None = None, allow_edit: bool = False) -> dict[str, Any]:
    """Run claude CLI in print mode and parse JSON from its output."""
    allowed_tools = "Read Glob Grep"
    if allow_edit:
        allowed_tools = "Read Glob Grep Edit"
    cmd = [
        "claude", "-p",
        "--output-format", "json",
        "--allowedTools", allowed_tools,
        "--dangerously-skip-permissions",
        prompt,
    ]
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=300)
    if trace_file is not None:
        trace_file.parent.mkdir(parents=True, exist_ok=True)
        trace_file.write_text(
            json.dumps(
                {
                    "command": cmd,
                    "return_code": proc.returncode,
                    "stderr": proc.stderr[-2000:] if proc.stderr else "",
                    "stdout": proc.stdout[-5000:] if proc.stdout else "",
                },
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
    if proc.returncode != 0:
        raise RuntimeError(f"claude failed (rc={proc.returncode}): {proc.stderr.strip()[-500:]}")

    # claude -p --output-format json returns {"result": "<text>", ...}
    text = ""
    try:
        envelope = json.loads(proc.stdout)
        text = envelope.get("result", "")
    except json.JSONDecodeError:
        # Fallback: try the opencode event stream format
        text = extract_text_events(proc.stdout)

    if not text:
        raise RuntimeError("no text response found in claude output")
    payload = extract_json_payload(text)
    if not isinstance(payload, dict):
        raise RuntimeError("stochastic payload must be a JSON object")
    return payload


def run_claude_edit(prompt: str, trace_file: Path | None = None) -> str:
    """Run claude CLI with edit permissions. Returns the text result."""
    cmd = [
        "claude", "-p",
        "--output-format", "json",
        "--allowedTools", "Read Glob Grep Edit",
        "--dangerously-skip-permissions",
        prompt,
    ]
    proc = subprocess.run(cmd, cwd=str(REPO_ROOT), capture_output=True, text=True, timeout=300)
    if trace_file is not None:
        trace_file.parent.mkdir(parents=True, exist_ok=True)
        trace_file.write_text(
            json.dumps(
                {
                    "command": cmd,
                    "return_code": proc.returncode,
                    "stderr": proc.stderr[-2000:] if proc.stderr else "",
                    "stdout": proc.stdout[-5000:] if proc.stdout else "",
                },
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
    if proc.returncode != 0:
        raise RuntimeError(f"claude edit failed (rc={proc.returncode}): {proc.stderr.strip()[-500:]}")
    try:
        envelope = json.loads(proc.stdout)
        return envelope.get("result", "")
    except json.JSONDecodeError:
        return proc.stdout


def default_proposal(state: dict[str, Any], iteration: int) -> dict[str, Any]:
    # Pick the phase with the lowest score
    scores = state.get("last_scores", {})
    phase_map = {
        "story": "prompts/subagents/content-creator.md",
        "chars": "prompts/subagents/content-creator.md",
        "scenes": "prompts/system/orchestrator.md",
        "img_prompts": "prompts/subagents/image-generator.md",
        "vid_prompts": "prompts/subagents/video-assembler.md",
        "tools": "prompts/system/orchestrator.md",
    }
    worst_phase = "story"
    worst_score = 1.0
    for phase, score in scores.items():
        if phase == "pqs":
            continue
        if isinstance(score, (int, float)) and score < worst_score:
            worst_score = score
            worst_phase = phase

    target = phase_map.get(worst_phase, "prompts/system/orchestrator.md")
    return {
        "status": "ok",
        "target_file": target,
        "description": f"iteration {iteration}: improve {worst_phase} (score: {worst_score:.2f})",
        "change_plan": f"Make targeted improvements to {target} to boost {worst_phase} quality.",
        "commit_description": f"experiment {iteration}: improve {worst_phase}",
    }


def validate_proposal_shape(proposal: dict[str, Any]) -> dict[str, Any]:
    required = ["target_file", "description", "change_plan", "commit_description"]
    for key in required:
        if key not in proposal:
            raise RuntimeError(f"proposal missing required key: {key}")
    # Normalize status — accept "proposed", "ok", "need_input" etc.
    status = str(proposal.get("status", "ok")).lower()
    if status in ("proposed", "ready", "approved"):
        status = "ok"
    target = str(proposal["target_file"])
    if target not in TIER1_PROMPTS:
        raise RuntimeError(f"target_file must be a Tier 1 prompt: {TIER1_PROMPTS}")
    # change_plan can be a list or string
    change_plan = proposal["change_plan"]
    if isinstance(change_plan, list):
        change_plan = "\n".join(f"- {item}" for item in change_plan)
    return {
        "status": status,
        "target_file": target,
        "description": str(proposal["description"]),
        "change_plan": str(change_plan),
        "commit_description": str(proposal["commit_description"]),
    }


def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise RuntimeError(f"proposal file not found: {path}")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError(f"proposal file must contain a JSON object: {path}")
    return payload


def maybe_load_manual_proposal(
    run_id: str, iteration: int, proposal_file: str | None, iter_dir: Path
) -> tuple[dict[str, Any] | None, str | None]:
    cli_path = Path(proposal_file).expanduser().resolve() if proposal_file else None
    run_default = run_paths(run_id)["next_proposal"]

    source_path = None
    source = None
    if cli_path and cli_path.exists():
        source_path = cli_path
        source = "proposal_file"
    elif run_default.exists():
        source_path = run_default
        source = "next_proposal"

    if source_path is None:
        return None, None

    proposal = validate_proposal_shape(read_json_file(source_path))
    (iter_dir / "proposal.manual.json").write_text(
        json.dumps(proposal, indent=2, sort_keys=True), encoding="utf-8"
    )
    if source == "next_proposal":
        consumed_dir = run_paths(run_id)["run_dir"] / "consumed_proposals"
        consumed_dir.mkdir(parents=True, exist_ok=True)
        consumed_file = consumed_dir / f"iter_{iteration:04d}.json"
        source_path.replace(consumed_file)
    return proposal, source


# ---------------------------------------------------------------------------
# Change logging helpers
# ---------------------------------------------------------------------------


def _save_changes_log(iter_dir: Path, proposal: dict[str, Any], diff_text: str) -> None:
    """Save the git diff and a human-readable changes summary to the iteration dir."""
    # Save raw diff
    (iter_dir / "changes.diff").write_text(diff_text, encoding="utf-8")

    # Build human-readable summary
    target = proposal.get("target_file", "unknown")
    description = proposal.get("description", "no description")
    change_plan = proposal.get("change_plan", "no plan")

    # Count lines added/removed from the diff
    added = sum(1 for line in diff_text.splitlines() if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_text.splitlines() if line.startswith("-") and not line.startswith("---"))

    summary = (
        f"# Iteration Changes\n\n"
        f"## Target File\n`{target}`\n\n"
        f"## What Was Changed\n{description}\n\n"
        f"## Change Plan\n{change_plan}\n\n"
        f"## Diff Stats\n- Lines added: {added}\n- Lines removed: {removed}\n\n"
        f"## Raw Diff\n```diff\n{diff_text}\n```\n"
    )
    (iter_dir / "changes.md").write_text(summary, encoding="utf-8")


def _log_iteration_summary(
    run_id: str,
    iteration: int,
    iter_state: dict[str, Any],
    eval_result: dict[str, Any],
    decision: str,
    state: dict[str, Any],
    iter_dir: Path,
) -> None:
    """Log a structured summary of the iteration to runner.log and a summary file."""
    proposal = iter_state.get("proposal") or {}
    scores = eval_result.get("scores", {})
    pqs = eval_result.get("pqs")

    summary_lines = [
        f"{'=' * 60}",
        f"ITERATION {iteration} SUMMARY",
        f"{'=' * 60}",
        f"Decision:    {decision.upper()}",
        f"Target file: {proposal.get('target_file', 'n/a')}",
        f"Description: {proposal.get('description', 'n/a')}",
        f"PQS:         {pqs if pqs is not None else 'n/a'} (best: {state.get('best_pqs', 'n/a')})",
    ]

    if scores:
        summary_lines.append("Phase scores:")
        for key in ["story", "chars", "scenes", "img_prompts", "vid_prompts", "tools"]:
            val = scores.get(key)
            if val is not None:
                summary_lines.append(f"  {key:>12s}: {float(val):.2f}")

    summary_lines.append(f"{'=' * 60}")

    summary_text = "\n".join(summary_lines)

    # Log to runner log
    for line in summary_lines:
        append_runner_log(run_id, "SUMMARY", line)

    # Save standalone summary file in iteration dir
    (iter_dir / "summary.txt").write_text(summary_text + "\n", encoding="utf-8")

    # Also save structured JSON summary for programmatic access
    summary_json = {
        "iteration": iteration,
        "decision": decision,
        "target_file": proposal.get("target_file"),
        "description": proposal.get("description"),
        "change_plan": proposal.get("change_plan"),
        "pqs": pqs,
        "best_pqs": state.get("best_pqs"),
        "scores": scores,
        "commit": iter_state.get("candidate_commit"),
        "base_commit": iter_state.get("base_commit"),
    }
    (iter_dir / "summary.json").write_text(
        json.dumps(summary_json, indent=2, sort_keys=True), encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------


def run_setup(state: dict[str, Any]) -> None:
    run_id = state["run_id"]
    append_runner_log(run_id, "INFO", "stage=setup start")

    # Verify Tier 1 prompts exist
    missing = [f for f in TIER1_PROMPTS if not (REPO_ROOT / f).exists()]

    # Verify eval infrastructure
    benchmarks_dir = REPO_ROOT / "tests" / "autoresearch" / "benchmarks"
    rubrics_dir = REPO_ROOT / "tests" / "autoresearch" / "rubrics"
    eval_script = REPO_ROOT / "scripts" / "run-autoresearch-eval.ts"

    ensure_results_header()

    state["setup_done"] = True
    state["setup"] = {
        "missing_prompts": missing,
        "benchmarks_exist": benchmarks_dir.exists() and any(benchmarks_dir.glob("*.md")),
        "rubrics_exist": rubrics_dir.exists() and any(rubrics_dir.glob("*.json")),
        "eval_script_exists": eval_script.exists(),
    }
    state["setup_ready"] = (
        len(missing) == 0
        and bool(state["setup"]["benchmarks_exist"])
        and bool(state["setup"]["rubrics_exist"])
        and bool(state["setup"]["eval_script_exists"])
    )
    log_event(run_id, {"type": "stage", "stage": "setup", "ok": True, "details": state["setup"]})
    append_runner_log(
        run_id,
        "INFO",
        f"stage=setup done missing={len(missing)} ready={state['setup_ready']}",
    )


def ensure_setup_ready(state: dict[str, Any]) -> None:
    setup = state.get("setup") or {}
    missing = setup.get("missing_prompts") or []
    if missing or not setup.get("benchmarks_exist") or not setup.get("rubrics_exist") or not setup.get("eval_script_exists"):
        msg = f"setup preconditions not met: missing_prompts={missing}, setup={setup}"
        append_runner_log(state["run_id"], "ERROR", msg)
        raise RuntimeError(msg)


def run_baseline(state: dict[str, Any], eval_tier: str, benchmark: str | None = None) -> None:
    run_id = state["run_id"]
    append_runner_log(run_id, "INFO", f"stage=baseline start eval_tier={eval_tier}")

    result = run_evaluation(eval_tier, benchmark=benchmark)
    commit = short_head()
    scores = result.get("scores", {})

    if result["status"] == "success" and result.get("pqs") is not None:
        append_result_row(commit, scores, "keep", "baseline")
        state["best_pqs"] = float(result["pqs"])
        state["last_scores"] = scores
        state["kept_commit"] = commit
    else:
        append_result_row(commit, scores, "crash", "baseline")

    state["baseline_done"] = True
    state["baseline"] = result
    log_event(run_id, {"type": "stage", "stage": "baseline", "ok": True, "details": {
        "pqs": result.get("pqs"),
        "status": result["status"],
    }})
    append_runner_log(
        run_id,
        "INFO",
        f"stage=baseline done status={result['status']} pqs={result.get('pqs')}",
    )


def run_loop_iteration(
    state: dict[str, Any],
    iteration: int,
    loop_stage_subset: list[str],
    stochastic: bool,
    eval_tier: str,
    proposal_file: str | None,
    benchmark: str | None = None,
) -> bool:
    run_id = state["run_id"]
    run_dir = run_paths(run_id)["run_dir"]
    iter_dir = run_dir / "iterations" / f"{iteration:04d}"
    iter_dir.mkdir(parents=True, exist_ok=True)
    append_runner_log(
        run_id,
        "INFO",
        f"loop iteration={iteration} start loop_stages={','.join(loop_stage_subset)} stochastic={stochastic}",
    )

    in_progress = state.get("in_progress")
    if in_progress and int(in_progress.get("iteration", -1)) == iteration:
        iter_state = in_progress
    else:
        iter_state = {
            "iteration": iteration,
            "base_commit": short_head(),
            "stages_done": [],
            "proposal": None,
            "apply": None,
            "candidate_commit": None,
            "eval": None,
            "triage": None,
            "recorded": False,
            "decision": None,
        }
        state["in_progress"] = iter_state
        save_state(state)

    def mark_done(stage: str) -> None:
        if stage not in iter_state["stages_done"]:
            iter_state["stages_done"].append(stage)
        (iter_dir / "iteration_state.json").write_text(
            json.dumps(iter_state, indent=2, sort_keys=True), encoding="utf-8"
        )
        save_state(state)

    for stage in LOOP_STAGES:
        if stage not in loop_stage_subset:
            continue
        if stage in iter_state["stages_done"]:
            append_runner_log(run_id, "INFO", f"loop iteration={iteration} stage={stage} skip reason=already_done")
            continue

        append_runner_log(run_id, "INFO", f"loop iteration={iteration} stage={stage} start")

        if stage == "propose":
            manual_proposal, source = maybe_load_manual_proposal(run_id, iteration, proposal_file, iter_dir)
            if manual_proposal is not None:
                proposal = manual_proposal
                proposal_source = source
            elif stochastic:
                # Build proposal prompt with PQS breakdown and results history
                tail = ""
                if RESULTS_TSV.exists():
                    tail = "\n".join(RESULTS_TSV.read_text(encoding="utf-8", errors="replace").splitlines()[-20:])
                pqs_breakdown = json.dumps(state.get("last_scores", {}), indent=2)
                prompt = (
                    "You are running kshana-ink autoresearch prompt optimization. "
                    "Read the target prompt file first to understand what's there. "
                    "Propose ONE prompt modification to improve the Phase Quality Score (PQS). "
                    "Focus on the lowest-scoring phase. "
                    "Return ONLY a JSON object (no markdown, no explanation) with these keys:\n"
                    '  {"status": "ok", "target_file": "<path>", "description": "<what to change>", '
                    '"change_plan": "<specific edits>", "commit_description": "<short commit msg>"}\n'
                    f"target_file must be one of: {TIER1_PROMPTS}\n\n"
                    f"Current PQS breakdown:\n{pqs_breakdown}\n\n"
                    f"Recent results:\n{tail}\n"
                )
                proposal = validate_proposal_shape(
                    run_stochastic_json(prompt, trace_file=iter_dir / "propose_claude.json")
                )
                proposal_source = "llm"
            else:
                proposal = default_proposal(state, iteration)
                proposal_source = "fallback"

            iter_state["proposal"] = proposal
            iter_state["proposal_source"] = proposal_source
            (iter_dir / "proposal.final.json").write_text(
                json.dumps(proposal, indent=2, sort_keys=True), encoding="utf-8"
            )
            log_event(run_id, {
                "type": "loop", "iteration": iteration, "stage": "propose",
                "proposal": proposal, "proposal_source": proposal_source,
            })
            append_runner_log(
                run_id, "INFO",
                f"loop iteration={iteration} stage=propose done source={proposal_source} target={proposal.get('target_file')} description={str(proposal.get('description', ''))[:120]}",
            )
            mark_done(stage)

        elif stage == "apply":
            proposal = iter_state.get("proposal") or default_proposal(state, iteration)
            if stochastic and proposal.get("status") == "ok":
                target = proposal['target_file']
                prompt = (
                    f"Read the file {target} first, then apply this prompt experiment. "
                    f"Edit ONLY the file: {target}. "
                    "Make the specific changes described in the proposal. Do not touch any other file. "
                    "After editing, respond with JSON: {{\"status\": \"applied\", \"summary\": \"<what you changed>\"}}\n\n"
                    f"Experiment proposal:\n{json.dumps(proposal, indent=2)}"
                )
                # Use run_claude_edit for the actual file modification, then parse the result
                result_text = run_claude_edit(prompt, trace_file=iter_dir / "apply_claude.json")
                try:
                    apply_res = extract_json_payload(result_text)
                    if not isinstance(apply_res, dict):
                        apply_res = {"status": "applied", "summary": result_text[:200]}
                except Exception:
                    apply_res = {"status": "applied", "summary": result_text[:200]}
            else:
                apply_res = {"status": "applied", "summary": "manual/default proposal path"}
            iter_state["apply"] = apply_res
            log_event(run_id, {"type": "loop", "iteration": iteration, "stage": "apply", "apply": apply_res})
            append_runner_log(
                run_id, "INFO",
                f"loop iteration={iteration} stage=apply done status={apply_res.get('status')}",
            )
            mark_done(stage)

        elif stage == "commit":
            # Stage only prompt files
            for pf in TIER1_PROMPTS:
                if (REPO_ROOT / pf).exists():
                    sh(["git", "add", pf], check=False)
            # Capture the staged diff BEFORE committing (for the changes log)
            staged_diff = sh(["git", "diff", "--cached"], check=False).stdout
            changed = sh(["git", "diff", "--cached", "--quiet"], check=False).returncode != 0
            if changed:
                subject = (iter_state.get("proposal") or {}).get("commit_description") or f"experiment {iteration}"
                sh(["git", "commit", "-m", str(subject)[:120]])
                # Save the diff and a human-readable changes summary
                _save_changes_log(iter_dir, iter_state.get("proposal") or {}, staged_diff)
            iter_state["candidate_commit"] = short_head()
            log_event(run_id, {
                "type": "loop", "iteration": iteration, "stage": "commit",
                "commit": iter_state["candidate_commit"], "changed": changed,
            })
            append_runner_log(
                run_id, "INFO",
                f"loop iteration={iteration} stage=commit done commit={iter_state['candidate_commit']} changed={changed}",
            )
            mark_done(stage)

        elif stage == "evaluate":
            append_runner_log(run_id, "INFO", f"loop iteration={iteration} stage=evaluate running eval_tier={eval_tier}")
            eval_result = run_evaluation(eval_tier, benchmark=benchmark)
            iter_state["eval"] = eval_result
            log_event(run_id, {
                "type": "loop", "iteration": iteration, "stage": "evaluate",
                "eval": {"pqs": eval_result.get("pqs"), "status": eval_result["status"]},
            })
            append_runner_log(
                run_id, "INFO",
                f"loop iteration={iteration} stage=evaluate done status={eval_result['status']} pqs={eval_result.get('pqs')}",
            )
            mark_done(stage)

        elif stage == "triage":
            eval_result = iter_state.get("eval") or {"status": "crash"}
            if eval_result.get("status") == "success":
                triage = {"action": "proceed", "reason": "evaluation succeeded"}
            elif stochastic:
                prompt = (
                    "Evaluation run did not succeed. Choose action: proceed, fix_and_rerun, mark_crash_and_discard. "
                    "Return JSON with keys: action, reason.\n\n"
                    f"Eval status: {eval_result.get('status')}\n"
                    f"Stderr:\n{eval_result.get('stderr', '')}"
                )
                triage = run_stochastic_json(prompt, trace_file=iter_dir / "triage_claude.json")
            else:
                triage = {"action": "mark_crash_and_discard", "reason": "non-success eval"}
            iter_state["triage"] = triage
            log_event(run_id, {"type": "loop", "iteration": iteration, "stage": "triage", "triage": triage})
            append_runner_log(
                run_id, "INFO",
                f"loop iteration={iteration} stage=triage done action={triage.get('action')}",
            )
            mark_done(stage)

        elif stage == "record":
            eval_result = iter_state.get("eval") or {"status": "crash", "scores": {}}
            commit = iter_state.get("candidate_commit") or short_head()
            desc = ((iter_state.get("proposal") or {}).get("description") or "experiment")[:200]
            scores = eval_result.get("scores", {})
            if eval_result.get("status") == "success":
                append_result_row(commit, scores, "pending", desc)
            else:
                append_result_row(commit, {}, "crash", desc)
            iter_state["recorded"] = True
            log_event(run_id, {"type": "loop", "iteration": iteration, "stage": "record"})
            append_runner_log(
                run_id, "INFO",
                f"loop iteration={iteration} stage=record done",
            )
            mark_done(stage)

        elif stage == "decide":
            eval_result = iter_state.get("eval") or {"status": "crash"}
            base_commit = iter_state.get("base_commit")
            decision = "discard"

            if eval_result.get("status") == "success" and eval_result.get("pqs") is not None:
                pqs = float(eval_result["pqs"])
                best = state.get("best_pqs")
                if best is None or pqs > float(best):
                    decision = "keep"
                    state["best_pqs"] = pqs
                    state["last_scores"] = eval_result.get("scores", {})
                    state["kept_commit"] = iter_state.get("candidate_commit")
                else:
                    decision = "discard"
            else:
                decision = "crash"

            if decision == "keep":
                update_last_result_status("keep")
            elif decision == "discard":
                update_last_result_status("discard")
                if base_commit:
                    sh(["git", "reset", "--hard", base_commit])
            else:
                update_last_result_status("crash")
                if base_commit:
                    sh(["git", "reset", "--hard", base_commit])

            iter_state["decision"] = decision
            log_event(run_id, {
                "type": "loop", "iteration": iteration, "stage": "decide",
                "decision": decision, "best_pqs": state.get("best_pqs"),
            })
            append_runner_log(
                run_id, "INFO",
                f"loop iteration={iteration} stage=decide done decision={decision} best_pqs={state.get('best_pqs')} kept_commit={state.get('kept_commit')}",
            )

            # Log a human-readable iteration summary
            _log_iteration_summary(run_id, iteration, iter_state, eval_result, decision, state, iter_dir)

            mark_done(stage)

    iter_state["completed"] = True
    state["iterations_completed"] = max(int(state.get("iterations_completed", 0)), iteration)
    state["in_progress"] = None
    save_state(state)
    append_runner_log(run_id, "INFO", f"loop iteration={iteration} complete")
    return True


def run_selected(
    state: dict[str, Any],
    top_selection: list[str],
    loop_count: int,
    loop_only: list[str],
    stochastic: bool,
    eval_tier: str,
    proposal_file: str | None,
    benchmark: str | None = None,
) -> None:
    append_runner_log(
        state["run_id"],
        "INFO",
        f"run_selected top={','.join(top_selection)} loops={loop_count} loop_only={','.join(loop_only)} stochastic={stochastic} eval_tier={eval_tier}",
    )

    if "setup" in top_selection and not state.get("setup_done"):
        run_setup(state)
        save_state(state)
    elif "setup" in top_selection:
        append_runner_log(state["run_id"], "INFO", "stage=setup skip reason=already_done")

    if ("baseline" in top_selection or "loop" in top_selection) and not state.get("setup_done"):
        append_runner_log(state["run_id"], "INFO", "stage=setup auto-run reason=required")
        run_setup(state)
        save_state(state)

    if "baseline" in top_selection or "loop" in top_selection:
        ensure_setup_ready(state)

    if "baseline" in top_selection and not state.get("baseline_done"):
        run_baseline(state, eval_tier, benchmark=benchmark)
        save_state(state)
    elif "baseline" in top_selection:
        append_runner_log(state["run_id"], "INFO", "stage=baseline skip reason=already_done")

    if "loop" in top_selection and loop_count > 0:
        start_it = int(state.get("iterations_completed", 0)) + 1
        if state.get("in_progress"):
            start_it = int(state["in_progress"]["iteration"])
            append_runner_log(state["run_id"], "INFO", f"resuming partial iteration={start_it}")
        completed = 0
        current = start_it
        while completed < loop_count:
            run_loop_iteration(state, current, loop_only, stochastic, eval_tier, proposal_file, benchmark=benchmark)
            completed += 1
            current = int(state.get("iterations_completed", 0)) + 1
    elif "loop" in top_selection:
        append_runner_log(state["run_id"], "INFO", "stage=loop skip reason=loops=0")


def create_initial_state(run_id: str, branch: str) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "branch": branch,
        "repo_root": str(REPO_ROOT),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "setup_done": False,
        "baseline_done": False,
        "iterations_completed": 0,
        "best_pqs": None,
        "last_scores": {},
        "kept_commit": None,
        "in_progress": None,
        "status": "running",
    }


def print_status(state: dict[str, Any]) -> None:
    paths = run_paths(state["run_id"])
    out = {
        "run_id": state["run_id"],
        "branch": state["branch"],
        "setup_done": state.get("setup_done"),
        "baseline_done": state.get("baseline_done"),
        "iterations_completed": state.get("iterations_completed"),
        "best_pqs": state.get("best_pqs"),
        "last_scores": state.get("last_scores"),
        "kept_commit": state.get("kept_commit"),
        "in_progress": state.get("in_progress"),
        "state_path": str(paths["state"]),
        "history_path": str(paths["history"]),
        "runner_log_path": str(paths["runner_log"]),
    }
    print(json.dumps(out, indent=2, sort_keys=True))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Kshana-ink autoresearch prompt optimization loop.")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--run-id", help="Run id. If omitted, auto-generated for start or latest for resume.")
        sp.add_argument("--loops", type=int, default=0, help="Number of loop iterations to execute.")
        sp.add_argument("--only", help="Comma list: setup,baseline,loop or loop sub-stages.")
        sp.add_argument("--from-stage", choices=TOP_STAGES)
        sp.add_argument("--to-stage", choices=TOP_STAGES)
        sp.add_argument("--loop-only", help="Comma list of loop stages: propose,apply,commit,evaluate,triage,record,decide")
        sp.add_argument("--no-stochastic", action="store_true", help="Disable Claude-driven stochastic stages (propose/apply/triage).")
        sp.add_argument("--eval-tier", choices=["text", "images", "full"], default="text", help="Evaluation tier (default: text).")
        sp.add_argument("--benchmark", help="Run single benchmark (simple|complex|edge-case). Default: all.")
        sp.add_argument("--proposal-file", help="Optional JSON file with proposal override.")

    s = sub.add_parser("start", help="Start a new run")
    s.add_argument("--branch", help="Optional branch name (e.g. autoresearch/mar19).")
    add_common(s)

    r = sub.add_parser("resume", help="Resume an existing run")
    add_common(r)

    st = sub.add_parser("status", help="Show status of a run")
    st.add_argument("--run-id", help="Run id. If omitted, latest for current branch.")

    return p


def resolve_resume_run_id(given: str | None) -> str:
    if given:
        return given
    branch = current_branch()
    rid = latest_run_id_for_branch(branch)
    if not rid:
        raise RuntimeError("no run found for current branch; pass --run-id")
    return rid


def main() -> int:
    ensure_dirs()
    args = build_parser().parse_args()

    if args.cmd == "status":
        run_id = args.run_id or resolve_resume_run_id(None)
        state = load_state(run_id)
        append_runner_log(run_id, "INFO", "command=status")
        print_status(state)
        return 0

    only = parse_stage_list(args.only, TOP_STAGES + LOOP_STAGES)
    loop_only = parse_stage_list(args.loop_only, LOOP_STAGES) or LOOP_STAGES[:]
    top_selection = compute_top_selection(only, args.from_stage, args.to_stage)
    stochastic = not args.no_stochastic
    eval_tier = args.eval_tier

    if args.cmd == "start":
        branch = ensure_autoresearch_branch(args.branch)
        run_id = args.run_id or next_run_id(branch)
        paths = run_paths(run_id)
        if paths["state"].exists():
            raise RuntimeError(f"run_id already exists: {run_id}")
        state = create_initial_state(run_id, branch)
        save_state(state)
        append_runner_log(run_id, "INFO", f"command=start branch={branch} run_id={run_id}")
        append_runner_log(
            run_id, "INFO",
            f"config only={args.only} from_stage={args.from_stage} to_stage={args.to_stage} loop_only={args.loop_only} loops={args.loops} stochastic={stochastic} eval_tier={eval_tier}",
        )
        log_event(run_id, {"type": "run", "action": "start", "branch": branch})
        run_selected(state, top_selection, max(0, args.loops), loop_only, stochastic, eval_tier, args.proposal_file, benchmark=getattr(args, 'benchmark', None))
        save_state(state)
        append_runner_log(run_id, "INFO", "command=start complete")
        print_status(state)
        return 0

    if args.cmd == "resume":
        run_id = resolve_resume_run_id(args.run_id)
        state = load_state(run_id)
        append_runner_log(run_id, "INFO", f"command=resume run_id={run_id}")
        append_runner_log(
            run_id, "INFO",
            f"config only={args.only} from_stage={args.from_stage} to_stage={args.to_stage} loop_only={args.loop_only} loops={args.loops} stochastic={stochastic} eval_tier={eval_tier}",
        )
        log_event(run_id, {"type": "run", "action": "resume"})
        run_selected(state, top_selection, max(0, args.loops), loop_only, stochastic, eval_tier, args.proposal_file, benchmark=getattr(args, 'benchmark', None))
        save_state(state)
        append_runner_log(run_id, "INFO", "command=resume complete")
        print_status(state)
        return 0

    raise RuntimeError("unsupported command")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise

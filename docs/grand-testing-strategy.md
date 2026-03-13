# TDD Architecture for kshana-ink Agentic System

## Context

The core problem: in an agentic system, **the prompt IS the code**. Mocking the LLM tests your mock, not your system. But running LLMs for every test is expensive and slow. We need a layered strategy that tests real LLM behavior where it matters, while keeping costs manageable.

The existing test infrastructure (Vitest, PromptEvaluator, MockLLMClient, ScenarioBuilder) gives us a solid foundation. The architecture below builds on it.

---

## The Testing Pyramid

```
                    /\
                   /  \   Layer 4: Golden Flow Runs (real LLM, full pipeline)
                  /    \  Weekly/pre-release. $5-20 per run.
                 /------\
                /        \ Layer 3: Checkpoint Scenario Tests (real LLM, N turns from state)
               /          \ Daily/on prompt changes. $0.10-0.50 per test.
              /------------\
             /              \ Layer 2: Single-Turn Prompt Evals (real LLM, one call)
            /                \ On every prompt edit. $0.01-0.05 per test.
           /------------------\
          /                    \ Layer 1: Deterministic Code Tests (no LLM)
         /                      \ On every code change. Free.
        /------------------------\
       /                          \ Layer 0: Recorded Replay Tests (no LLM)
      /                            \ On every change. Free. Catch regressions.
     /------------------------------\
```

---

## Layer 0: Recorded Replay Tests

**Implementation:** `src/testing/ConversationRecorder.ts`, `src/testing/ReplayLLMClient.ts`
**Tests:** `tests/replay/`

Record real LLM conversations during golden runs, then replay them deterministically. Drift detection catches when code changes alter the messages sent to the LLM.

**Drift tolerance levels:** `strict` (byte-identical), `structural` (same tool calls/keys), `lenient` (same tool names in order)

## Layer 1: Deterministic Code Tests

**Tests:** `tests/core/`, `tests/unit/`, `tests/workflow/`, `tests/components/`

Includes prompt rendering tests at `tests/core/prompts/PromptRendering.test.ts`.

## Layer 2: Single-Turn Prompt Evals

**Implementation:** `src/testing/PromptEvaluator.ts`, `src/testing/ModelSelector.ts`
**Tests:** `tests/evals/`

Enhanced with model tiering (local LM Studio vs cloud API).

## Layer 3: Checkpoint Scenario Tests

**Implementation:** `src/testing/CheckpointManager.ts`, `src/testing/CheckpointScenarioRunner.ts`
**Tests:** `tests/scenarios/`

Save agent state at interesting points, resume from checkpoints with real LLM.

## Layer 4: Golden Flow Runs

**Tests:** `tests/golden/`
**Script:** `scripts/run-golden-flows.ts`

Full end-to-end with real LLM. Produces recordings and checkpoints for other layers.

---

## npm Scripts

| Script | Layer | LLM Required | Description |
|--------|-------|-------------|-------------|
| `pnpm test` | 0+1 | None | Free, fast, every change |
| `pnpm test:replay` | 0 | None | Replay regression tests |
| `pnpm test:evals` | 2 | None (mock) | Prompt eval tests |
| `pnpm test:evals:live` | 2 | LM Studio | Live prompt evals |
| `pnpm test:scenarios` | 3 | LM Studio | Checkpoint scenario tests |
| `pnpm test:golden` | 4 | LM Studio/Cloud | Full golden flow tests |
| `pnpm test:record` | - | LM Studio/Cloud | Record new golden flows |

## Prompt Change Detection

**Implementation:** `src/testing/PromptChangeDetector.ts`

Maps prompt files to affected tests. Use in CI to flag which tests need re-running with real LLM.

---

## Local-First Cost Model

| Layer | LLM Required | Cost | Frequency |
|-------|-------------|------|-----------|
| 0 (Replay) | None | Free | Every change |
| 1 (Deterministic) | None | Free | Every change |
| 2 (Evals) | LM Studio (local) | Free | Every prompt edit |
| 3 (Scenarios) | LM Studio (local) | Free | Daily / prompt changes |
| 4 (Golden) | LM Studio or Cloud | Free or ~$5-20 | Weekly / pre-release |

Daily development cost: **$0**.

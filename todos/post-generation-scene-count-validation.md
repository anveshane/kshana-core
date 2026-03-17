# Post-Generation Scene Count Validation

## What
Add a validator that checks whether `generate_content('scene')` output matches the
suggested scene count from `<duration_constraints>`, and flags/retries if wildly off.

## Why
Duration constraints are currently advisory — the LLM may ignore them. A 30-second
video requesting 3 scenes could get 10 scenes back, leading to either an overlong
video or awkward truncation. Validation before expensive image/video generation
would catch this early.

## Pros
- Catches over-scoped content before spending minutes on image/video generation
- Closes the loop on the "belt and suspenders" approach (prompt guidance + system
  injection + post-hoc validation)
- Could auto-retry with a stronger constraint message

## Cons
- Adds complexity: needs retry logic and a threshold for "close enough"
- May over-constrain creative output (e.g., 7 scenes for a 60s video is fine even
  if the hint said 6)
- Scene count is only meaningful for scene breakdown, not plot/story content types

## Context
The `computeSegmentBreakdown()` function in `src/utils/durationUtils.ts` provides
the expected segment count. After `generate_content` returns for scene-type content,
a validator could parse the output, count scenes, and compare against the breakdown.

Currently, the content creator prompt has a Duration-Aware Content Scoping table
in `prompts/subagents/content-creator.md` and gets `<duration_constraints>` injected
by `GenericAgent.ts`. These are the two existing layers. This TODO adds the third.

## Depends on
- Duration injection (done — `GenericAgent.ts:1828`)
- Content creator scoping guidance (done — `content-creator.md:94`)
- `computeSegmentBreakdown()` (done — `src/utils/durationUtils.ts`)

## When to build
When real-world usage shows the LLM consistently ignoring duration constraints.
Monitor plot/story outputs for a few runs first — the prompt guidance may be sufficient.

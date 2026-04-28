# Duration Extension with Shot Reuse — `pnpm extend`

## Problem

Today, changing a project's target duration means regenerating everything.
There's no way to take a completed 1-min video and ask "give me the
2-min version" or "give me the 5-min version" while preserving the work
that's already done. The user has to discard 24 already-generated shot
videos to rebudget the same story.

The user surfaced two real workflows that both need this primitive:

**Case A — same story, more breathing room** (the common case)

The 1-min squeeze chops too much detail; theme doesn't land. User wants
to retell the SAME story with 2 or 5 minutes — more atmospheric shots,
longer reaction holds, beats that were compressed-as-subtext at 1 min
become full shots at 2 min. Most existing shots stay; a handful may need
regen for continuity (a wide establishing that no longer fits the new
position). The expansion comes from inserting new shots between
existing ones, not from re-rendering the existing ones.

**Case B — same world, more story** (less common)

User has a 1-min video covering chapter 1. Now they paste chapter 2.
Existing 1-min stays exactly as-is; new scenes get appended. This is a
special case of A where the lock is total over existing material.

## Design

### Keystone: stable beat IDs

The duration-first extractor today emits positional IDs (`b1..bN`). Re-
extracting at a different target produces non-deterministic IDs — `b3`
in the new run is rarely the same beat as `b3` in the old. Without
identity continuity nothing else works.

Switch to **content-hashed beat IDs**:

```ts
function beatId(description: string, dialogue: string, setting: string, characters: string[]): string {
  const canonical = JSON.stringify({
    d: description.trim().toLowerCase(),
    s: dialogue.trim(),
    p: setting.trim().toLowerCase(),
    c: [...characters].sort().map(c => c.toLowerCase()),
  });
  return `b_${sha256(canonical).slice(0, 8)}`;
}
```

8 chars of SHA-256 = 32 bits = no collisions in practice for the ~50
beats per project. IDs become stable across re-extractions, surviving
LLM nondeterminism.

### Lock + extend in the extractor

`runDurationFirstExtraction` accepts new options:

```ts
runDurationFirstExtraction(story, target, llm, {
  lockedBeats?: Beat[];                  // preserve these verbatim
  appendSource?: string;                  // case B: additional source text
});
```

When `lockedBeats` is set, the extractor's Stage A and C prompts both
get the locked list and instructions:

> The following beats already exist in the prior version of this video.
> Reuse their IDs verbatim. You may add NEW beats (from material that
> was compressed in the prior pass), but every locked beat must appear
> in the output with its original ID.

Stage B (duration computation) is unchanged.

Stage D validation is extended:
- Every `lockedBeat.id` must appear in the output beat list. If missing
  → repair pass with explicit feedback ("you dropped these IDs: ...").
- New beats use fresh content-hashed IDs.

### Frozen artifact registry

Each `shot_video:scene_X_shot_Y` node currently keys by scene+shot
position. When the new graph rebuilds, those positions may shift.

Add a beat → artifact mapping persisted in `project.json`:

```json
"frozenArtifacts": {
  "b_3f8a92...": {
    "shotVideoPath": "assets/videos/shots/s1shot3_ltx23_AbCdEf.mp4",
    "shotImageFirstFramePath": "assets/images/s1shot3_first_frame_klein_XyZ.png",
    "shotImageLastFramePath": "assets/images/s1shot3_last_frame_klein_PqR.png",
    "frozenAt": 1777290000000
  },
}
```

When the executor builds a new graph node `shot_video:scene_X_shot_Y`
whose driving beat is `b_3f8a92...`, look up `frozenArtifacts[<id>]`,
mark the node `completed`, and point its `outputPath` at the existing
file. Same for `shot_image` upstream.

The reset command needs a new mode: `pnpm reset <project> <stage>
--preserve-frozen`. Default reset behavior stays as-is for non-extend
flows (you might WANT to blow it all away).

### Continuity validator

Per-locked-beat check: did the beat's narrative neighbors change?

```ts
interface ContinuityCheck {
  beatId: string;
  prevBeatBefore: string | null;   // what came before in the 1-min plan
  prevBeatAfter:  string | null;   // what came before in the 2-min plan
  nextBeatBefore: string | null;
  nextBeatAfter:  string | null;
  needsRereoll: boolean;            // true if either neighbor's ID changed
}
```

If a frozen shot's previous-or-next beat changed, mark it for re-roll
(unfreezes that one shot, keeps the rest).

User can override per-shot via `pnpm extend kareema --to 120
--keep <beatId>` or `--reroll <beatId>`.

### CLI: `pnpm extend`

```bash
pnpm extend <project> --to <sec>                    # case A: re-budget
pnpm extend <project> --to <sec> --append <file>    # case B: more story
pnpm extend <project> --dry-run                     # show diff, no exec
pnpm extend <project> --reroll <beatId> [...]       # force-unfreeze beats
pnpm extend <project> --keep <beatId> [...]         # override continuity flag
```

After computing the diff:

```
$ pnpm extend kareema --to 120 --dry-run
Extending kareema from 60s → 120s

Source beats:        38 (was: 38, no source change)
Beats kept locked:   24
Beats with new full-shot status: 8 (were embedded, now full)
Beats added:         3 (atmosphere/reaction inserted)
Continuity re-rolls: 2  (scene_2_shot_3, scene_3_shot_5 — neighbors shifted)
                       use --keep <id> to override

Total runtime: 60s → 119s (target 120s, +20s ceiling: 140s, OK)
Estimated work: regenerate 13 shots, preserve 11 shots
```

User confirms → execution proceeds.

## Effort

7 passes, ~3–4 days total.

| Pass | What | Effort |
|---|---|---|
| 1 | Content-hashed stable beat IDs | ~4h |
| 2 | `lockedBeats` mode in extractor + cluster | ~6h |
| 3 | Frozen artifact registry + `--preserve-frozen` reset | ~6h |
| 4 | Continuity validator + `--keep`/`--reroll` overrides | ~4h |
| 5 | `pnpm extend` CLI + dry-run diff display | ~6h |
| 6 | Append-source mode (Case B) | ~4h |
| 7 | Tests + edge cases | ~6h |

Smallest viable version (passes 1, 2, 3, 5 — skip continuity validator
and append-source initially): ~1.5 days. Gets 80% of the value; users
can manually `pnpm regen` any shot whose continuity feels off.

## Done when

- A 60s-completed project runs `pnpm extend <p> --to 120` and produces
  a 120s video that reuses ≥75% of the original shot videos verbatim.
- The reused shot videos are bit-identical to the 60s versions (same
  files, not regenerated).
- The diff output before execution clearly states what's preserved,
  what's regenerated, and what's added — user can intervene via flags.
- `pnpm extend <p> --to 300 --append chapter_2.md` produces a video
  with the original 60s + new chapter-2 content appended; original
  shots are bit-identical.

## Out of scope

- Time-budget *shrinkage* (5 min → 1 min). That's a different problem
  — you can't preserve shots when they need to disappear. Treat this
  as "regenerate from scratch" for now.
- Audio-track changes that don't affect video selection (e.g. swap
  music). Different feature.
- Editorial restructuring (re-order scenes, swap a character). The
  beat-ID is content-derived, so changing the content invalidates the
  match. That's correct behavior but not "extension".

## Open questions

- **Beat-ID granularity.** Hash `description + dialogue + setting +
  characters`. Is description enough to differentiate two reaction
  shots that are textually similar? Probably yes, but worth a calibration
  test.
- **What if the LLM's re-extraction at 2-min finds NEW source beats
  the 1-min squeeze had embedded?** That's expected and good — those
  are the new shots we want. The locked-beats list is a floor, not a
  ceiling.
- **Scene structure changes.** When extending 1-min (4 scenes) → 2-min,
  the LLM might prefer 6 scenes. Existing shots are keyed by scene+shot
  position; renaming scenes mid-flight is risky. Resolution: rename
  scenes is allowed but the beat-id → asset-path mapping is the source
  of truth, NOT the scene/shot positions. The mapping is stable; the
  graph node ids that reference it are recomputed each run.

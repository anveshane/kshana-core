# LLM-judge layer for motion-directive speaker disambiguation

## Status: PARKED (2026-04-24)

## Why

The current `scanAmbiguousSpeakerTag` regex in `src/core/planner/dialogueValidation.ts` catches the clearest violations:

- Bare pronouns (`She says`, `He says`)
- Bare class nouns (`The woman says`, `The man says`, `Woman says`)

But it is pattern-matching, not semantic. It cannot judge whether a descriptor is actually *unique* against the specific shot's character set. Real cases it misses:

- `"The woman at the dining table, lowering her gaze, says …"` — ambiguous ONLY if both women are at the table. If only Mrs. Singh is seated and Parvati is standing elsewhere, the tag is fine. Regex can't check that.
- `"The taller woman says …"` — disambiguating if and only if one is visibly taller.
- `"The woman in the red sari says …"` — fine if only one wears red; broken if both do.

Tightening the regex to catch these produces false positives on legitimate descriptors (`"A taller figure in shadow says …"`). Context-dependent ambiguity cannot be resolved by regex.

## The fix

Add a cheap LLM judge as a second layer. One call per `shot_motion_directive` at generation time:

**Prompt template (sketch):**

```
You are validating a video motion directive against its character cast.

Characters visible in this shot (refId : short visual description):
- parvati: 35-year-old woman in faded blue salwar kameez, graying bun in practical style
- mrs_singh: middle-aged woman in crisp white sari, seated at dining table

Motion directive:
"The woman at the dining table, lowering her gaze from the newspaper, says 'We shall see.'"

Question: Does the speaker tag in the `says` clause uniquely identify one of the listed characters? Answer YES or NO with a one-sentence reason.
```

Expected: `NO — "the woman at the dining table" could match either character if Parvati is near the table; descriptor isn't unique.`

## Implementation sketch

1. Add `utility.speaker_disambiguation` to `src/core/llm/purposes.ts` LIGHT_PURPOSES list.
2. Route it to the same cheap model tier as `utility.continuity_check` (the existing pattern).
3. In `ExecutorAgent.scanMotionDirectiveForAmbiguousSpeaker` (or a sibling), after the regex pass, if there are 2+ chars in the shot, fire the judge.
4. Judge output parsing: expect `{verdict: "YES"|"NO", reason: string}` JSON schema (use the existing `LLMClient.generateStructured` path if available, else strict parse).
5. Severity ladder:
   - Regex hit → log warning (current behavior)
   - Judge says NO → log warning AND inject a retry hint into the motion directive generation: "Your previous output used an ambiguous speaker tag — rewrite with a unique visual descriptor from `<character_tags>`."
   - Both hit → hard validation failure; force regenerate.

## Cost

- Project has ~22 shot_motion_directives per average project
- Judge call ~1–2s on a cheap model
- Total added: ~20–40s per full pipeline run. Acceptable.

## Tests

- Unit test the judge prompt against fixtures (different char lists, different motion directives) using a mocked LLMClient. No network.
- Integration: retroactive scan on `sun_hadnt_yet_cleared-2` motion directives — expect judge to flag the 3 shots the regex already catches, PLUS the context-dependent cases regex misses (if any exist in that project).

## Files to touch

- `src/core/planner/dialogueValidation.ts` — add async `judgeSpeakerDisambiguation(motionDirective, chars, llm): Promise<{valid, reason}>`
- `src/core/planner/ExecutorAgent.ts` — wire the judge in after regex scan
- `src/core/llm/purposes.ts` — new purpose tag
- `tests/unit/dialogueValidation.test.ts` — judge stub tests

## Signals to resume

- User reports dialogue mis-attribution on a newly generated project despite the regex+guide defenses
- OR: running retrospective audit shows a pattern of context-dependent ambiguity that the regex fundamentally can't catch

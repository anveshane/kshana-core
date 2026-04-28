# Autoresearch: Story Extraction (Characters, Settings, Scenes)

## Problem

The extraction LLM call in `src/core/planner/collectionExtractor.ts` (line 42-81) has never been evaluated or optimized. It's one of the most critical calls — wrong characters/settings here cascades to every downstream stage.

Known issues:
- Wrong character counts
- Missed settings
- Scene segmentation too coarse or too fine
- Character names not matching story text exactly

## What to Build

1. **Rubric** at `tests/autoresearch/rubrics/extraction-binary.json`:
   - Are all on-screen characters extracted?
   - Are character names exact matches from the story?
   - No duplicate/near-duplicate characters?
   - Are distinct locations extracted as separate settings?
   - No over-consolidated settings (combining different rooms)?
   - Are scenes logical narrative units?
   - Scene count appropriate for duration?
   - Scene summaries accurate?
   - Token efficient output?

2. **Eval script** at `scripts/eval-extraction.ts`:
   - Takes a project dir with completed story
   - Runs extraction with local LLM
   - Evaluates output with Claude CLI judge

3. **Autoresearch script** at `scripts/autoresearch-extraction.ts`:
   - Iterates: generate → eval → improve prompt → repeat

## Key File
- `src/core/planner/collectionExtractor.ts:42-81` — the extraction prompt

## Priority
High — extraction errors cascade to all downstream stages.

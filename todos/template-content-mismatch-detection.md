# Template-Content Mismatch Detection

## Problem
When a user selects a template (e.g., narrative cinematic) but provides content that fits a different template (e.g., documentary), the system has no guardrails. It silently forces the wrong pipeline onto the content, producing poor results.

## Current Gaps

| Layer | What Exists | What's Missing |
|-------|-------------|----------------|
| **Template Selection** | Pattern-based detection (length, keywords, structure) | No semantic understanding of content |
| **Orchestrator Prompt** | Template-specific workflow | No content validation against template |
| **Input Registration** | Manual artifact mapping | No verification that content matches artifact type |
| **Artifact System** | Validation schema with `customValidator` field | No validators implemented |
| **Content Generation** | Template-aware agents | No feedback loop to check if content fits template |
| **Backward Planning** | Dependency traversal | No check if target template matches input |

## What Goes Wrong
1. `detectTemplate()` uses shallow pattern matching — documentary content can match narrative patterns
2. If user explicitly selects narrative, there's zero validation
3. Backward plan is template-driven, not content-driven (forces `plot → story → characters → settings → scenes`)
4. Content-creator subagent forces narrative structure onto documentary material (invents characters, emotional arcs, dialogue)
5. Documentary's natural structure (thesis → outline → sources → segments) is lost entirely
6. No artifact validators catch the mismatch

## Potential Fixes
- [ ] **Detection**: Better semantic analysis in `detectTemplate()` to distinguish content types
- [ ] **Post-selection validation**: Check content against template expectations before creating the backward plan
- [ ] **Orchestrator awareness**: Add instructions to detect template/content mismatch and suggest switching or confirm with user
- [ ] **Artifact validators**: Implement the `customValidator` hooks that already exist in the schema

## Key Files
- `src/templates/index.ts` — `detectTemplate()` function
- `src/templates/narrative.ts` — narrative template definition & detection patterns
- `src/templates/documentary.ts` — documentary template definition
- `src/core/templates/types.ts` — `ArtifactValidation` schema with unused `customValidator`
- `src/core/planner/BackwardPlanner.ts` — backward plan generation
- `src/core/prompts/index.ts` — `buildContentPrompt()`, content-creator prompt assembly
- `prompts/templates/narrative/orchestrator.md` — narrative orchestrator prompt
- `prompts/templates/documentary/orchestrator.md` — documentary orchestrator prompt

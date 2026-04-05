# Refactor SOURCE_STRING Tests → Behavior Tests

## Problem

27 out of 686 tests (9.5%) grep for text patterns in source code files instead of testing actual behavior. These are fragile — they break on code reformatting, variable renaming, or comment changes without catching real bugs.

## Files to Refactor (27 tests)

### High Priority (100% source-string)
- **sidebarButtons.test.ts** (3 tests) → Use React Testing Library to render Sidebar with mock props, assert buttons appear/disappear
- **assetNodeIdFlow.test.ts** (3 tests) → Integration test: create mock API response → dispatch to store → verify asset has nodeId
- **resetFromUI.test.ts** (4 tests) → Keep script execution tests, remove source grep tests

### Medium Priority (75-86% source-string)
- **corruptPromptSelfHeal.test.ts** (6 tests) → Create a corrupt JSON file, call the actual executor method, verify it invalidates + regenerates
- **slimSceneBreakdown.test.ts** (6 tests) → Generate a scene breakdown via actual LLM/mock, validate the JSON structure

### Low Priority (25-67% source-string)
- **crossShotChaining.test.ts** (3 tests) → Already has 4 good behavior tests, remove the guide-grepping ones
- **vlmReview.test.ts** (2 tests) → Test the actual reviewImage method with a mock response
- **imageQualityGate.test.ts** (1 test) → Test the actual validation flow end-to-end
- **rejectImage.test.ts** (1 test) → Already has 3 good tests, remove the 1 grep test

## Approach

For each refactored test:
1. Delete the source-string test
2. Write a behavior test that exercises the same production code path
3. Assert on outputs/effects, not on code text

## Priority

Medium — the 256 good tests provide strong coverage. This is cleanup for maintainability.

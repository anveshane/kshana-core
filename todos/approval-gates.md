# Approval Gates — Structured Review Criteria for Artifact Quality

## Problem

The `onApprovalNeeded()` callback in the executor returns a boolean (proceed/skip) but provides no guidance on *what to evaluate*. When the Web UI asks for human approval on a generated character image or a screenplay, the user sees the raw output with no context about what quality dimensions matter. This leads to:

- Inconsistent approval standards across sessions
- Users approving low-quality outputs because they don't know what to look for
- No opportunity for automated self-review before human review

## Feature

Structured review criteria attached to each artifact type, displayed in the Web UI during approval, with an optional LLM self-review pass that can auto-regenerate before showing to the user.

## Review Criteria Structure

```typescript
interface ReviewCriterion {
  label: string;              // "Character Consistency"
  description: string;        // "Does the image match the character description? Check hair color, clothing, and distinguishing features."
  priority: 'must-pass' | 'should-pass' | 'nice-to-have';
}

interface ReviewConfig {
  criteria: ReviewCriterion[];
  selfReviewEnabled: boolean;       // LLM evaluates before showing to user
  autoApproveOnSelfReview: boolean; // If self-review passes all must-pass, skip human
  maxAutoRetries: number;           // How many times to auto-regenerate on self-review failure (default: 1)
}
```

## Per-Artifact Review Criteria

### Character Images
- **Character consistency** (must-pass): Matches description — hair, clothing, features
- **Visual quality** (must-pass): No artifacts, distortion, or extra limbs
- **Style alignment** (should-pass): Matches the project's visual style

### Setting Images
- **Scene accuracy** (must-pass): Matches the setting description — location, time of day, mood
- **Composition** (should-pass): Good framing, depth, visual interest
- **Style alignment** (should-pass): Consistent with other generated assets

### Screenplay / Script
- **Narrative coherence** (must-pass): Story flows logically, no contradictions
- **Dialogue quality** (should-pass): Natural-sounding, character-appropriate
- **Pacing** (should-pass): Scene lengths appropriate for target duration

### Shot Videos
- **Motion quality** (must-pass): No flickering, no frozen frames, smooth motion
- **Subject consistency** (must-pass): Subject matches the shot description
- **Temporal coherence** (should-pass): No sudden jumps or unnatural transitions

### Final Assembly
- **Audio sync** (must-pass): Narration/music aligns with visuals
- **Transition smoothness** (should-pass): No jarring cuts
- **Duration** (must-pass): Within target duration range

## Implementation Approach

### 1. Add ReviewConfig to ArtifactTypeDefinition

In `src/core/templates/types.ts`, add an optional `reviewConfig` field to `ArtifactTypeDefinition`:

```typescript
interface ArtifactTypeDefinition {
  // ... existing fields ...
  reviewConfig?: ReviewConfig;
}
```

Each template (narrative, documentary, etc.) defines review criteria per artifact type.

### 2. Display Criteria in Web UI

When the approval modal appears:
- Show the artifact output (image, text, video player)
- Show the review criteria as a checklist below the output
- Each criterion has a checkbox (pass/fail) and the description as helper text
- `must-pass` items are highlighted; all must be checked to proceed
- Users can add a note explaining why they rejected

### 3. LLM Self-Review Pass

Before presenting to the user (when `selfReviewEnabled: true`):
1. Build a self-review prompt from the criteria: "Evaluate this output against the following quality criteria..."
2. Send the artifact + criteria to the LLM
3. Parse the response for pass/fail per criterion
4. If any `must-pass` criterion fails and `maxAutoRetries > 0`:
   - Include the failure reason in the regeneration prompt
   - Re-execute the node
   - Decrement retry counter
5. If all `must-pass` pass and `autoApproveOnSelfReview` is true, skip human review
6. Otherwise, present to user with the self-review results pre-filled

### 4. Integration with Executor

In `ExecutorAgent.ts`, the node completion flow becomes:

```
Node executes → Output produced
  → If reviewConfig.selfReviewEnabled:
      → LLM self-review
      → If must-pass fails: auto-retry (up to maxAutoRetries)
      → If autoApproveOnSelfReview and all pass: mark complete
  → Else / if self-review defers to human:
      → onApprovalNeeded() with criteria + self-review results
      → User reviews with checklist
      → Approve → mark complete
      → Reject → re-execute with rejection notes in prompt
```

### 5. Connection to Eval Framework

The review criteria structure aligns with the existing eval rubrics in `tests/evals/`. The same criteria definitions could potentially be reused for automated quality evaluation in CI, creating a single source of truth for "what good looks like."

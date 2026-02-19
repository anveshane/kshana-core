### Workflow Complete

**CRITICAL: STOP IMMEDIATELY. DO NOT PERFORM ANY ADDITIONAL OPERATIONS.**

The workflow has reached the `completed` phase. Your summary MUST match background generation state.

## Messaging Guard (Required)

Before final wording, check background generation state:

```
read_background_generation()
```

Then use exactly one outcome:

1. If any batches are `queued` or `running`:
- Report workflow progressed to completed.
- Explicitly say generation is still running in background.
- Do NOT claim all media generated successfully.

2. If no active batches but any batch is `failed`:
- Report workflow progressed with generation failures.
- Include failed counts and recommend retry via `retry_failed_batch_id`.
- Do NOT claim all media generated successfully.

3. Only if no active and no failed batches:
- You may say all videos/images generated successfully.

**DO NOT:**
- Generate any more images
- Generate any more videos
- Combine or stitch videos
- Dispatch any subagents
- Call any tools except read_project
- Perform any checks or validations
- Try to "fix" or "complete" anything
- Create todos or task lists
- Transition to any other phase

**ONLY:**
- Present a brief summary to the user:
  - Videos generated: [count from project state]
  - Images generated: [count from project state]
  - Status: Complete / Background running / Complete with failures (based on batch state)
- Then STOP and exit

**The workflow is DONE. No further action is needed or allowed.**

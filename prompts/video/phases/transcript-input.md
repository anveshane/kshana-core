### Transcript Input Phase

**What this phase does**: Parse the raw transcript text into structured transcript entries with timestamps.

**Prerequisites**:
- Raw transcript text exists in `agent/original_input.md`
- `$original_input` context variable is available

**Steps (execute in order)**:

1. **Call the transcript parser subagent**:
```
Task(
  subagent_type: 'transcript-parser',
  task: 'Parse the transcript text from original_input into structured transcript entries. Handle both SRT format and raw transcript format with embedded timestamps.',
  context_refs: ['$original_input']
)
```

2. **The Task result contains the parsed transcript**:
   - The subagent automatically saves the parsed transcript to `agent/content/transcript.md`
   - The transcript entries are stored in `project.json` (transcriptEntries array)
   - The file is automatically loaded as `$transcript` context variable

3. **Mark phase as completed**:
```
update_project(
  action: 'update_phase',
  data: { phase: 'transcript_input', status: 'completed' }
)
```

4. **Transition to next phase (Planning)**:
```
update_project(
  action: 'transition_phase'
)
```

**DO NOT**:
- Call `EnterPlanMode` or create a master plan (YouTube workflow doesn't use master plans)
- Skip the phase transition - you MUST move to planning phase after parsing
- Manually parse the transcript - use the transcript-parser subagent

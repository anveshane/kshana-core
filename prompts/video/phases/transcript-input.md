### Transcript Input Phase

**IMPORTANT: This is the FIRST phase in the YouTube workflow. You MUST parse the transcript before proceeding to planning.**

Accept transcript text from the user (pasted directly in the initial prompt). Supports two formats:

**Format 1: SRT Format**
```
1
00:00:00,000 --> 00:00:03,000
Text content here
```

**Format 2: Raw Transcript Format**
```
3:53 of brown and tracing that led me to the 3:56 story
4:00 all of it confirmed one thing. Racism is 4:04 a hallucination
```

Steps (MUST be done in this order):
1. Read `agent/original_input.md` to access the raw transcript text.
2. The `parse_srt` tool automatically detects and handles both formats.
3. **FIRST**: Call the transcript parser subagent to parse the transcript:
```
Task(
  subagent_type: 'transcript-parser',
  task: 'Parse transcript text from original_input into transcript entries (handles both SRT and raw transcript formats)',
  context_refs: ['$original_input']
)
```
4. The transcript parser will use `parse_srt` tool which handles format detection automatically.
5. Store parsed transcript entries in `project.json`, write `agent/content/transcript.md`, and store in the context store as `$transcript`.
6. **CRITICAL: After transcript parsing completes, IMMEDIATELY transition to Planning phase:**
```
update_project(
  action: 'update_planner_stage',
  data: { phase: 'transcript_input', stage: 'complete' }
)
update_project(
  action: 'transition_phase',
  data: { next_phase: 'planning' }
)
```

**DO NOT:**
- Upload files. Work only with pasted text input.
- Create or request a master plan for YouTube workflow.
- Skip the phase transition - you MUST move to planning phase after parsing.

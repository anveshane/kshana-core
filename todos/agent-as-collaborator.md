# Agent as Collaborator, Not Just Executor

## Problem
The agent is purely an executor — it generates content, images, and video but cannot answer questions about the project. If a user asks "what's the motivation of my protagonist?" or "does scene 3 make sense given the earlier plot?", the orchestrator prompt tells it to decline and redirect to a generation task.

This makes the agent feel like a glorified n8n workflow rather than a creative partner. The agent has all the context it needs (project files, conversation history, story content) but the prompt frames it as a doer with blinders on.

## Current Constraints
1. **Scope restriction** (orchestrator.md lines 153-157): Explicitly tells the agent to decline "general knowledge questions unrelated to the current project"
2. **No-stop-without-tool-call rule** (line 178): "Never stop without a tool call when the workflow is incomplete" — prevents the agent from just talking
3. **No conversational mode**: The agent has no concept of "the user wants to discuss, not generate"

## What Users Would Want
- "Why did you make Alice a detective?" — reasoning about creative choices
- "Does scene 3 make sense given the earlier plot?" — story coherence analysis
- "What if we changed the setting to space?" — exploratory brainstorming
- "Summarize what we have so far" — project state awareness
- "What's the tone of the story right now?" — content analysis

## Potential Fixes
- [ ] **Soften scope restriction**: Allow project-related questions (story, characters, creative decisions) while still declining off-topic requests (coding, general knowledge)
- [ ] **Add conversational mode detection**: Recognize when the user is asking vs requesting generation — respond with text instead of tool calls
- [ ] **Relax the no-stop-without-tool-call rule**: Allow plain text responses when the user is in a conversational turn, not a generation workflow
- [ ] **Project-aware Q&A**: The agent already has `read_file` and project context — just needs permission to use them for answering instead of only for generating

## Key Files
- `prompts/system/orchestrator.md` — scope restrictions and behavioral rules (lines 144-163, 178)
- `src/core/agent/GenericAgent.ts` — main agent loop
- `src/core/tools/builtin/contextTools.ts` — read_project, read_file tools already exist

## Why This Matters
This is the key differentiator from a workflow engine. n8n can execute a predefined pipeline. What n8n can't do is reason about the content, discuss creative choices, and adapt based on conversation. Enabling this turns the agent from an executor into a collaborator.

## Proposed Approach: Dual Chat Modes (Collaborator / Executor)

Inspired by Claude Code's plan vs act modes. Instead of rewriting the agent, introduce a mode flag that changes what the agent can do.

**Executor mode** (current behavior):
- Full tool set: generate_content, generate_image, generate_video, timeline management, etc.
- Agent drives forward through the workflow pipeline
- Current orchestrator prompt and behavioral rules apply

**Collaborator mode**:
- Read-only tools only: read_project, read_file, list_project_files, scan_assets
- No generation tools available — the agent cannot create or modify artifacts
- Different system prompt section: encourages reasoning, discussion, story analysis, brainstorming
- Agent responds with text, not tool calls — relaxed "no-stop-without-tool-call" rule
- When user says "ok do it" or similar, switch to executor mode

**Implementation:**
- [ ] Add a `mode: 'collaborator' | 'executor'` flag to the agent
- [ ] Swap available tool set based on mode
- [ ] Add a collaborator-specific section to the orchestrator prompt (or swap prompt entirely)
- [ ] Relax the no-stop-without-tool-call rule in collaborator mode
- [ ] Add mode toggle mechanism — user command, UI button, or agent auto-detects intent
- [ ] Consider: should the agent be able to suggest switching modes? ("I think you want me to generate this — switch to executor mode?")

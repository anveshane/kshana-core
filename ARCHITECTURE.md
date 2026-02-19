# Kshana Video Workflow Architecture

## Overview

The video workflow uses a **two-layer architecture**:
1. **Phases** - High-level workflow steps with instructions
2. **Subagents** - Specialized agents for specific tasks

## 1. Video Phases (`prompts/video/phases/*.md`)

**Purpose**: Phase-specific instructions that guide the main orchestrator agent

**How it works**:
- Each phase has a markdown file (e.g., `planning.md`, `image-placement.md`)
- These files are loaded dynamically based on `currentPhase` in the project
- They get injected into the main workflow prompt via `buildWorkflowAgentPrompt()`
- The main agent reads these instructions and follows them

**Example Flow**:
```
transcript_input → planning → image_placement → image_generation → video_replacement → video_combine
```

**Key Files**:
- `transcript-input.md` - Instructions for parsing transcript
- `planning.md` - Instructions for creating content plan
- `image-placement.md` - Instructions for creating image placements
- etc.

## 2. Subagents (`prompts/subagents/*.md`)

**Purpose**: Specialized agents that perform specific tasks

**How it works**:
- Subagents are called via the `Task` tool: `Task(subagent_type: 'placement-planner', ...)`
- Each subagent has its own prompt file (e.g., `content-planner.md`)
- They run as "one-shot" agents that generate output and return it
- The main agent receives the result and must save it manually

**Subagent Types**:
- `transcript-parser` - Parses SRT/transcript text
- `placement-planner` - Creates content plan for visual placements
- `image-placer` - Creates detailed image placements
- `image-generator` - Generates images
- `video-replacer` - Replaces video segments

**Result Structure**:
When a subagent completes, it returns:
```javascript
{
  status: 'completed',
  output: '<the actual text output>',  // ← This is what you need to save
  task: '<original task>',
  iterations: 1
}
```

## 3. Why Duplicate Content?

**The Problem**:
1. Subagent returns output in `result.output`
2. Phase instructions tell agent to save it
3. Agent might save it multiple times if:
   - Instructions are unclear about where content is
   - Agent saves it after Task, then saves again
   - Context store also stores it automatically

**The Solution**:
- Clear instructions: Extract `result.output` and save ONCE
- Check if file exists before saving (optional)
- Don't save the entire result object - only the `output` field

## 4. File Flow

```
User Input (transcript)
  ↓
TRANSCRIPT_INPUT phase
  → Calls transcript-parser subagent
  → Saves to agent/content/transcript.md
  → Loads as $transcript context
  ↓
PLANNING phase
  → Calls placement-planner subagent
  → Returns result.output (content plan text)
  → Agent saves to agent/plans/content-plan.md
  → Loads as $content_plan context
  ↓
IMAGE_PLACEMENT phase
  → Calls image-placer subagent
  → Saves to agent/content/image-placements.md
  → Loads as $image_placements context
  ↓
... (continues)
```

## 5. Key Points

- **Phases** = "What to do" (instructions)
- **Subagents** = "How to do it" (specialized tasks)
- **Subagents return text** - main agent must save it
- **Result is in `result.output`** - not `result.content` or `result.plan`
- **Save once** - check before saving to avoid duplicates


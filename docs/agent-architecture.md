# Kshana Agent Architecture

## Overview

All agents in Kshana are instances of `GenericAgent`. They are personalized through:
1. **Task** - Specific work to perform
2. **Custom Prompt** - Domain-specific instructions
3. **Tools** - Available capabilities

## Agent Personalization Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        GenericAgent                             │
│                                                                 │
│  ┌─────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │    Task     │  │  Custom Prompt   │  │      Tools       │   │
│  │             │  │                  │  │                  │   │
│  │ "Analyze    │  │ VIDEO_CREATION_  │  │ generate_content │   │
│  │  story and  │  │ SYSTEM_PROMPT    │  │ read_file        │   │
│  │  plan..."   │  │                  │  │ Task (delegate)  │   │
│  └─────────────┘  └──────────────────┘  └──────────────────┘   │
│                                                                 │
│  Combined into system message:                                  │
│  base.md + orchestrator.md + env.md + <custom_instructions>     │
└─────────────────────────────────────────────────────────────────┘
```

## Main Orchestrator

**Purpose:** Assist user in creating and refining video content (images, motion graphics, story, plot, research, etc.)

**Personalization:**
- `customPrompt`: VIDEO_CREATION_SYSTEM_PROMPT (loaded from `prompts/video/main.md`)
- `tools`: Full tool registry including `Task` for delegation

**Task:** Implicit in `customPrompt` - coordinate video creation workflow

## Sub-agent Types

All sub-agents are GenericAgent instances. They differ by:
- System prompt (built via `build*Prompt()` functions)
- Tool subset (no delegation tools)
- Task parameter (passed at dispatch time)

### Plan Sub-agent

**Purpose:** Read-only analysis and execution planning

**Task flow:**
```typescript
buildPlanningPrompt(
  task: "Analyze the project and design an execution plan for character creation",
  context: "Story content..."
)
```

**Tools:** read_file, read_project (read-only)

**Personalization:** `prompts/subagents/plan.md`

### Explore Sub-agent

**Purpose:** Read-only exploration and summarization

**Task flow:**
```typescript
buildExplorePrompt(
  task: "Summarize existing characters and settings"
)
```

**Tools:** read_file, read_project (read-only)

**Personalization:** `prompts/subagents/explore.md`

### content-creator Sub-agent

**Purpose:** Generate creative content (plot, story, characters, settings, scenes)

**Task flow:**
```typescript
buildContentPrompt(
  task: "Create a detailed character profile for Keerti",
  contentType: "character",
  context: "Story content with character description..."
)
```

**Tools:** generate_content, read_file, read_project

**Personalization:** `prompts/subagents/content-creator.md`

**Context auto-injection:** Based on content_type
- plot → $original_input
- story → $original_input, $plot
- character → $original_input, $plot, $story
- setting → $original_input, $plot, $story
- scene → $story, $characters, $settings

### image-generator Sub-agent

**Purpose:** Craft image prompts and generate images

**Task flow:**
```typescript
buildImageGenerationPrompt(
  task: "Generate a reference image for character Keerti",
  context: "Character description..."
)
```

**Tools:** generate_image, edit_image, wait_for_job, read_file

**Personalization:** `prompts/subagents/image-generator.md`

### video-assembler Sub-agent

**Purpose:** Create video clips and stitch final video

**Task flow:**
```typescript
buildVideoGenerationPrompt({
  task: "Generate video clip for Scene 1",
  sceneNumber: 1,
  sceneImageArtifactId: "artifact-123",
  motionDescription: "subtle camera pan",
  context: "Scene description..."
})
```

**Tools:** generate_video, stitch_videos, wait_for_job, read_file

**Personalization:** `prompts/subagents/video-assembler.md`

## Tool Availability Matrix

| Tool | Orchestrator | Plan | Explore | content-creator | image-generator | video-assembler |
|------|:------------:|:----:|:-------:|:---------------:|:---------------:|:---------------:|
| **Core** |
| think | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| AskUserQuestion | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| TodoWrite | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Delegation** |
| Task | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| EnterPlanMode | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| ExitPlanMode | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Content** |
| generate_content | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| **Files** |
| read_file | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| write_file | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| read_project | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| update_project | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| **Generation** |
| generate_image | ✓* | ✗ | ✗ | ✗ | ✓ | ✓ |
| generate_video | ✓* | ✗ | ✗ | ✗ | ✗ | ✓ |
| stitch_videos | ✓* | ✗ | ✗ | ✗ | ✗ | ✓ |
| wait_for_job | ✓* | ✗ | ✗ | ✗ | ✓ | ✓ |

*Video orchestrator only

## Key Principle: Sub-agents Are Restricted Orchestrators

Sub-agents are NOT different classes. They are the SAME GenericAgent with:
1. **Restricted tools** - Cannot delegate to other sub-agents
2. **Specialized prompt** - Role-specific instructions via `build*Prompt()`
3. **Task injection** - Specific work passed in `<task>` XML tag
4. **Context injection** - Relevant content passed in `<context>` XML tag

This ensures consistency while preventing infinite delegation loops.

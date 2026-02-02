Launch a specialized subagent to handle a specific task.

## Available Subagent Types

### Core Subagents

| Type | Purpose |
|------|---------|
| `Plan` | Read-only planning specialist. Analyzes project state and designs execution plans. |
| `Explore` | Read-only explorer. Reads documentation, project files, and summarizes content. |
| `content-creator` | Creative content generator. Creates plot, story, characters, settings, scenes, narration. |
| `image-generator` | Image generation specialist. Crafts prompts and generates images. |
| `video-assembler` | Video generation specialist. Creates video clips and stitches them together. |

### Skill Subagents

| Type | Purpose |
|------|---------|
| `content-writing` | Specialized writing for narrative content |
| `image-prompting` | Creates optimized prompts for image generation |
| `video-direction` | Creates motion descriptions for video generation |
| `research-synthesis` | Research and information synthesis |
| `narration-scripting` | Voice-over script creation |

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `subagent_type` | Yes | Which subagent to use (see above) |
| `task` | Yes | Detailed task description |
| `content_type` | No | For content-creator: plot, story, character, setting, scene, narration |
| `output_file` | No | File path to save output |

## Context Handling

Subagents use `read_project()` and `read_file()` to discover and fetch context from project files.

## Examples

```
// Explore documentation for workflow guidance
Task(
  subagent_type: "Explore",
  task: "What workflow applies for narrative video creation?"
)

// Read and summarize existing content
Task(
  subagent_type: "Explore",
  task: "Read plans/story.md and summarize the main characters"
)

// Generate a character profile
Task(
  subagent_type: "content-creator",
  content_type: "character",
  task: "Create a detailed profile for Alice the protagonist"
)
```

## Note

For content generation, prefer using `generate_content` tool directly - it's simpler:

```
generate_content(
  content_type: "character",
  name: "Alice",
  instruction: "Create Alice's character profile"
)
```

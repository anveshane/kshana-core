Launch a specialized subagent to handle a specific task.

## Available Subagent Types

- **Plan**: Read-only planning specialist. Analyzes project state and designs execution plans. Does NOT generate content.
- **Explore**: Read-only project explorer. Reads and summarizes existing project content.
- **content-creator**: Creative content generator. Creates plot, story, characters, settings, scenes, narration.
- **image-generator**: Image generation specialist. Crafts prompts and generates images.
- **video-assembler**: Video generation specialist. Creates video clips and stitches them together.

## Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| subagent_type | Yes | Which subagent to use |
| task | Yes | Detailed task description |
| content_type | No | For content-creator: plot, story, character, setting, scene, narration |
| output_file | No | File path to save output |

## Context Handling

The framework automatically injects context based on content_type:
- **plot**: Gets original user input
- **story**: Gets original input + plot
- **character/setting**: Gets original input + plot + story
- **scene**: Gets story + characters + settings

Subagents can also use `read_project()` and `read_file()` to discover context.

## Content Types (for content-creator)

- **plot**: High-level story outline
- **story**: Full narrative with dialogue
- **character**: Character profile (appearance, personality, background)
- **setting**: Location description (visual details, atmosphere)
- **scene**: Visual scene description for video
- **narration**: Voice-over text

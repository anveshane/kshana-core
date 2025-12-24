Launch a specialized subagent to handle a specific task in the story-to-video pipeline.

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
| context_refs | No | Array of context variable names (e.g., ["$story", "$character_daniel"]) |
| content_type | No | For content-creator: plot, story, character, setting, scene, narration |
| output_file | No | File path to save output |

## Context Passing

Use `context_refs` to pass stored content to the subagent:

1. First, store the content using `store_context`:
   ```
   store_context(content: "...", label: "Daniel character profile")
   // Returns: { context_ref: "$character_profile" }
   ```

2. Then pass it to Task:
   ```
   Task(
     subagent_type: 'image-generator',
     task: 'Generate character reference image',
     context_refs: ['$character_profile']
   )
   ```

The subagent receives the full content of each referenced variable.

## Content Types (for content-creator)

- **plot**: High-level story outline
- **story**: Full narrative with dialogue
- **character**: Character profile (appearance, personality, background)
- **setting**: Location description (visual details, atmosphere)
- **scene**: Visual scene description for video
- **narration**: Voice-over text

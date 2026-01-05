Launch a specialized subagent to handle a specific task in the story-to-video pipeline.

## Available Subagent Types

- **Plan**: **ONLY for initial project planning (EnterPlanMode).** Read-only planning specialist. Analyzes project state and designs execution plans. Does NOT generate content. **DO NOT use for phase-level planning - use generate_content instead.**
- **Explore**: Read-only project explorer. Reads and summarizes existing project content.
- **content-creator**: Creative content generator. Creates plot, story, characters, settings, scenes, narration.
- **image-generator**: Image generation specialist. Crafts prompts and generates images.
- **video-assembler**: Video generation specialist. Creates video clips and stitches them together.
- **transcript-parser**: Parse SRT text and extract structured transcript data.
- **placement-planner**: Analyze transcript and plan comprehensive visual placements (images, infographics, video).
- **image-placer**: Create detailed placement plan with timestamps and enhanced prompts.
- **video-replacer**: Handle video segment replacement with images.

**IMPORTANT: After Task completes and user approves:**
- If using Plan subagent: Call `ExitPlanMode` after approval (only for initial project setup)
- If using content-creator: IMMEDIATELY call `update_project` to update planner stage and transition phase
- DO NOT enter feedback loops after approval

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

**YouTube Workflow (Preferred):**
- **transcript_analysis**: Analyze transcript structure and visual opportunities
- **image_placement_plan**: Plan image placements with timestamps
- **image_prompt**: Documentary-style image prompt for a segment

**Legacy Story Workflow (Supported):**
- **plot**: High-level story outline
- **story**: Full narrative with dialogue
- **character**: Character profile (appearance, personality, background)
- **setting**: Location description (visual details, atmosphere)
- **scene**: Visual scene description for video
- **narration**: Voice-over text

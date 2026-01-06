/**
 * Task tool - launches specialized subagents.
 * Handled specially by GenericAgent (no handler here).
 */
import { createTool } from '../ToolRegistry.js';

export const taskTool = createTool(
  'Task',
  `Launch a specialized subagent to handle a specific task in the story-to-video pipeline.

IMPORTANT: Tasks run SYNCHRONOUSLY and return results directly. Do NOT use TaskOutput - results come back immediately from this tool call.

IMPORTANT: Only ONE task of each type can run at a time. Wait for the current task to complete before starting another of the same type.

Available subagent types:
- Plan: Read-only planning specialist. Analyzes project state and designs execution plans. Does NOT generate content.
- Explore: Read-only project explorer. Reads and summarizes existing project content (characters, settings, scenes).
- content-creator: Creative content generator. Creates plot, story, characters, settings, scenes, narration. Iterates with user until approved.
- image-generator: Image generation specialist. Crafts prompts and generates images for characters, settings, and scenes.
- video-assembler: Video generation specialist. Creates video clips from scene images and stitches them into final video.
- transcript-parser: Parses SRT text input into structured transcript entries.
- content-planner: Analyzes transcript and plans comprehensive visual placements (images, infographics, video).
- image-placer: Creates detailed placement plan with timestamps and enhanced prompts.
- video-replacer: Coordinates video segment replacement with images.

⚠️ CRITICAL - Context Passing for content-creator:
- YOU MUST ALWAYS PASS context_refs when using content-creator!
- Without context_refs, the subagent has NO ACCESS to the user's story and will generate random content!
- For plot phase: context_refs: ["$original_input"]
  - NOTE: $original_input is automatically loaded from agent/original_input.md when the project is created
  - Do NOT use $user_input - that variable doesn't exist. Always use $original_input.
- For other phases: include relevant contexts like ["$plot", "$story", "$character_name"]
- The subagent receives ONLY what you pass in context_refs - nothing else!

Content Type (for content-creator):
- plot: High-level story outline (REQUIRES context_refs: ["$original_input"])
- story: Full narrative with dialogue (REQUIRES context_refs: ["$plot"])
- character: Character profile (REQUIRES context_refs: ["$story"])
- setting: Location description (REQUIRES context_refs: ["$story"])
- scene: Visual scene description (REQUIRES context_refs: ["$story", "$characters"])
- narration: Voice-over text`,
  {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        description: 'Which subagent to use: "Plan", "Explore", "content-creator", "image-generator", "video-assembler", "transcript-parser", "content-planner", "image-placer", "video-replacer"',
      },
      task: {
        type: 'string',
        description: 'Detailed task description for the subagent',
      },
      context_refs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of context variable names to pass to the subagent (e.g., ["$story", "$character_daniel"])',
      },
      content_type: {
        type: 'string',
        description: 'For content-creator: type of content to generate (plot, story, character, setting, scene, narration)',
      },
      output_file: {
        type: 'string',
        description: 'Optional file path to save the output (e.g., "script/story.md" for content or "plans/story-plan.md" for plans)',
      },
    },
    required: ['subagent_type', 'task'],
  }
  // No handler - handled by GenericAgent
);

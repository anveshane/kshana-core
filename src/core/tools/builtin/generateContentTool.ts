/**
 * generate_content tool - Simplified content generation with instruction-based approach.
 *
 * This tool delegates to the content creator subagent with:
 * 1. An instruction describing what to create
 * 2. A content_type for determining output file path and persistence
 *
 * The content creator fetches its own context via read_project().
 */
import { createTool } from '../ToolRegistry.js';

/**
 * Default output files for each content type.
 *
 * Naming conventions:
 * - Character profiles: {name}.profile.md
 * - Setting profiles: {name}.profile.md
 * - Image prompts: {name}.prompt.md or scene-{n}.prompt.md
 * - Video prompts: scene-{n}.motion.json
 * - Story chapters: chapter-{n}.story.md
 */
export const CONTENT_TYPE_OUTPUT_FILES: Record<string, string> = {
  // Content creation phases
  plot: 'plans/plot.md',
  story: 'plans/chapters/',        // Will be appended with chapter number
  character: 'characters/',        // Will be appended with {name}.profile.md
  setting: 'settings/',            // Will be appended with {name}.profile.md
  scene: 'plans/scenes/',              // Will be appended with scene-{n}.md
  narration: 'plans/narration.md',

  // Image prompt generation - saved to prompts directory for review/refinement
  character_image_prompt: 'prompts/images/characters/',  // Will be appended with {name}.prompt.md
  setting_image_prompt: 'prompts/images/settings/',      // Will be appended with {name}.prompt.md
  scene_image_prompt: 'prompts/images/scenes/',          // Will be appended with scene-{n}.prompt.md

  // Video prompt generation - saved to prompts directory for review/refinement
  scene_video_prompt: 'prompts/videos/scenes/',          // Will be appended with scene-{n}.motion.json

  // Per-shot image prompts - saved alongside scene prompts
  shot_image_prompt: 'prompts/images/shots/',             // Will be appended with scene-{n}-shot-{m}.prompt.md
};

export const generateContentTool = createTool(
  'generate_content',
  `Generate creative content by delegating to the content creator subagent.

The content creator will:
1. Query the project structure via read_project()
2. Fetch relevant context (story, characters, etc.)
3. Generate content based on your instruction
4. Present it for user approval
5. Save to the appropriate file

## Parameters

- **content_type** (required): Type of content - determines output file path
- **instruction** (required): Clear description of what to create
- **name**: For character/setting - the name (required for these types)
- **output_file**: Optional explicit relative path to save the generated content

## Content Types

| Type | Output Location |
|------|----------------|
| plot | plans/plot.md |
| story | plans/chapters/chapter-{n}.story.md |
| character | characters/{name}.profile.md |
| setting | settings/{name}.profile.md |
| scene | plans/scenes/scene-{n}.md |
| narration | plans/narration.md |
| character_image_prompt | prompts/images/characters/{name}.prompt.md |
| setting_image_prompt | prompts/images/settings/{name}.prompt.md |
| scene_image_prompt | prompts/images/scenes/scene-{n}.prompt.md |
| scene_video_prompt | prompts/videos/scenes/scene-{n}.motion.json |
| shot_image_prompt | prompts/images/shots/scene-{n}-shot-{m}.prompt.md |

## Examples

\`\`\`javascript
// Create a plot
generate_content(
  content_type: "plot",
  instruction: "Create a plot outline based on the user's story concept about a detective solving a mystery."
)

// Create a character profile
generate_content(
  content_type: "character",
  name: "Alice",
  instruction: "Create a detailed character profile for Alice, the protagonist detective. Include physical appearance, personality, and visual keywords."
)

// Create a setting
generate_content(
  content_type: "setting",
  name: "Ancient Library",
  instruction: "Create a setting description for the Ancient Library where the mystery unfolds. Include atmosphere, lighting, and visual details."
)

// Create a scene
generate_content(
  content_type: "scene",
  name: "Scene 3: The Revelation",
  instruction: "Create scene 3 where Alice discovers the hidden clue in the library. Include characters present, actions, and camera suggestions."
)

// Create a scene outline in a custom file
generate_content(
  content_type: "scene",
  instruction: "Create a scene outline based on the story and save it to plans/scenes-outline.md.",
  output_file: "plans/scenes-outline.md"
)
\`\`\``,
  {
    type: 'object',
    properties: {
      content_type: {
        type: 'string',
        enum: [
          'plot', 'story', 'character', 'setting', 'scene', 'narration',
          'character_image_prompt', 'setting_image_prompt', 'scene_image_prompt',
          'scene_video_prompt',
          'shot_image_prompt'
        ],
        description: 'Type of content to generate - determines output file path',
      },
      instruction: {
        type: 'string',
        description: 'Clear instruction for the content creator describing what to generate. Be specific about the content requirements.',
      },
      name: {
        type: 'string',
        description: 'For character/setting/character_image_prompt/setting_image_prompt: the name (REQUIRED for these types). For scenes: optional scene title.',
      },
      scene_number: {
        type: 'number',
        description: 'For scene_image_prompt/scene_video_prompt/shot_image_prompt: the scene number to generate a prompt for',
      },
      shot_number: {
        type: 'number',
        description: 'For shot_image_prompt: the shot number within the scene (required for shot_image_prompt)',
      },
      chapter_number: {
        type: 'number',
        description: 'For story content: the chapter number (default: 1)',
      },
      output_file: {
        type: 'string',
        description:
          'Optional relative output path inside the project. Use this when the content should be saved to a specific file such as plans/scenes-outline.md.',
      },
      overwrite: {
        type: 'boolean',
        description: 'If true, regenerate even if the content file already exists. Default: false (returns existing content if found).',
      },
    },
    required: ['content_type', 'instruction'],
  }
  // No handler - handled by GenericAgent
);

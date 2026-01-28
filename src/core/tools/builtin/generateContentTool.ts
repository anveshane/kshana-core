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
 */
export const CONTENT_TYPE_OUTPUT_FILES: Record<string, string> = {
  // Content creation phases
  plot: 'plans/plot.md',
  story: 'plans/story.md',
  character: 'characters/',  // Will be appended with character name
  setting: 'settings/',      // Will be appended with setting name
  scene: 'plans/scenes.md',
  narration: 'plans/narration.md',

  // Image prompt generation - not saved to files
  character_image_prompt: '',
  setting_image_prompt: '',
  scene_image_prompt: '',
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

## Content Types

| Type | Output Location |
|------|----------------|
| plot | plans/plot.md |
| story | plans/story.md |
| character | characters/{name}.md |
| setting | settings/{name}.md |
| scene | plans/scenes.md |
| narration | plans/narration.md |

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
\`\`\``,
  {
    type: 'object',
    properties: {
      content_type: {
        type: 'string',
        enum: [
          'plot', 'story', 'character', 'setting', 'scene', 'narration',
          'character_image_prompt', 'setting_image_prompt', 'scene_image_prompt'
        ],
        description: 'Type of content to generate - determines output file path',
      },
      instruction: {
        type: 'string',
        description: 'Clear instruction for the content creator describing what to generate. Be specific about the content requirements.',
      },
      name: {
        type: 'string',
        description: 'For character/setting: the name (REQUIRED for these types). For scenes: optional scene title.',
      },
      scene_number: {
        type: 'number',
        description: 'For scene_image_prompt: the scene number to generate an image prompt for',
      },
    },
    required: ['content_type', 'instruction'],
  }
  // No handler - handled by GenericAgent
);

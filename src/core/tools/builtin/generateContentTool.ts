/**
 * generate_content tool - Deterministic content generation with automatic context injection.
 *
 * This is the PRIMARY tool for content generation. It automatically:
 * 1. Determines what context is needed based on content_type
 * 2. Fetches and injects that context into the subagent prompt
 * 3. Saves approved content to the appropriate file
 * 4. Updates the project registry automatically
 */
import { createTool } from '../ToolRegistry.js';

/**
 * Defines which contexts are required for each content type.
 * The framework automatically fetches these from the context store.
 */
export const CONTENT_TYPE_CONTEXTS: Record<string, string[]> = {
  // Content creation phases
  plot: ['$original_input'],
  story: ['$original_input', '$plot'],
  character: ['$original_input', '$plot', '$story'],
  setting: ['$original_input', '$plot', '$story'],
  scene: ['$original_input', '$story', '$characters', '$settings'],
  narration: ['$story', '$scenes'],

  // Image prompt generation phases
  character_image_prompt: ['$project_style'],
  setting_image_prompt: ['$project_style'],
  scene_image_prompt: ['$project_style'],
};

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
  `Generate creative content with automatic context injection and persistence.

This is the PREFERRED tool for content generation. You don't need to:
- Pass context_refs manually (auto-injected based on content_type)
- Call update_project after approval (registry is auto-updated)
- Specify output_file (auto-determined from content_type)

## Content Types

| Type | Auto-Injected Context | Output |
|------|----------------------|--------|
| plot | $original_input | plans/plot.md |
| story | $original_input, $plot | plans/story.md |
| character | $original_input, $plot, $story | characters/{name}.md |
| setting | $original_input, $plot, $story | settings/{name}.md |
| scene | $story, $characters, $settings | plans/scenes.md |
| narration | $story, $scenes | plans/narration.md |

## Image Prompt Types

| Type | Description |
|------|-------------|
| character_image_prompt | Generate image prompt for a character |
| setting_image_prompt | Generate image prompt for a setting |
| scene_image_prompt | Generate image prompt for a scene |

## Examples

\`\`\`javascript
// Create plot from user input
generate_content(content_type: "plot")

// Create character profile - name required
generate_content(content_type: "character", name: "Alice")

// Create setting - name required
generate_content(content_type: "setting", name: "Ancient Library")

// Create scene with custom task
generate_content(content_type: "scene", task_description: "Create scene 3: The Confrontation")
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
        description: 'Type of content to generate',
      },
      name: {
        type: 'string',
        description: 'For character/setting: the name (REQUIRED). For scenes: optional scene title.',
      },
      scene_number: {
        type: 'number',
        description: 'For scene_image_prompt: the scene number to generate an image prompt for',
      },
      task_description: {
        type: 'string',
        description: 'Optional additional instructions for the content generator',
      },
    },
    required: ['content_type'],
  }
  // No handler - handled by GenericAgent
);

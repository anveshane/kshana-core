/**
 * generate_content tool - Deterministic content generation with automatic context injection.
 *
 * Instead of requiring the LLM to pass context_refs, this tool automatically
 * determines what context is needed based on content_type and fetches it.
 */
import { createTool } from '../ToolRegistry.js';

/**
 * Defines which contexts are required for each content type.
 * The tool will automatically fetch these from the context store.
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
  // These generate detailed prompts that are then fed to image generators
  character_image_prompt: ['$project_style'],  // + character description from read_project
  setting_image_prompt: ['$project_style'],    // + setting description from read_project
  scene_image_prompt: ['$project_style'],      // + scene description + character/setting refs from read_project
};

/**
 * Default output files for each content type.
 */
export const CONTENT_TYPE_OUTPUT_FILES: Record<string, string> = {
  // Content creation phases
  plot: 'agent/script/plot.md',
  story: 'agent/script/story.md',
  narration: 'agent/script/narration.md',
  character: 'agent/characters/',  // Will be appended with character name
  setting: 'agent/settings/',      // Will be appended with setting name
  scene: 'agent/plans/scenes.md',

  // Image prompt generation - prompts are passed directly to image generator, not saved
  character_image_prompt: '',  // Not saved - passed to image generator
  setting_image_prompt: '',    // Not saved - passed to image generator
  scene_image_prompt: '',      // Not saved - passed to image generator
};

export const generateContentTool = createTool(
  'generate_content',
  `Generate creative content for the story-to-video pipeline.

This tool automatically handles context - you don't need to pass context_refs.
The tool knows exactly what context each content type needs and fetches it automatically.

## Content Creation Types:
- plot: Generate high-level plot outline (uses: original user input)
- story: Generate full story narrative (uses: user input + plot)
- character: Generate character profile (uses: user input + plot + story)
- setting: Generate setting/location description (uses: user input + plot + story)
- scene: Generate scene descriptions (uses: user input + story + characters + settings)
- narration: Generate narration/voice-over text (uses: story + scenes)

## Image Prompt Generation Types:
- character_image_prompt: Generate detailed image prompt for a character (uses: project style + character description)
- setting_image_prompt: Generate detailed image prompt for a setting (uses: project style + setting description)
- scene_image_prompt: Generate detailed image prompt for a scene (uses: project style + scene + character/setting refs)

Image prompts are shown to the user for approval, then passed to the image generator.

## Examples:
- generate_content(content_type: "plot") - Creates plot from user's story idea
- generate_content(content_type: "character", name: "Alice") - Creates character profile
- generate_content(content_type: "character_image_prompt", name: "Alice") - Creates image prompt for Alice
- generate_content(content_type: "scene_image_prompt", scene_number: 3) - Creates image prompt for scene 3`,
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
        description: 'For character/setting/character_image_prompt/setting_image_prompt: the name of the character or setting',
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

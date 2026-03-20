/**
 * generate_prompt tool — DAG-driven prompt generation for image/video prompt types.
 *
 * Replaces `generate_content` for prompt types (character_image, setting_image,
 * scene_image, shot_image, scene_video). Uses a deterministic DAG to resolve
 * context, select skills, make ONE focused LLM call, validate, and persist.
 *
 * The orchestrator still decides WHEN to call this tool; the DAG handles HOW.
 */
import { createTool } from '../ToolRegistry.js';

export type PromptType =
  | 'character_image'
  | 'setting_image'
  | 'scene_image'
  | 'shot_image'
  | 'scene_video';

export const generatePromptTool = createTool(
  'generate_prompt',
  `Generate an image or video prompt using a deterministic DAG pipeline.

Unlike \`generate_content\`, this tool does NOT use a content-creator subagent loop.
Instead it:
1. Resolves all context (scene desc, character profiles, reference images) deterministically
2. Selects the correct skill/guide based on provider config
3. Makes ONE focused LLM call with pre-assembled, validated context
4. Validates the output format
5. Persists to the correct file

Use this for all image/video prompt generation. Use \`generate_content\` for non-prompt
content types (plot, story, character profiles, setting profiles, scenes, narration).

## Parameters

- **prompt_type** (required): Type of prompt to generate
- **name**: For character_image/setting_image — the character or setting name (REQUIRED)
- **scene_number**: For scene_image/shot_image/scene_video — the scene number (REQUIRED)
- **shot_number**: For shot_image — the shot number within the scene (REQUIRED)
- **style_hints**: Optional orchestrator guidance (e.g., "emphasize dramatic lighting")
- **overwrite**: If true, regenerate even if the prompt file already exists

## Prompt Types

| Type | Output Location |
|------|----------------|
| character_image | prompts/images/characters/{name}.prompt.md |
| setting_image | prompts/images/settings/{name}.prompt.md |
| scene_image | prompts/images/scenes/scene-{n}.prompt.md |
| shot_image | prompts/images/shots/scene-{n}-shot-{m}.prompt.md |
| scene_video | prompts/videos/scenes/scene-{n}.motion.json |

## Examples

\`\`\`javascript
// Generate a character reference image prompt
generate_prompt({ prompt_type: "character_image", name: "Isha" })

// Generate a scene composition prompt
generate_prompt({ prompt_type: "scene_image", scene_number: 3 })

// Generate a shot-specific prompt
generate_prompt({ prompt_type: "shot_image", scene_number: 2, shot_number: 1 })

// Generate a multi-shot video motion prompt
generate_prompt({ prompt_type: "scene_video", scene_number: 1 })

// Regenerate with style hints
generate_prompt({
  prompt_type: "scene_image",
  scene_number: 1,
  style_hints: "Use low-angle framing, golden hour lighting",
  overwrite: true
})
\`\`\``,
  {
    type: 'object',
    properties: {
      prompt_type: {
        type: 'string',
        enum: ['character_image', 'setting_image', 'scene_image', 'shot_image', 'scene_video'],
        description: 'Type of prompt to generate',
      },
      name: {
        type: 'string',
        description: 'For character_image/setting_image: the character or setting name (REQUIRED for these types)',
      },
      scene_number: {
        type: 'number',
        description: 'For scene_image/shot_image/scene_video: the scene number (REQUIRED for these types)',
      },
      shot_number: {
        type: 'number',
        description: 'For shot_image: the shot number within the scene (REQUIRED for shot_image)',
      },
      style_hints: {
        type: 'string',
        description: 'Optional orchestrator guidance for the prompt (e.g., "emphasize dramatic lighting")',
      },
      overwrite: {
        type: 'boolean',
        description: 'If true, regenerate even if the prompt file already exists. Default: false.',
      },
    },
    required: ['prompt_type'],
  }
  // No handler — handled by GenericAgent
);

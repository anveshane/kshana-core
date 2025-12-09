/**
 * Dispatch image agent tool - sends an image generation task to a specialized sub-agent.
 * The sub-agent crafts detailed prompts, gets user feedback, and generates the image.
 * This tool is handled specially by GenericAgent to spawn the image generation sub-agent.
 *
 * Supports two generation modes:
 * 1. Text-to-Image: For character/setting reference images (no reference_images needed)
 * 2. Image+Text-to-Image: For scene images with character/setting consistency (requires reference_images)
 */
import { createTool } from '../ToolRegistry.js';

export const dispatchImageAgentTool = createTool(
  'dispatch_image_agent',
  `Dispatch an image generation task to a specialized sub-agent. The sub-agent will craft a detailed prompt, present it to the user for feedback, refine as needed, and then generate the image once approved.

**Two Generation Modes:**

1. **Text-to-Image** (for reference images):
   - Use for character_ref or setting_ref image_types
   - No reference_images needed
   - Creates initial reference images from text descriptions

2. **Image+Text-to-Image** (for scene images):
   - Use for scene image_type
   - REQUIRES reference_images array with character/setting refs
   - Maintains visual consistency with established characters/settings
   - The sub-agent will include references in the generation call

Always use this tool for image generation to ensure high-quality, user-approved prompts.`,
  {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Description of the image to generate. Be specific about the subject, setting, and visual style.',
      },
      context: {
        type: 'string',
        description: 'Short context only (<500 chars). For longer content (character descriptions, scene details), use store_context first and pass context_ref instead.',
      },
      context_ref: {
        type: 'string',
        description: 'Reference ID from store_context for long content. PREFERRED over inline context to preserve original character/scene descriptions.',
      },
      scene_number: {
        type: 'number',
        description: 'The scene number this image is for (used for file naming).',
      },
      image_type: {
        type: 'string',
        enum: ['scene', 'character_ref', 'setting_ref'],
        description: 'Type of image: scene (storyboard), character_ref (character reference), or setting_ref (setting/background reference).',
      },
      character_name: {
        type: 'string',
        description: 'Name of the character (required if image_type is character_ref).',
      },
      setting_name: {
        type: 'string',
        description: 'Name of the setting (required if image_type is setting_ref).',
      },
      reference_images: {
        type: 'array',
        description: 'Reference images for consistency (REQUIRED for scene image_type). Include all characters and settings that appear in the scene.',
        items: {
          type: 'object',
          properties: {
            image_id: {
              type: 'string',
              description: 'Artifact ID or path to the reference image',
            },
            type: {
              type: 'string',
              enum: ['character', 'setting'],
              description: 'Type of reference: character or setting',
            },
            name: {
              type: 'string',
              description: 'Name of the character or setting',
            },
          },
          required: ['image_id', 'type', 'name'],
        },
      },
    },
    required: ['task'],
  }
  // No handler - handled by GenericAgent as a special built-in tool
);

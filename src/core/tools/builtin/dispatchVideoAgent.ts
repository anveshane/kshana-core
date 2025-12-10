/**
 * Dispatch video agent tool - sends a video generation task to a specialized sub-agent.
 * The sub-agent crafts video parameters, gets user feedback, and generates the video.
 * This tool is handled specially by GenericAgent to spawn the video generation sub-agent.
 */
import { createTool } from '../ToolRegistry.js';

export const dispatchVideoAgentTool = createTool(
  'dispatch_video_agent',
  `Dispatch a video generation task to a specialized sub-agent. The sub-agent will:
1. Analyze the scene image and description
2. Craft appropriate motion/action parameters
3. Present parameters to the user for feedback
4. Refine as needed
5. Generate the video once approved

Use this tool for each scene video generation to ensure quality and user approval.

The video is generated from a scene image with motion applied based on the motion description.`,
  {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Description of the video to generate, including the action/motion that should occur.',
      },
      scene_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the scene image to animate. This is the base image for video generation.',
      },
      scene_number: {
        type: 'number',
        description: 'The scene number for tracking and file naming.',
      },
      motion_description: {
        type: 'string',
        description: 'Description of the motion/action in the scene (e.g., "camera slowly zooms in", "character walks from left to right", "wind blows through trees").',
      },
      context_ref: {
        type: 'string',
        description: 'Reference ID from store_context for scene details. Use this for longer scene descriptions.',
      },
      duration: {
        type: 'number',
        description: 'Desired video duration in seconds (default: 4).',
      },
    },
    required: ['task', 'scene_image_artifact_id', 'scene_number'],
  }
  // No handler - handled by GenericAgent as a special built-in tool
);

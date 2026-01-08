/**
 * agentDefinitions - Sub-agent configurations following Claude Code SDK patterns.
 *
 * Defines specialized sub-agents for different tasks:
 * - Planning agent: Task decomposition and planning
 * - Content agent: Creative content generation
 * - Image agent: Image generation planning
 * - Video agent: Video generation planning
 */

import {
  PLANNING_AGENT_PROMPT,
  CONTENT_AGENT_PROMPT,
  IMAGE_GENERATION_AGENT_PROMPT,
  VIDEO_GENERATION_AGENT_PROMPT,
  TRANSCRIPT_AGENT_PROMPT,
} from '../core/prompts/index.js';

/**
 * Agent definition for sub-agents.
 */
export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  maxIterations?: number;
}

/**
 * Get all sub-agent definitions.
 */
export function getSubAgentDefinitions(): Record<string, AgentDefinition> {
  return {
    planning: {
      name: 'Planning Agent',
      description: 'Planning sub-agent for task decomposition and strategy. Use this when you need to break down complex tasks into steps.',
      systemPrompt: PLANNING_AGENT_PROMPT,
      tools: ['todo_write', 'store_context', 'fetch_context', 'list_contexts'],
      maxIterations: 10,
    },

    content: {
      name: 'Content Agent',
      description: 'Content creation sub-agent for generating creative content like stories, characters, scenes. Use this for narrative and descriptive content.',
      systemPrompt: CONTENT_AGENT_PROMPT,
      tools: ['todo_write', 'store_context', 'fetch_context', 'list_contexts'],
      maxIterations: 10,
    },

    image: {
      name: 'Image Agent',
      description: 'Image generation planning sub-agent. Use this to plan and generate images via ComfyUI.',
      systemPrompt: IMAGE_GENERATION_AGENT_PROMPT,
      tools: [
        'generate_image',
        'edit_image',
        'wait_for_job',
        'store_context',
        'fetch_context',
      ],
      maxIterations: 5,
    },

    video: {
      name: 'Video Agent',
      description: 'Video generation planning sub-agent. Use this to plan and generate videos via ComfyUI.',
      systemPrompt: VIDEO_GENERATION_AGENT_PROMPT,
      tools: [
        'generate_video_from_image',
        'generate_video_from_frames',
        'wait_for_job',
        'store_context',
        'fetch_context',
      ],
      maxIterations: 5,
    },

    transcript: {
      name: 'Transcript Agent',
      description: 'YouTube transcript extraction sub-agent. Use this to fetch and process transcripts from YouTube videos for analysis or reference.',
      systemPrompt: TRANSCRIPT_AGENT_PROMPT,
      tools: [
        'fetch_youtube_transcript',
        'store_context',
        'fetch_context',
        'list_contexts',
      ],
      maxIterations: 5,
    },
  };
}

/**
 * Get a specific sub-agent definition.
 */
export function getSubAgentDefinition(agentType: string): AgentDefinition | undefined {
  const definitions = getSubAgentDefinitions();
  return definitions[agentType];
}

/**
 * Check if an agent type is valid.
 */
export function isValidAgentType(agentType: string): boolean {
  return agentType in getSubAgentDefinitions();
}

/**
 * Get available agent types.
 */
export function getAvailableAgentTypes(): string[] {
  return Object.keys(getSubAgentDefinitions());
}

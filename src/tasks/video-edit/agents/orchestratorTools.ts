/**
 * Orchestrator tools - Wrapper tools that allow the orchestrator to invoke sub-agents.
 * Each sub-agent is invoked as a tool, maintaining the familiar tool interface pattern.
 */

import type { ToolDefinition } from '../../../core/llm/index.js';
import { createTool } from '../../../core/tools/ToolRegistry.js';
import type { SubAgentFactory } from './SubAgentFactory.js';
import type { SubAgentContext, SubAgentResult, SubAgentType } from './types.js';
import { loadProject } from '../workflow/ProjectManager.js';
import { EditWorkflowPhase } from '../workflow/types.js';

/**
 * Create all sub-agent wrapper tools for the orchestrator.
 */
export function createSubAgentWrapperTools(factory: SubAgentFactory): ToolDefinition[] {
  return [
    createIngestAgentTool(factory),
    createScriptAgentTool(factory),
    createAnalysisAgentTool(factory),
    createEnhancementAgentTool(factory),
  ];
}

/**
 * Create the invoke_ingest_agent tool.
 */
function createIngestAgentTool(factory: SubAgentFactory): ToolDefinition {
  return createTool(
    'invoke_ingest_agent',
    `Invoke the Video Ingest Agent to import a video and extract metadata.

This agent handles:
- Importing video from local file paths
- Downloading from YouTube URLs (requires yt-dlp)
- Extracting video metadata (duration, resolution, fps)
- Generating thumbnail strip for timeline preview

Use this when starting a new project or importing source material.
The agent will automatically create a project if none exists.`,
    {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description for the ingest agent (e.g., "Import video from YouTube URL https://...")',
        },
        video_source: {
          type: 'string',
          description: 'Path or URL to the video file',
        },
        source_type: {
          type: 'string',
          enum: ['local_file', 'url', 'cloud_storage'],
          description: 'Type of video source (default: auto-detect)',
        },
      },
      required: ['task'],
    },
    async (args) => {
      return executeSubAgent(factory, 'ingest', args);
    }
  );
}

/**
 * Create the invoke_script_agent tool.
 */
function createScriptAgentTool(factory: SubAgentFactory): ToolDefinition {
  return createTool(
    'invoke_script_agent',
    `Invoke the Script Processing Agent to parse scripts or transcribe video audio.

This agent handles:
- Auto-detecting script format (SRT, VTT, screenplay, plain text)
- Parsing script content into timed segments
- Transcribing video audio to text with timestamps
- Aligning script segments to video timecodes
- Adding user enhancement hints

Use this after video import to process the script content.
If no script is provided, the agent can transcribe from the video audio.`,
    {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description for the script agent (e.g., "Transcribe the video audio" or "Parse the provided SRT script")',
        },
        script_content: {
          type: 'string',
          description: 'Script content to parse (optional - agent can transcribe instead)',
        },
        script_path: {
          type: 'string',
          description: 'Path to a script file (optional)',
        },
        transcribe: {
          type: 'boolean',
          description: 'Whether to transcribe from video audio instead of parsing script',
        },
      },
      required: ['task'],
    },
    async (args) => {
      return executeSubAgent(factory, 'script', args);
    }
  );
}

/**
 * Create the invoke_analysis_agent tool.
 */
function createAnalysisAgentTool(factory: SubAgentFactory): ToolDefinition {
  return createTool(
    'invoke_analysis_agent',
    `Invoke the Content Analysis Agent to identify enhancement opportunities.

This agent analyzes the script content to find where visual or audio enhancements would improve the video:
- Identifies keywords suggesting images (landscapes, diagrams)
- Detects data/statistics that could use motion graphics
- Finds emotional moments for background music
- Suggests composition modes (PIP, B-roll, split-screen)

Each suggestion includes a confidence score and recommended enhancement type.
Use this after script processing to plan enhancements.`,
    {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description for the analysis agent (e.g., "Identify enhancement opportunities in the script")',
        },
        min_confidence: {
          type: 'number',
          description: 'Minimum confidence threshold for suggestions (0-1, default: 0.5)',
        },
        enhancement_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to specific enhancement types (ai_image, motion_graphic, audio_music, etc.)',
        },
      },
      required: ['task'],
    },
    async (args) => {
      return executeSubAgent(factory, 'analysis', args);
    }
  );
}

/**
 * Create the invoke_enhancement_agent tool.
 */
function createEnhancementAgentTool(factory: SubAgentFactory): ToolDefinition {
  return createTool(
    'invoke_enhancement_agent',
    `Invoke the Enhancement Planning Agent to manage enhancement suggestions and user approval.

This agent handles the approval workflow:
- Creates detailed enhancement suggestions for specific time ranges
- Presents each suggestion to the user for approval
- Handles approval, rejection, and feedback
- Regenerates suggestions based on user feedback
- Tracks enhancement status (pending, approved, rejected)

Use this after analysis to get user approval for enhancements.
The agent will process pending enhancements one by one.`,
    {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description for the enhancement agent (e.g., "Get user approval for pending enhancements")',
        },
        batch_mode: {
          type: 'boolean',
          description: 'Process all pending enhancements in sequence without individual prompts',
        },
        enhancement_id: {
          type: 'string',
          description: 'Process a specific enhancement by ID',
        },
      },
      required: ['task'],
    },
    async (args) => {
      return executeSubAgent(factory, 'enhancement', args);
    }
  );
}

/**
 * Execute a sub-agent and return results.
 */
async function executeSubAgent(
  factory: SubAgentFactory,
  agentType: SubAgentType,
  args: Record<string, unknown>
): Promise<SubAgentResult> {
  const task = args['task'] as string;

  // Load current project state
  const project = loadProject();

  // Determine current phase based on agent type
  const phaseMap: Record<SubAgentType, EditWorkflowPhase> = {
    ingest: EditWorkflowPhase.INGEST,
    script: EditWorkflowPhase.SCRIPT_PARSE,
    analysis: EditWorkflowPhase.ANALYSIS,
    enhancement: EditWorkflowPhase.ENHANCEMENT_PLAN,
  };

  // Build context for sub-agent
  const context: SubAgentContext = {
    projectSnapshot: project,
    currentPhase: project?.currentPhase ?? phaseMap[agentType],
    task,
    additionalContext: buildAdditionalContext(args),
  };

  try {
    // Create the sub-agent
    const agent = await factory.createAgent(agentType, context);

    // Run the sub-agent with the task
    const result = await agent.run(task);

    // Check if project was modified by reloading
    const updatedProject = loadProject();
    const projectModified = project
      ? updatedProject?.updatedAt !== project.updatedAt
      : updatedProject !== null;

    return {
      success: result.status === 'completed',
      status: mapAgentStatus(result.status),
      output: result.output,
      error: result.error,
      projectModified,
      iterations: 0, // GenericAgent doesn't expose iteration count currently
    };
  } catch (error) {
    return {
      success: false,
      status: 'error',
      output: '',
      error: error instanceof Error ? error.message : String(error),
      projectModified: false,
      iterations: 0,
    };
  }
}

/**
 * Map GenericAgent status to SubAgentResult status.
 */
function mapAgentStatus(
  status: string
): SubAgentResult['status'] {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'waiting_for_user':
      return 'needs_user_input';
    case 'interrupted':
      return 'interrupted';
    case 'error':
    default:
      return 'error';
  }
}

/**
 * Build additional context string from tool arguments.
 */
function buildAdditionalContext(args: Record<string, unknown>): string {
  const contextParts: string[] = [];

  // Video source info
  if (args['video_source']) {
    contextParts.push(`Video source: ${args['video_source']}`);
  }
  if (args['source_type']) {
    contextParts.push(`Source type: ${args['source_type']}`);
  }

  // Script info
  if (args['script_content']) {
    const content = args['script_content'] as string;
    contextParts.push(`Script provided: ${content.length} characters`);
    // Include first 500 chars for context
    if (content.length > 0) {
      contextParts.push(`Script preview: ${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`);
    }
  }
  if (args['script_path']) {
    contextParts.push(`Script file path: ${args['script_path']}`);
  }
  if (args['transcribe']) {
    contextParts.push('Mode: Transcribe from video audio');
  }

  // Analysis filters
  if (args['min_confidence']) {
    contextParts.push(`Minimum confidence: ${args['min_confidence']}`);
  }
  if (args['enhancement_types'] && Array.isArray(args['enhancement_types'])) {
    contextParts.push(`Enhancement types filter: ${(args['enhancement_types'] as string[]).join(', ')}`);
  }

  // Enhancement workflow options
  if (args['batch_mode']) {
    contextParts.push('Mode: Batch processing (process all pending)');
  }
  if (args['enhancement_id']) {
    contextParts.push(`Specific enhancement: ${args['enhancement_id']}`);
  }

  return contextParts.length > 0 ? contextParts.join('\n') : '';
}

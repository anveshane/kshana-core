/**
 * SubAgentFactory - Creates domain-specific sub-agents for the video editing workflow.
 *
 * Each sub-agent is a separate GenericAgent instance with:
 * - Its own message history (context isolation)
 * - Domain-specific tools
 * - Shared project access tools (read_project, update_project)
 * - Custom system prompt for its domain
 */

import type { LLMClient, ToolDefinition } from '../../../core/llm/index.js';
import { GenericAgent } from '../../../core/agent/GenericAgent.js';
import { createTool } from '../../../core/tools/ToolRegistry.js';
import type { SubAgentConfig, SubAgentContext, SubAgentType } from './types.js';
import { createReadProjectTool, createUpdateProjectTool } from './sharedTools.js';
import {
  INGEST_AGENT_PROMPT,
  SCRIPT_AGENT_PROMPT,
  ANALYSIS_AGENT_PROMPT,
  ENHANCEMENT_AGENT_PROMPT,
} from './prompts/index.js';
import {
  ingestTools,
  scriptTools,
  analysisTools,
  enhancementTools,
} from '../tools/index.js';
import { EditWorkflowPhase, PHASE_CONFIGS } from '../workflow/types.js';
import { getProjectSummary } from '../workflow/ProjectManager.js';

/**
 * Factory for creating domain-specific sub-agents.
 */
export class SubAgentFactory {
  private llm: LLMClient;
  private agentConfigs: Map<SubAgentType, SubAgentConfig>;

  constructor(llm: LLMClient) {
    this.llm = llm;
    this.agentConfigs = this.initializeAgentConfigs();
  }

  /**
   * Initialize agent configurations for each domain.
   */
  private initializeAgentConfigs(): Map<SubAgentType, SubAgentConfig> {
    const configs = new Map<SubAgentType, SubAgentConfig>();

    // Ingest Agent - handles video import and metadata extraction
    configs.set('ingest', {
      name: 'ingest-agent',
      displayName: 'Video Ingest Agent',
      domainTools: ['import_video', 'extract_metadata', 'generate_thumbnails', 'complete_ingest'],
      systemPrompt: INGEST_AGENT_PROMPT,
      maxIterations: 20,
      phases: [EditWorkflowPhase.INGEST],
    });

    // Script Agent - handles script parsing and transcription
    configs.set('script', {
      name: 'script-agent',
      displayName: 'Script Processing Agent',
      domainTools: [
        'detect_script_format',
        'parse_script',
        'transcribe_video',
        'align_script_to_video',
        'add_user_hint',
        'complete_script_parse',
      ],
      systemPrompt: SCRIPT_AGENT_PROMPT,
      maxIterations: 30,
      phases: [EditWorkflowPhase.SCRIPT_PARSE],
    });

    // Analysis Agent - identifies enhancement opportunities
    configs.set('analysis', {
      name: 'analysis-agent',
      displayName: 'Content Analysis Agent',
      domainTools: ['identify_enhancement_opportunities', 'extract_frame', 'complete_analysis'],
      systemPrompt: ANALYSIS_AGENT_PROMPT,
      maxIterations: 30,
      phases: [EditWorkflowPhase.ANALYSIS],
    });

    // Enhancement Agent - manages enhancement approval workflow
    configs.set('enhancement', {
      name: 'enhancement-agent',
      displayName: 'Enhancement Planning Agent',
      domainTools: [
        'suggest_enhancement',
        'approve_enhancement',
        'reject_enhancement',
        'regenerate_enhancement',
        'list_enhancements',
        'get_next_pending_enhancement',
        'complete_enhancement_plan',
      ],
      systemPrompt: ENHANCEMENT_AGENT_PROMPT,
      maxIterations: 100, // Higher for approval workflow
      phases: [EditWorkflowPhase.ENHANCEMENT_PLAN],
    });

    return configs;
  }

  /**
   * Create a sub-agent for a specific domain.
   */
  async createAgent(
    agentType: SubAgentType,
    context: SubAgentContext
  ): Promise<GenericAgent> {
    const config = this.agentConfigs.get(agentType);
    if (!config) {
      throw new Error(`Unknown agent type: ${agentType}`);
    }

    // Build tools map: domain-specific + shared
    const toolsMap = this.buildToolsMap(config);

    // Build system prompt with context injection
    const systemPrompt = this.buildSystemPrompt(config, context);

    // Create GenericAgent instance
    const agent = new GenericAgent(toolsMap, this.llm, {
      isSubAgent: true,
      maxIterations: config.maxIterations ?? 50,
      name: `${config.name}-${Date.now()}`,
      customPrompt: systemPrompt,
    });

    // Initialize the agent (queries model context length)
    await agent.initialize();

    return agent;
  }

  /**
   * Build the tools map for a sub-agent.
   * Combines domain-specific tools with shared tools.
   */
  private buildToolsMap(config: SubAgentConfig): Map<string, ToolDefinition> {
    const toolsMap = new Map<string, ToolDefinition>();

    // Add shared tools (available to all sub-agents)
    toolsMap.set('read_project', createReadProjectTool());
    toolsMap.set('update_project', createUpdateProjectTool());

    // Add think tool for reasoning
    toolsMap.set('think', this.createThinkTool());

    // Add ask_user tool for user interaction
    toolsMap.set('ask_user', this.createAskUserTool());

    // Add domain-specific tools
    const domainTools = this.getDomainTools(config.domainTools);
    for (const tool of domainTools) {
      toolsMap.set(tool.name, tool);
    }

    return toolsMap;
  }

  /**
   * Get domain tools by name from the tool collections.
   */
  private getDomainTools(toolNames: string[]): ToolDefinition[] {
    const allTools = [
      ...ingestTools,
      ...scriptTools,
      ...analysisTools,
      ...enhancementTools,
    ];

    const toolNameSet = new Set(toolNames);
    return allTools.filter(tool => toolNameSet.has(tool.name));
  }

  /**
   * Create the think tool for sub-agents.
   */
  private createThinkTool(): ToolDefinition {
    return createTool(
      'think',
      'Use this tool to reason about what to do next. Write your thoughts and analysis.',
      {
        type: 'object',
        properties: {
          thought: {
            type: 'string',
            description: 'Your reasoning and analysis',
          },
        },
        required: ['thought'],
      },
      async (args) => {
        // Think tool just returns the thought - it's for the agent's reasoning
        return { thought: args['thought'] };
      }
    );
  }

  /**
   * Create the ask_user tool for sub-agents.
   */
  private createAskUserTool(): ToolDefinition {
    return createTool(
      'ask_user',
      'Ask the user a question and wait for their response.',
      {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of choices for the user',
          },
        },
        required: ['question'],
      },
      async (args) => {
        // This will be handled by the agent's waitingForUser mechanism
        return {
          status: 'awaiting_user_response',
          question: args['question'],
          options: args['options'],
        };
      }
    );
  }

  /**
   * Build the system prompt with context injection.
   */
  private buildSystemPrompt(config: SubAgentConfig, context: SubAgentContext): string {
    const projectSummary = context.projectSnapshot
      ? this.formatProjectSummary(context.projectSnapshot)
      : getProjectSummary();

    const phaseConfig = PHASE_CONFIGS[context.currentPhase];
    const phaseName = phaseConfig?.displayName ?? context.currentPhase;

    let prompt = config.systemPrompt;

    // Add context section
    prompt += `

## Current Context

**Agent**: ${config.displayName}
**Phase**: ${phaseName}
**Task**: ${context.task}

## Project State
${projectSummary}
`;

    // Add additional context if provided
    if (context.additionalContext) {
      prompt += `
## Additional Information
${context.additionalContext}
`;
    }

    return prompt;
  }

  /**
   * Format project snapshot into a summary string.
   */
  private formatProjectSummary(project: SubAgentContext['projectSnapshot']): string {
    if (!project) {
      return 'No project exists yet. A new project will be created when video is imported.';
    }

    const lines: string[] = [];
    lines.push(`Project: ${project.title || '(untitled)'}`);
    lines.push(`ID: ${project.id}`);
    lines.push(`Current Phase: ${project.currentPhase}`);

    if (project.source.path) {
      lines.push(`Source Video: ${project.source.path}`);
      if (project.source.metadata) {
        const meta = project.source.metadata;
        lines.push(`Duration: ${Math.floor(meta.durationMs / 1000)}s, ${meta.width}x${meta.height} @ ${meta.fps}fps`);
      }
    } else {
      lines.push('Source Video: Not imported');
    }

    lines.push(`Script Segments: ${project.script.segments.length}`);
    lines.push(`Enhancements: ${project.enhancements.length} (${project.enhancements.filter(e => e.approvalStatus === 'approved').length} approved)`);
    lines.push(`Assets: ${project.assets.length}`);

    return lines.join('\n');
  }

  /**
   * Get configuration for an agent type.
   */
  getConfig(agentType: SubAgentType): SubAgentConfig | undefined {
    return this.agentConfigs.get(agentType);
  }

  /**
   * Get all available agent types.
   */
  getAvailableAgentTypes(): SubAgentType[] {
    return Array.from(this.agentConfigs.keys());
  }
}

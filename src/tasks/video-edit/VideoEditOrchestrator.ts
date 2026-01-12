/**
 * VideoEditOrchestrator - Main entry point for the video editing agent system.
 *
 * The orchestrator coordinates the video editing workflow by delegating to
 * specialized sub-agents. It uses the GenericAgent as its core but with
 * sub-agent wrapper tools instead of direct domain tools.
 *
 * Architecture:
 * - Orchestrator has invoke_*_agent tools to delegate work
 * - Each sub-agent is a separate GenericAgent with domain-specific tools
 * - All agents share read_project/update_project for state management
 * - Sub-agents are created on-demand and disposed after completion
 */

import type { LLMClient, ToolDefinition } from '../../core/llm/index.js';
import { GenericAgent, type GenericAgentResult } from '../../core/agent/index.js';
import { createTool } from '../../core/tools/ToolRegistry.js';
import { SubAgentFactory } from './agents/SubAgentFactory.js';
import { createSubAgentWrapperTools } from './agents/orchestratorTools.js';
import { createReadProjectTool, createUpdateProjectTool } from './agents/sharedTools.js';
import { ORCHESTRATOR_PROMPT } from './agents/prompts/index.js';

/**
 * Configuration for the VideoEditOrchestrator.
 */
export interface VideoEditOrchestratorConfig {
  /** Maximum iterations for the orchestrator (default: 200) */
  maxIterations?: number;
  /** Custom orchestrator prompt (default: uses ORCHESTRATOR_PROMPT) */
  customPrompt?: string;
}

/**
 * VideoEditOrchestrator manages the video editing workflow through sub-agents.
 */
export class VideoEditOrchestrator {
  private llm: LLMClient;
  private factory: SubAgentFactory;
  private agent: GenericAgent | null = null;
  private config: VideoEditOrchestratorConfig;

  constructor(llm: LLMClient, config: VideoEditOrchestratorConfig = {}) {
    this.llm = llm;
    this.config = config;
    this.factory = new SubAgentFactory(llm);
  }

  /**
   * Initialize the orchestrator agent.
   * Must be called before running tasks.
   */
  async initialize(): Promise<void> {
    // Build tools map for the orchestrator
    const toolsMap = new Map<string, ToolDefinition>();

    // Add sub-agent wrapper tools (the main tools for delegation)
    const subAgentTools = createSubAgentWrapperTools(this.factory);
    for (const tool of subAgentTools) {
      toolsMap.set(tool.name, tool);
    }

    // Add shared tools for direct orchestrator use
    toolsMap.set('read_project', createReadProjectTool());
    toolsMap.set('update_project', createUpdateProjectTool());

    // Add think tool for reasoning
    toolsMap.set('think', this.createThinkTool());

    // Add ask_user tool for user interaction
    toolsMap.set('ask_user', this.createAskUserTool());

    // Create the orchestrator agent
    this.agent = new GenericAgent(toolsMap, this.llm, {
      isSubAgent: false,
      maxIterations: this.config.maxIterations ?? 200,
      name: 'video-edit-orchestrator',
      customPrompt: this.config.customPrompt ?? ORCHESTRATOR_PROMPT,
    });

    await this.agent.initialize();
  }

  /**
   * Create the think tool for the orchestrator.
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
        return { thought: args['thought'] };
      }
    );
  }

  /**
   * Create the ask_user tool for the orchestrator.
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
        return {
          status: 'awaiting_user_response',
          question: args['question'],
          options: args['options'],
        };
      }
    );
  }

  /**
   * Run the orchestrator with a user task.
   */
  async run(task: string): Promise<GenericAgentResult> {
    if (!this.agent) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }
    return this.agent.run(task);
  }

  /**
   * Continue the orchestrator after user input.
   */
  async continue(userResponse: string): Promise<GenericAgentResult> {
    if (!this.agent) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }
    return this.agent.run('', userResponse);
  }

  /**
   * Stop the orchestrator's current execution.
   */
  stop(): void {
    if (this.agent) {
      this.agent.stop();
    }
  }

  /**
   * Inject input during execution.
   */
  injectInput(input: string): void {
    if (this.agent) {
      this.agent.injectInput(input);
    }
  }

  /**
   * Check if the orchestrator is running.
   */
  isRunning(): boolean {
    return this.agent?.isRunning() ?? false;
  }

  /**
   * Subscribe to agent events.
   */
  on<T extends Parameters<GenericAgent['on']>[0]>(
    event: T,
    handler: Parameters<GenericAgent['on']>[1]
  ): this {
    if (this.agent) {
      this.agent.on(event, handler);
    }
    return this;
  }

  /**
   * Unsubscribe from agent events.
   */
  off<T extends Parameters<GenericAgent['off']>[0]>(
    event: T,
    handler: Parameters<GenericAgent['off']>[1]
  ): this {
    if (this.agent) {
      this.agent.off(event, handler);
    }
    return this;
  }

  /**
   * Remove all event listeners.
   */
  removeAllListeners(): void {
    if (this.agent) {
      this.agent.removeAllListeners();
    }
  }

  /**
   * Get the underlying GenericAgent (for advanced use).
   */
  getAgent(): GenericAgent | null {
    return this.agent;
  }

  /**
   * Get the SubAgentFactory (for advanced use).
   */
  getFactory(): SubAgentFactory {
    return this.factory;
  }
}

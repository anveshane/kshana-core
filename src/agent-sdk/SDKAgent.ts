/**
 * SDKAgent - Main agent harness following Claude Code SDK patterns.
 *
 * This implements the agent loop architecture from Claude Code SDK but uses
 * our existing LLMClient for flexibility (Gemini, OpenAI, LM Studio support).
 *
 * Key features:
 * - Autonomous tool execution loop
 * - Sub-agent dispatch
 * - Tool confirmation for complex operations
 * - Loop detection
 * - Context management
 */

import { nanoid } from 'nanoid';
import type { LLMClient, Message, ToolCall } from '../core/llm/index.js';
import type { ToolDefinition } from '../core/llm/types.js';
import { ExpandableTodoManager, type ExpandableTodoItem } from '../core/todo/index.js';
import { buildSystemMessage, buildPlanningPrompt, buildContentPrompt, buildImageGenerationPrompt, buildTranscriptPrompt } from '../core/prompts/index.js';
import { contextStore, type ContextVariable } from '../core/context/index.js';
import { SDKMessageAdapter } from './SDKMessageAdapter.js';
import { LoopDetector } from './LoopDetector.js';
import { ConfirmationManager } from './ConfirmationManager.js';
import { buildAdaptedTools, getToolDefinitions, executeTool, type AdaptedTool } from './toolAdapters.js';
import { getSubAgentDefinition, type AgentDefinition } from './agentDefinitions.js';
import type { AgentConfig, GenericAgentResult } from '../core/agent/AgentResult.js';

/**
 * SDKAgent - Agent harness implementation.
 */
export class SDKAgent {
  private llm: LLMClient;
  private tools: Map<string, AdaptedTool>;
  private adapter: SDKMessageAdapter;
  private loopDetector: LoopDetector;
  private confirmationManager: ConfirmationManager;
  private todoManager: ExpandableTodoManager;
  private isSubAgent: boolean;
  private maxIterations: number;
  private name: string;
  private customPrompt?: string;

  // State
  private messages: Message[] = [];
  private iteration = 0;
  private waitingForUser = false;
  private pendingQuestion?: string;
  private aborted = false;
  private pendingUserInput: string | null = null;
  private activeContextVariables: ContextVariable[] = [];
  private maxContextTokens: number = 16000;
  private accumulatedOutput: string = '';

  // Sub-agent states
  private planningState: SubAgentState | null = null;
  private contentState: SubAgentState | null = null;
  private imageGenState: SubAgentState | null = null;
  private videoGenState: SubAgentState | null = null;
  private transcriptState: SubAgentState | null = null;

  constructor(
    llm: LLMClient,
    existingTools: Map<string, ToolDefinition>,
    config: AgentConfig = {}
  ) {
    this.llm = llm;
    this.isSubAgent = config.isSubAgent ?? false;
    this.maxIterations = config.maxIterations ?? 100;
    this.name = config.name ?? `agent-${nanoid(6)}`;
    this.customPrompt = config.customPrompt;

    // Initialize components
    this.todoManager = new ExpandableTodoManager();
    this.adapter = new SDKMessageAdapter(this.name);
    this.loopDetector = new LoopDetector();
    this.confirmationManager = new ConfirmationManager();
    this.tools = buildAdaptedTools(existingTools, this.todoManager);
  }

  /**
   * Initialize the agent.
   */
  async initialize(): Promise<void> {
    this.maxContextTokens = await this.llm.getContextLength();
  }

  /**
   * Run the agent on a task.
   */
  async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    // Handle user response
    if (userResponse && this.waitingForUser) {
      this.messages.push({
        role: 'user',
        content: userResponse,
      });
      this.waitingForUser = false;
      this.pendingQuestion = undefined;
    } else if (task) {
      // New task
      this.messages = [];
      this.iteration = 0;
      this.aborted = false;
      this.accumulatedOutput = '';
      this.messages.push({
        role: 'user',
        content: task,
      });
    }

    // Emit started status
    this.adapter.emitStatus('started');

    // Main agent loop
    while (this.iteration < this.maxIterations && !this.aborted) {
      this.iteration++;

      // Check for injected input
      if (this.pendingUserInput) {
        const input = this.pendingUserInput;
        this.pendingUserInput = null;
        this.messages.push({
          role: 'user',
          content: input,
        });
      }

      // Build system message with todos
      const systemMessage = this.buildSystemMessage();
      const messagesToSend: Message[] = [
        { role: 'system', content: systemMessage },
        ...this.messages,
      ];

      // Generate response with streaming
      const stream = this.llm.generateStream({
        messages: messagesToSend,
        tools: getToolDefinitions(this.tools),
      });

      // Consume stream via adapter
      const chunks: any[] = [];
      let currentResponseText = '';
      for await (const chunk of stream) {
        chunks.push(chunk);
        // Accumulate text output (StreamChunk uses 'content' not 'text')
        if (chunk.content) {
          currentResponseText += chunk.content;
          this.accumulatedOutput += chunk.content;
        }
        await this.adapter.consumeStreamingChunks([chunk] as any);
      }

      // Get final response
      const lastChunk = chunks[chunks.length - 1];
      if (!lastChunk) {
        throw new Error('No response from LLM');
      }

      // Add assistant message
      this.messages.push({
        role: 'assistant',
        content: currentResponseText,
        tool_calls: lastChunk.tool_calls || [],
      });

      // Process tool calls
      if (lastChunk.tool_calls && lastChunk.tool_calls.length > 0) {
        const shouldPause = await this.processToolCalls(lastChunk.tool_calls);
        if (shouldPause) {
          return {
            status: 'waiting_for_user',
            output: this.accumulatedOutput,
            todos: this.todoManager.getTodos(),
            pendingQuestion: this.pendingQuestion,
          };
        }
      } else {
        // No tool calls, task completed
        this.adapter.emitStatus('completed');
        return {
          status: 'completed',
          output: this.accumulatedOutput,
          todos: this.todoManager.getTodos(),
        };
      }
    }

    // Max iterations reached
    if (this.iteration >= this.maxIterations) {
      this.adapter.emitStatus('error');
      return {
        status: 'error',
        output: this.accumulatedOutput,
        todos: this.todoManager.getTodos(),
        error: 'Maximum iterations reached',
      };
    }

    // Aborted
    this.adapter.emitStatus('interrupted');
    return {
      status: 'interrupted',
      output: this.accumulatedOutput,
      todos: this.todoManager.getTodos(),
    };
  }

  /**
   * Process tool calls.
   * Returns true if should pause for user input.
   */
  private async processToolCalls(toolCalls: ToolCall[]): Promise<boolean> {
    const toolResults: any[] = [];

    for (const toolCall of toolCalls) {
      // Loop detection
      this.loopDetector.trackToolCall(toolCall.name);
      if (this.loopDetector.detectLoop()) {
        throw new Error('Loop detected - agent is stuck calling the same tool repeatedly');
      }

      // Tool confirmation check
      if (this.confirmationManager.needsConfirmation(toolCall.name)) {
        if (!this.confirmationManager.shouldAllowExecution(toolCall.name)) {
          // Need confirmation - pause and ask user
          this.pendingQuestion = `Tool ${toolCall.name} requires confirmation. Allow execution?`;
          this.waitingForUser = true;
          this.confirmationManager.addConfirmation(toolCall.name, toolCall.arguments as Record<string, unknown>);

          this.adapter.emitQuestion(this.pendingQuestion, true);

          return true; // Pause
        }
        // Clear confirmation after use
        this.confirmationManager.clearConfirmation(toolCall.name);
      }

      // Execute tool
      try {
        const result = await this.executeToolCall(toolCall);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });

        this.adapter.emitToolResult(toolCall.id, result, false);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: ${errorMessage}`,
        });

        this.adapter.emitToolResult(toolCall.id, { error: errorMessage }, true);
      }
    }

    // Add tool results to messages
    this.messages.push(...toolResults);

    return false; // Continue
  }

  /**
   * Execute a single tool call.
   */
  private async executeToolCall(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments as Record<string, unknown>;

    // Special handling for built-in tools
    switch (toolCall.name) {
      case 'ask_user':
        return await this.handleAskUser(args);
      case 'todo_write':
        return await this.handleTodoWrite(args);
      case 'dispatch_agent':
        return await this.handleDispatchAgent(args);
      case 'dispatch_content_agent':
        return await this.handleDispatchContentAgent(args);
      case 'dispatch_image_agent':
        return await this.handleDispatchImageAgent(args);
      case 'dispatch_video_agent':
        return await this.handleDispatchVideoAgent(args);
      case 'dispatch_transcript_agent':
        return await this.handleDispatchTranscriptAgent(args);
      default:
        // Execute via tool handler
        return await executeTool(toolCall.name, args, this.tools);
    }
  }

  /**
   * Handle ask_user tool.
   */
  private async handleAskUser(args: Record<string, unknown>): Promise<unknown> {
    this.pendingQuestion = args.question as string;
    this.waitingForUser = true;

    this.adapter.emitQuestion(
      this.pendingQuestion,
      args.is_confirmation as boolean,
      args.options as Array<{ label: string; description?: string }>,
      args.auto_approve_timeout_ms as number | undefined
    );

    return { status: 'waiting_for_user' };
  }

  /**
   * Handle todo_write tool.
   */
  private async handleTodoWrite(args: Record<string, unknown>): Promise<unknown> {
    const todos = args.todos as Array<{ content: string; status: string }>;
    const result = this.todoManager.writeTodos(
      todos.map(t => t.content),
      todos.find(t => t.status === 'in_progress')?.content
    );

    this.adapter.emitTodoUpdate(result.todos as any);
    return result;
  }

  /**
   * Handle dispatch_agent tool (planning sub-agent).
   */
  private async handleDispatchAgent(args: Record<string, unknown>): Promise<unknown> {
    const agentDef = getSubAgentDefinition('planning');
    if (!agentDef) {
      throw new Error('Planning agent definition not found');
    }

    // Create sub-agent
    const subAgent = new SDKAgent(this.llm, this.tools, {
      isSubAgent: true,
      name: agentDef.name,
      maxIterations: agentDef.maxIterations,
      customPrompt: buildPlanningPrompt(
        args.task as string,
        this.resolveContextRefs(args.context_refs as string[] | undefined)
      ),
    });

    await subAgent.initialize();
    const result = await subAgent.run(args.task as string);

    return result;
  }

  /**
   * Handle dispatch_content_agent tool.
   */
  private async handleDispatchContentAgent(args: Record<string, unknown>): Promise<unknown> {
    const agentDef = getSubAgentDefinition('content');
    if (!agentDef) {
      throw new Error('Content agent definition not found');
    }

    const subAgent = new SDKAgent(this.llm, this.tools, {
      isSubAgent: true,
      name: agentDef.name,
      maxIterations: agentDef.maxIterations,
      customPrompt: buildContentPrompt(
        args.content_type as any,
        args.task as string,
        this.resolveContextRefs(args.context_refs as string[] | undefined)
      ),
    });

    await subAgent.initialize();
    const result = await subAgent.run(args.task as string);

    return result;
  }

  /**
   * Handle dispatch_image_agent tool.
   */
  private async handleDispatchImageAgent(args: Record<string, unknown>): Promise<unknown> {
    const agentDef = getSubAgentDefinition('image');
    if (!agentDef) {
      throw new Error('Image agent definition not found');
    }

    const subAgent = new SDKAgent(this.llm, this.tools, {
      isSubAgent: true,
      name: agentDef.name,
      maxIterations: agentDef.maxIterations,
      customPrompt: buildImageGenerationPrompt(
        args.task as string,
        this.resolveContextRefs(args.context_refs as string[] | undefined)
      ),
    });

    await subAgent.initialize();
    const result = await subAgent.run(args.task as string);

    return result;
  }

  /**
   * Handle dispatch_video_agent tool.
   */
  private async handleDispatchVideoAgent(args: Record<string, unknown>): Promise<unknown> {
    const agentDef = getSubAgentDefinition('video');
    if (!agentDef) {
      throw new Error('Video agent definition not found');
    }

    const subAgent = new SDKAgent(this.llm, this.tools, {
      isSubAgent: true,
      name: agentDef.name,
      maxIterations: agentDef.maxIterations,
      customPrompt: args.task as string,
    });

    await subAgent.initialize();
    const result = await subAgent.run(args.task as string);

    return result;
  }

  /**
   * Handle dispatch_transcript_agent tool.
   */
  private async handleDispatchTranscriptAgent(args: Record<string, unknown>): Promise<unknown> {
    const agentDef = getSubAgentDefinition('transcript');
    if (!agentDef) {
      throw new Error('Transcript agent definition not found');
    }

    const subAgent = new SDKAgent(this.llm, this.tools, {
      isSubAgent: true,
      name: agentDef.name,
      maxIterations: agentDef.maxIterations,
      customPrompt: buildTranscriptPrompt({
        youtubeUrl: args.youtube_url as string,
        task: args.task as string | undefined,
        context: this.resolveContextRefs(args.context_refs as string[] | undefined),
      }),
    });

    await subAgent.initialize();
    const result = await subAgent.run(args.task as string || `Extract transcript from ${args.youtube_url}`);

    return result;
  }

  /**
   * Resolve context references to full content.
   */
  private resolveContextRefs(refs?: string[]): string | undefined {
    if (!refs || refs.length === 0) {
      return undefined;
    }

    const parts: string[] = [];
    for (const ref of refs) {
      const stored = contextStore.get(ref);
      if (stored) {
        parts.push(`## ${ref} (${stored.label})\n\n${stored.content}`);
      }
    }

    return parts.length > 0 ? parts.join('\n\n---\n\n') : undefined;
  }

  /**
   * Build system message.
   */
  private buildSystemMessage(): string {
    const todoReminder = this.todoManager.toReminderText();
    const baseMessage = buildSystemMessage(
      this.isSubAgent,
      new Map(Array.from(this.tools.entries()).map(([k, v]) => [k, v.definition])),
      this.customPrompt
    );

    return `${baseMessage}\n\n${todoReminder}`;
  }

  /**
   * Stop the agent.
   */
  stop(): void {
    this.aborted = true;
    this.adapter.emitStatus('interrupted');
  }

  /**
   * Inject user input.
   */
  injectInput(input: string): void {
    this.pendingUserInput = input;
  }

  /**
   * Get the adapter for event subscription.
   */
  getAdapter(): SDKMessageAdapter {
    return this.adapter;
  }

  /**
   * Remove all event listeners from the adapter.
   * This is called by ConversationManager for cleanup.
   */
  removeAllListeners(): void {
    this.adapter.removeAllListeners();
  }
}

/**
 * Sub-agent state for multi-turn verification.
 */
interface SubAgentState {
  active: boolean;
  task: string;
  context?: string;
  currentOutput: string;
  iterations: number;
  toolCallId: string;
}

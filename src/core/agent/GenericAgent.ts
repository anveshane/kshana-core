/**
 * Generic Agent with hierarchical todo management.
 *
 * Features:
 * - while(tool_use) loop for autonomous task completion
 * - Framework-enforced confirmation for complex tools
 * - Hierarchical todo management with expand capability
 * - Sub-agent dispatch with isolated state
 */
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import { TypedEventEmitter } from '../../events/index.js';
import type { LLMClient, Message, ToolCall, ToolDefinition, LLMResponse } from '../llm/index.js';
import { ExpandableTodoManager, type ExpandableTodoItem } from '../todo/index.js';
import {
  buildSystemMessage,
  buildPlanningPrompt,
  buildContentPrompt,
  buildImageGenerationPrompt,
  wrapUserTask,
  type ContentType,
} from '../prompts/index.js';
import { loadAndRenderMarkdown } from '../prompts/loader.js';
import type { AgentConfig, AgentStatus, GenericAgentResult } from './AgentResult.js';
import {
  contextStore,
  condenseUserInput,
  generateContentLabel,
  shouldCondense,
  LONG_CONTENT_THRESHOLD,
} from '../context/index.js';
import {
  CONTENT_TYPE_CONTEXTS,
  CONTENT_TYPE_OUTPUT_FILES,
} from '../tools/builtin/generateContentTool.js';
import { buildContextVariablesSection, type ContextVariable } from '../prompts/index.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';

// Get the phase logger instance
const phaseLogger = getPhaseLogger();

// Legacy debug logging (wraps phaseLogger for backward compatibility during migration)
function debugLog(message: string) {
  // Parse the message to extract component and content
  const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match) {
    const component = match[1];
    const content = match[2];
    phaseLogger.debug(component, 'legacy', content);
  } else {
    phaseLogger.debug('GenericAgent', 'legacy', message);
  }
}

/**
 * Tool categories - simple tools execute immediately, complex require confirmation.
 */
const SIMPLE_TOOLS = new Set([
  'think',
  'AskUserQuestion',
  'ask_user', // back-compat during migration
  'dispatch_agent',
  'dispatch_content_agent',
  'dispatch_image_agent',
  'dispatch_video_agent',
  'generate_content', // Deterministic content generation
  'wait_for_job',
  'TodoWrite',
  'todo_write', // back-compat during migration
]);

const COMPLEX_TOOLS = new Set(['generate_image', 'generate_video', 'edit_image']);

function isComplexTool(name: string): boolean {
  return COMPLEX_TOOLS.has(name);
}

function isBuiltinTodoTool(name: string): boolean {
  return name === 'TodoWrite' || name === 'todo_write';
}

function isTaskTool(name: string): boolean {
  return name === 'Task';
}

function isPlanModeTool(name: string): boolean {
  return name === 'EnterPlanMode' || name === 'ExitPlanMode';
}

export class GenericAgent extends TypedEventEmitter {
  private tools: Map<string, ToolDefinition>;
  private llm: LLMClient;
  private isSubAgent: boolean;
  private maxIterations: number;
  private name: string;
  private customPrompt?: string;

  // State
  private todoManager = new ExpandableTodoManager();
  private messages: Message[] = [];
  private iteration = 0;
  private waitingForUser = false;
  private pendingQuestion?: string;
  private pendingConfirmations = new Map<string, Record<string, unknown>>();

  // Interruption state
  private aborted = false;
  private pendingUserInput: string | null = null;

  // Active context variables for this session
  private activeContextVariables: ContextVariable[] = [];

  // Loop detection state
  private recentToolCalls: string[] = [];
  private consecutiveLoopWarnings = 0;
  private static readonly LOOP_DETECTION_WINDOW = 6;
  private static readonly LOOP_THRESHOLD = 3; // Same tool called 3+ times in window
  private static readonly MAX_CONSECUTIVE_LOOP_WARNINGS = 3; // Force stop after this many warnings

  // Context window tracking
  private tokenUsage = {
    lastPromptTokens: 0,
    lastCompletionTokens: 0,
  };
  // Lower threshold (60%) to leave room for response generation
  // llama.cpp servers often can't handle mid-generation overflow
  private static readonly CONTEXT_THRESHOLD = 0.6;
  private maxContextTokens: number = 16000; // Will be updated from LLM client

  // Current mode for more descriptive agent names in UI
  private currentMode: 'orchestrator' | 'content' | 'image' | 'video' | 'planning' = 'orchestrator';

  // Claude SDK-style plan mode state
  private planModeActive = false;

  constructor(tools: Map<string, ToolDefinition>, llm: LLMClient, config: AgentConfig = {}) {
    super();
    this.tools = tools;
    this.llm = llm;
    this.isSubAgent = config.isSubAgent ?? false;
    this.maxIterations = config.maxIterations ?? 100;
    this.name = config.name ?? `agent-${nanoid(6)}`;
    this.customPrompt = config.customPrompt;
  }

  /**
   * Initialize the agent by querying model capabilities.
   * Must be called before running the agent.
   * Throws if the model's context length is too small.
   */
  async initialize(): Promise<void> {
    // Query context length from LLM provider (validates minimum requirements)
    this.maxContextTokens = await this.llm.getContextLength();
    debugLog(`[GenericAgent] Initialized with context length: ${this.maxContextTokens} tokens`);
  }

  /**
   * Get the effective agent name based on current mode.
   */
  private getEffectiveAgentName(): string {
    switch (this.currentMode) {
      case 'orchestrator':
        return 'Orchestrator';
      case 'content':
        return 'Content Agent';
      case 'image':
        return 'Image Agent';
      case 'video':
        return 'Video Agent';
      case 'planning':
        return 'Planning Agent';
      default:
        return this.name;
    }
  }

  /**
   * Stop the agent's current execution.
   */
  stop(): void {
    this.aborted = true;
    this.emit({
      type: 'agent_status',
      status: 'interrupted',
      agentName: this.getEffectiveAgentName(),
    });
  }

  /**
   * Inject new user input during execution.
   * The agent will process this input on the next iteration.
   */
  injectInput(input: string): void {
    this.pendingUserInput = input;
    this.emit({ type: 'user_input_injected', input, agentName: this.getEffectiveAgentName() });
  }

  /**
   * Check if agent is currently running.
   */
  isRunning(): boolean {
    return !this.aborted && !this.waitingForUser && this.iteration > 0;
  }

  /**
   * Generate LLM response with streaming, emitting chunks as they arrive.
   * Accumulates content and tool calls, returning the complete response.
   */
  private async generateWithStreaming(
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    let content = '';
    const toolCalls: ToolCall[] = [];
    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> =
      new Map();
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    try {
      for await (const chunk of this.llm.generateStream({ messages, tools, temperature: 0.7 })) {
        // Check for abort
        if (this.aborted) {
          this.emit({ type: 'streaming_text', chunk: '', done: true });
          break;
        }

        // Handle content chunks
        if (chunk.content) {
          content += chunk.content;
          debugLog(
            `[GenericAgent] streaming_text emit: chunk=${chunk.content.length} chars, total=${content.length} chars`
          );
          this.emit({ type: 'streaming_text', chunk: chunk.content, done: false });
        }

        // Handle tool call deltas
        if (chunk.toolCallDelta) {
          const delta = chunk.toolCallDelta;
          let accumulator = toolCallAccumulators.get(delta.index);

          if (!accumulator) {
            accumulator = { id: delta.id ?? '', name: delta.name ?? '', arguments: '' };
            toolCallAccumulators.set(delta.index, accumulator);
          }

          if (delta.id) accumulator.id = delta.id;
          if (delta.name) accumulator.name = delta.name;
          if (delta.arguments) accumulator.arguments += delta.arguments;
        }

        // Handle stream completion and capture usage
        if (chunk.done) {
          debugLog(
            `[GenericAgent] streaming_text DONE: total content=${content.length} chars, toolCallCount=${toolCallAccumulators.size}`
          );
          this.emit({ type: 'streaming_text', chunk: '', done: true });
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
      }
    } catch (error) {
      // On error, emit done and re-throw
      this.emit({ type: 'streaming_text', chunk: '', done: true });
      throw error;
    }

    // Convert accumulated tool calls to final format
    for (const [, acc] of toolCallAccumulators) {
      if (acc.id && acc.name) {
        try {
          toolCalls.push({
            id: acc.id,
            name: acc.name,
            arguments: acc.arguments ? JSON.parse(acc.arguments) : {},
          });
        } catch {
          // If JSON parsing fails, use empty object
          toolCalls.push({
            id: acc.id,
            name: acc.name,
            arguments: {},
          });
        }
      }
    }

    // Clean content (remove <think> tags)
    const cleanedContent = content ? content.replace(/<think>.*?<\/think>/gs, '').trim() : null;

    debugLog(
      `[GenericAgent] generateWithStreaming result: rawContent=${content.length} chars, cleanedContent=${cleanedContent?.length ?? 0} chars, toolCalls=${toolCalls.length}`
    );
    if (cleanedContent) {
      debugLog(
        `[GenericAgent] generateWithStreaming content preview: "${cleanedContent.slice(0, 200)}${cleanedContent.length > 200 ? '...' : ''}"`
      );
    }

    return {
      content: cleanedContent,
      toolCalls,
      finishReason: 'stop',
      usage,
    };
  }

  /**
   * Run the agent on a task.
   * Returns when completed, errored, or waiting for user input.
   */
  async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    // Reset abort state for new run
    this.aborted = false;

    // Emit started status
    this.emit({ type: 'agent_status', status: 'started', agentName: this.getEffectiveAgentName() });

    // Resume from user question or start fresh
    if (userResponse && this.waitingForUser) {
      // Check if there's an active planning session (from dispatch_agent)
      if (this.planningState?.active) {
        // Handle the planning response
        const planResult = await this.handlePlanningResponse(userResponse);
        const planResultObj = planResult as Record<string, unknown>;

        // Check if planning needs more input or is complete
        if (planResultObj['status'] === 'awaiting_verification') {
          // Still waiting for user - emit question and return
          this.waitingForUser = true;
          this.pendingQuestion = planResultObj['question'] as string;

          this.emit({
            type: 'question',
            question: planResultObj['question'] as string,
            isConfirmation: false,
            options: planResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: planResultObj['autoApproveTimeoutMs'] as number | undefined,
          });

          // Note: Plan is shown via ToolCallDisplay, don't duplicate in output
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: planResultObj['question'] as string,
            options: planResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: planResultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Planning is complete (approved, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Find the dispatch_agent tool call and add its result
        // The main agent will continue processing
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(planResult),
          toolCallId: 'planning-result',
          name: 'dispatch_agent',
        });

        // Emit status change back to thinking
        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.getEffectiveAgentName(),
        });
      } else if (this.contentState?.active) {
        // Handle the content creation response
        const contentResult = await this.handleContentResponse(userResponse);
        const contentResultObj = contentResult as Record<string, unknown>;

        // Check if content needs more input or is complete
        if (contentResultObj['status'] === 'awaiting_verification') {
          // Still waiting for user - emit question and return
          this.waitingForUser = true;
          this.pendingQuestion = contentResultObj['question'] as string;

          this.emit({
            type: 'question',
            question: contentResultObj['question'] as string,
            isConfirmation: false,
            options: contentResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: contentResultObj['autoApproveTimeoutMs'] as number | undefined,
          });

          // Content is shown via ToolCallDisplay
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: contentResultObj['question'] as string,
            options: contentResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: contentResultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Content creation is complete (approved, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Add the dispatch_content_agent result to messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(contentResult),
          toolCallId: 'content-result',
          name: 'dispatch_content_agent',
        });

        // Emit status change back to thinking
        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.getEffectiveAgentName(),
        });
      } else if (this.imageGenState?.active) {
        // Handle the image generation response
        const imageResult = await this.handleImageGenResponse(userResponse);
        const imageResultObj = imageResult as Record<string, unknown>;

        // Check if image gen needs more input or is complete
        if (imageResultObj['status'] === 'awaiting_prompt_approval') {
          // Still waiting for user - emit question and return
          this.waitingForUser = true;
          this.pendingQuestion = imageResultObj['question'] as string;

          this.emit({
            type: 'question',
            question: imageResultObj['question'] as string,
            isConfirmation: false,
            options: imageResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: imageResultObj['autoApproveTimeoutMs'] as number | undefined,
            context: imageResultObj['prompt'] as string,
          });

          // Prompt is shown in QuestionPrompt context
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: imageResultObj['question'] as string,
            options: imageResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: imageResultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Image generation is complete (generated, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Add the dispatch_image_agent result to messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(imageResult),
          toolCallId: 'image-gen-result',
          name: 'dispatch_image_agent',
        });

        // Emit status change back to thinking
        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.getEffectiveAgentName(),
        });
      } else if (this.videoGenState?.active) {
        // Handle the video generation response
        const videoResult = await this.handleVideoGenResponse(userResponse);
        const videoResultObj = videoResult as Record<string, unknown>;

        // Check if video gen needs more input or is complete
        if (videoResultObj['status'] === 'awaiting_approval') {
          // Still waiting for user - emit question and return
          this.waitingForUser = true;
          this.pendingQuestion = videoResultObj['question'] as string;

          this.emit({
            type: 'question',
            question: videoResultObj['question'] as string,
            isConfirmation: false,
            options: videoResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: videoResultObj['autoApproveTimeoutMs'] as number | undefined,
          });

          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: videoResultObj['question'] as string,
            options: videoResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: videoResultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Video generation is complete (generated, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Add the dispatch_video_agent result to messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(videoResult),
          toolCallId: 'video-gen-result',
          name: 'dispatch_video_agent',
        });

        // Emit status change back to thinking
        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.getEffectiveAgentName(),
        });
      } else {
        // Regular ask_user response
        this.handleUserResponse(userResponse);
        this.waitingForUser = false;
        this.pendingQuestion = undefined;
      }
    } else if (!this.waitingForUser) {
      // Start fresh - check if task is long and should be condensed
      let taskContent = task;
      if (shouldCondense(task)) {
        const label = generateContentLabel(task);
        const result = condenseUserInput(task);
        if (result.wasCondensed && result.variableName) {
          // Add to active context variables
          this.activeContextVariables.push({
            variableName: result.variableName,
            label,
            charCount: task.length,
          });
          taskContent = result.condensed;
          debugLog(
            `[GenericAgent] Condensed long user input (${task.length} chars) to ${result.variableName}`
          );
        }
      }

      // Start fresh - wrap user task in XML tags for structured prompts
      this.messages = [
        { role: 'system', content: this.buildSystemMessage() },
        { role: 'user', content: wrapUserTask(taskContent) },
      ];
      this.iteration = 0;
      this.recentToolCalls = []; // Reset loop detection
    }

    let finalOutput = '';

    // Main while(tool_use) loop
    while (this.iteration < this.maxIterations) {
      // Check for abort
      if (this.aborted) {
        return {
          status: 'interrupted',
          output: 'Execution stopped by user.',
          todos: this.todoManager.getTodos(),
          error: 'user_stopped',
        };
      }

      // Check for injected user input - add it to messages
      if (this.pendingUserInput) {
        let userInput = this.pendingUserInput;
        this.pendingUserInput = null;

        // Condense if long
        if (shouldCondense(userInput)) {
          const label = generateContentLabel(userInput);
          const result = condenseUserInput(userInput);
          if (result.wasCondensed && result.variableName) {
            this.activeContextVariables.push({
              variableName: result.variableName,
              label,
              charCount: userInput.length,
            });
            userInput = result.condensed;
            debugLog(`[GenericAgent] Condensed injected user input to ${result.variableName}`);
          }
        }

        // Add user input as a new message with XML tags
        this.messages.push({
          role: 'user',
          content: `<user_interjection>\n${userInput}\n</user_interjection>`,
        });

        // Emit event
        this.emit({
          type: 'agent_text',
          text: `User: ${userInput.slice(0, 200)}${userInput.length > 200 ? '...' : ''}`,
          isFinal: false,
        });
      }

      this.iteration++;

      // Emit thinking status
      this.emit({
        type: 'agent_status',
        status: 'thinking',
        agentName: this.getEffectiveAgentName(),
      });

      // Check if we need to compress context before making LLM call
      if (this.shouldCompressContext()) {
        await this.compressConversationHistory();
      }

      // Build messages with todo reminder injected
      const messagesWithReminder = this.injectTodoReminder();

      // Stream LLM response
      const response = await this.generateWithStreaming(
        messagesWithReminder,
        Array.from(this.tools.values())
      );

      // Track token usage for context window management
      if (response.usage) {
        this.tokenUsage.lastPromptTokens = response.usage.promptTokens;
        this.tokenUsage.lastCompletionTokens = response.usage.completionTokens;
        debugLog(
          `[GenericAgent] Token usage: prompt=${response.usage.promptTokens}, completion=${response.usage.completionTokens}, total=${response.usage.totalTokens}`
        );

        // Log context usage for phase-aware monitoring
        phaseLogger.contextUsage(
          'GenericAgent',
          response.usage.promptTokens,
          this.maxContextTokens
        );
      }

      // Add assistant message to history
      this.messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // If no tool calls, we're done
      if (response.toolCalls.length === 0) {
        finalOutput = response.content ?? '';
        break;
      }

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        // Special handling for ask_user - pause execution
        if (toolCall.name === 'ask_user' || toolCall.name === 'AskUserQuestion') {
          const result = this.handleAskUser(toolCall);
          if (result) {
            this.emit({
              type: 'agent_status',
              status: 'waiting',
              agentName: this.getEffectiveAgentName(),
            });
            return result;
          }
          continue;
        }

        // Execute the tool
        const result = await this.executeTool(toolCall);
        const resultObj = result as Record<string, unknown>;

        // Check if tool is waiting for user input (dispatch_agent planning)
        if (resultObj['__awaiting_user_input']) {
          // Return waiting status - the planning loop will handle user response
          // Note: Plan is shown via ToolCallDisplay, don't duplicate in output
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: resultObj['question'] as string,
            options: resultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: resultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Add tool result to messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: toolCall.id,
          name: toolCall.name,
        });
      }
    }

    // Check if max iterations reached
    if (this.iteration >= this.maxIterations) {
      this.emit({ type: 'agent_status', status: 'error', agentName: this.getEffectiveAgentName() });
      return {
        status: 'interrupted',
        output: 'Agent reached maximum iterations without completing.',
        todos: this.todoManager.getTodos(),
        error: 'max_iterations_reached',
      };
    }

    // Emit completed status
    this.emit({
      type: 'agent_status',
      status: 'completed',
      agentName: this.getEffectiveAgentName(),
    });
    this.emit({ type: 'agent_text', text: finalOutput, isFinal: true });

    return {
      status: 'completed',
      output: finalOutput,
      todos: this.todoManager.getTodos(),
    };
  }

  /**
   * Get the current todo list.
   */
  getTodos(): ExpandableTodoItem[] {
    return this.todoManager.getTodos();
  }

  /**
   * Check if agent is waiting for user input.
   */
  isWaiting(): boolean {
    return this.waitingForUser;
  }

  /**
   * Get the pending question if waiting.
   */
  getPendingQuestion(): string | undefined {
    return this.pendingQuestion;
  }

  /**
   * Detect if the agent is in a loop calling the same tool repeatedly.
   * Returns an object with warning message and severity if looping detected, null otherwise.
   */
  private detectLoop(
    toolName: string,
    args: Record<string, unknown>
  ): { message: string; isHardError: boolean } | null {
    // Create a signature for this tool call (tool + key args)
    const argSignature = JSON.stringify(args).slice(0, 100); // Limit to prevent huge signatures
    const signature = `${toolName}:${argSignature}`;

    // Add to recent calls
    this.recentToolCalls.push(signature);

    // Keep only the detection window
    if (this.recentToolCalls.length > GenericAgent.LOOP_DETECTION_WINDOW) {
      this.recentToolCalls.shift();
    }

    // Count occurrences of this exact call in the window
    const count = this.recentToolCalls.filter(s => s === signature).length;

    if (count >= GenericAgent.LOOP_THRESHOLD) {
      this.consecutiveLoopWarnings++;

      // After too many warnings, force stop
      if (this.consecutiveLoopWarnings >= GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS) {
        return {
          message:
            `LOOP BLOCKED: You've called ${toolName} with similar arguments ${count} times and ignored ` +
            `${this.consecutiveLoopWarnings} warnings. This tool call is being blocked. ` +
            `You MUST stop calling tools and provide a final response to the user.`,
          isHardError: true,
        };
      }

      return {
        message:
          `LOOP DETECTED (warning ${this.consecutiveLoopWarnings}/${GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS}): ` +
          `You've called ${toolName} with similar arguments ${count} times recently. ` +
          `This suggests you're stuck in a loop. Please either:\n` +
          `1. Complete the current task and stop (no more tool calls)\n` +
          `2. Use ask_user to get clarification\n` +
          `3. Try a different approach\n` +
          `After ${GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS} warnings, the tool will be blocked.`,
        isHardError: false,
      };
    }

    // Also check for rapid tool repetition (same tool called consecutively)
    const lastFew = this.recentToolCalls.slice(-4);
    const sameToolCount = lastFew.filter(s => s.startsWith(toolName + ':')).length;
    if (sameToolCount >= 4) {
      this.consecutiveLoopWarnings++;

      if (this.consecutiveLoopWarnings >= GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS) {
        return {
          message:
            `LOOP BLOCKED: You've called ${toolName} 4+ times in a row and ignored warnings. ` +
            `This tool call is being blocked. Provide a final response to the user.`,
          isHardError: true,
        };
      }

      return {
        message:
          `WARNING (${this.consecutiveLoopWarnings}/${GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS}): ` +
          `You've called ${toolName} 4 times in a row. ` +
          `If you're done with the task, stop calling tools and provide a final response.`,
        isHardError: false,
      };
    }

    // Reset consecutive warnings if this call is not triggering a loop
    this.consecutiveLoopWarnings = 0;
    return null;
  }

  /**
   * Execute a tool call with framework-enforced confirmation for complex tools.
   */
  private async executeTool(toolCall: ToolCall): Promise<unknown> {
    // Emit tool call event first (before any early returns)
    this.emit({
      type: 'tool_call',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      agentName: this.getEffectiveAgentName(),
    });

    // Check for looping (skip for think + TodoWrite - these may be called frequently)
    if (toolCall.name !== 'think' && !isBuiltinTodoTool(toolCall.name)) {
      const loopResult = this.detectLoop(toolCall.name, toolCall.arguments);
      if (loopResult) {
        const resultStatus = loopResult.isHardError ? 'loop_blocked' : 'loop_warning';
        const warningResult = {
          status: resultStatus,
          warning: loopResult.message,
          tool: toolCall.name,
          blocked: loopResult.isHardError,
        };
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: warningResult,
          isError: loopResult.isHardError,
          agentName: this.getEffectiveAgentName(),
        });
        return warningResult;
      }
    }

    // Handle built-in todo tools specially (no handler required)
    if (isBuiltinTodoTool(toolCall.name)) {
      const result = this.handleTodoTool(toolCall);
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle plan mode tools (Claude SDK style)
    if (isPlanModeTool(toolCall.name)) {
      const result = this.handlePlanModeTool(toolCall.name);
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle Task tool specially - unified subagent entrypoint (Claude SDK style)
    if (isTaskTool(toolCall.name)) {
      const result = await this.handleTask(toolCall);
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle dispatch_agent specially - spawn a sub-agent for planning
    if (toolCall.name === 'dispatch_agent') {
      const result = await this.handleDispatchAgent(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if planning needs user verification
      if (resultObj['status'] === 'awaiting_verification') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        const questionOptions = resultObj['options'] as Array<{
          label: string;
          description?: string;
        }>;
        const questionTimeout = resultObj['autoApproveTimeoutMs'] as number | undefined;
        debugLog(
          `[GenericAgent] dispatch_agent result: ${JSON.stringify(
            {
              status: resultObj['status'],
              question: (resultObj['question'] as string)?.slice(0, 50),
              optionsCount: questionOptions?.length,
              options: questionOptions,
              autoApproveTimeoutMs: questionTimeout,
            },
            null,
            2
          )}`
        );
        debugLog(
          `[GenericAgent] dispatch_agent emitting question event with options: ${JSON.stringify(questionOptions)}`
        );
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: questionOptions,
          autoApproveTimeoutMs: questionTimeout,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        return { __awaiting_user_input: true, ...resultObj };
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle generate_content - deterministic content generation with automatic context injection
    if (toolCall.name === 'generate_content') {
      const args = toolCall.arguments;
      const contentType = args['content_type'] as string;
      const name = args['name'] as string | undefined;
      const taskDescription = args['task_description'] as string | undefined;

      if (!contentType) {
        return { error: 'content_type is required for generate_content' };
      }

      // Get the required contexts for this content type
      const requiredContexts = CONTENT_TYPE_CONTEXTS[contentType] || [];
      debugLog(
        `[GenericAgent] generate_content: content_type=${contentType}, required_contexts=${requiredContexts.join(', ')}`
      );

      // Build the output file path
      let outputFile = CONTENT_TYPE_OUTPUT_FILES[contentType] || `plans/${contentType}.md`;
      if ((contentType === 'character' || contentType === 'setting') && name) {
        // For character/setting, append the name to the directory path
        const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        outputFile = `${outputFile.replace(/\/$/, '')}/${safeName}.md`;
      }

      // Build the task description
      const task =
        taskDescription ||
        (name ? `Create ${contentType} profile for: ${name}` : `Create ${contentType} content`);

      // Create a synthetic tool call for handleDispatchContentAgent
      const syntheticToolCall: ToolCall = {
        id: toolCall.id,
        name: 'dispatch_content_agent',
        arguments: {
          task,
          content_type: contentType,
          context_refs: requiredContexts,
          output_file: outputFile,
        },
      };

      debugLog(
        `[GenericAgent] generate_content dispatching with context_refs: ${JSON.stringify(requiredContexts)}`
      );
      const result = await this.handleDispatchContentAgent(syntheticToolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if content needs user verification
      if (resultObj['status'] === 'awaiting_verification') {
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        const questionOptions = resultObj['options'] as Array<{
          label: string;
          description?: string;
        }>;
        const questionTimeout = resultObj['autoApproveTimeoutMs'] as number | undefined;
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: questionOptions,
          autoApproveTimeoutMs: questionTimeout,
        });

        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        return { __awaiting_user_input: true, ...resultObj };
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle dispatch_content_agent specially - spawn a sub-agent for creative content
    if (toolCall.name === 'dispatch_content_agent') {
      const result = await this.handleDispatchContentAgent(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if content needs user verification
      if (resultObj['status'] === 'awaiting_verification') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        const questionOptions = resultObj['options'] as Array<{
          label: string;
          description?: string;
        }>;
        const questionTimeout = resultObj['autoApproveTimeoutMs'] as number | undefined;
        debugLog(
          `[GenericAgent] dispatch_content_agent emitting question event with options: ${JSON.stringify(questionOptions)}`
        );
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: questionOptions,
          autoApproveTimeoutMs: questionTimeout,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        return { __awaiting_user_input: true, ...resultObj };
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle dispatch_image_agent specially - sub-agent for image prompt crafting + generation
    if (toolCall.name === 'dispatch_image_agent') {
      const result = await this.handleDispatchImageAgent(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if image gen needs user verification
      if (resultObj['status'] === 'awaiting_prompt_approval') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: resultObj['options'] as Array<{ label: string; description?: string }>,
          autoApproveTimeoutMs: resultObj['autoApproveTimeoutMs'] as number | undefined,
          context: resultObj['prompt'] as string,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        return { __awaiting_user_input: true, ...resultObj };
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle dispatch_video_agent specially - sub-agent for video generation
    if (toolCall.name === 'dispatch_video_agent') {
      const result = await this.handleDispatchVideoAgent(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if video gen needs user verification
      if (resultObj['status'] === 'awaiting_approval') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: resultObj['options'] as Array<{ label: string; description?: string }>,
          autoApproveTimeoutMs: resultObj['autoApproveTimeoutMs'] as number | undefined,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        return { __awaiting_user_input: true, ...resultObj };
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    const tool = this.tools.get(toolCall.name);
    if (!tool?.handler) {
      const errorResult = { error: `Unknown tool: ${toolCall.name}` };
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: errorResult,
        isError: true,
        agentName: this.getEffectiveAgentName(),
      });
      return errorResult;
    }

    // Framework-enforced confirmation for complex tools
    if (isComplexTool(toolCall.name)) {
      if (!this.pendingConfirmations.has(toolCall.name)) {
        // First call - store args and return "needs confirmation"
        this.pendingConfirmations.set(toolCall.name, toolCall.arguments);
        const confirmResult = {
          status: 'needs_confirmation',
          tool: toolCall.name,
          args: toolCall.arguments,
          message: `Call ask_user(is_confirmation=true) to confirm ${toolCall.name}, then call again.`,
        };
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: confirmResult,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });
        return confirmResult;
      } else {
        // Second call after confirmation - execute and clear pending
        this.pendingConfirmations.delete(toolCall.name);
      }
    }

    // Execute the tool handler
    try {
      const result = await Promise.resolve(tool.handler(toolCall.arguments));

      // Check for phase transition info in result and emit event
      const resultObj = result as Record<string, unknown> | null;
      if (resultObj && typeof resultObj === 'object' && '_phaseTransition' in resultObj) {
        const phaseTransition = resultObj['_phaseTransition'] as {
          fromPhase: string;
          toPhase: string;
          displayName?: string;
          description?: string;
        };
        this.emit({
          type: 'phase_transition',
          fromPhase: phaseTransition.fromPhase,
          toPhase: phaseTransition.toPhase,
          displayName: phaseTransition.displayName,
          description: phaseTransition.description,
        });
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    } catch (error) {
      const errorResult = { error: String(error), tool: toolCall.name };
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: errorResult,
        isError: true,
        agentName: this.getEffectiveAgentName(),
      });
      return errorResult;
    }
  }

  /**
   * Handle Task tool - launches a subagent by subagent_type.
   * For now, maps to existing internal sub-agent handlers so we can migrate incrementally.
   */
  private async handleTask(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const subagentType = args['subagent_type'] as string | undefined;

    if (!subagentType) {
      return { error: 'Task requires subagent_type' };
    }

    // Incremental compatibility mapping onto existing sub-agent handlers.
    if (subagentType === 'Plan') {
      return await this.handleDispatchAgent({
        ...toolCall,
        name: 'dispatch_agent',
      });
    }

    if (subagentType === 'content-creator') {
      return await this.handleDispatchContentAgent({
        ...toolCall,
        name: 'dispatch_content_agent',
      });
    }

    if (subagentType === 'image-generator') {
      return await this.handleDispatchImageAgent({
        ...toolCall,
        name: 'dispatch_image_agent',
      });
    }

    if (subagentType === 'video-assembler') {
      return await this.handleDispatchVideoAgent({
        ...toolCall,
        name: 'dispatch_video_agent',
      });
    }

    return { error: `Unsupported subagent_type: ${subagentType}` };
  }

  private handlePlanModeTool(toolName: string): Record<string, unknown> {
    if (toolName === 'EnterPlanMode') {
      this.planModeActive = true;
      this.currentMode = 'planning';
      return { status: 'entered_plan_mode' };
    }

    // ExitPlanMode
    this.planModeActive = false;
    this.currentMode = 'orchestrator';
    return { status: 'exited_plan_mode' };
  }

  /**
   * Handle built-in todo management tool.
   */
  private handleTodoTool(toolCall: ToolCall): unknown {
    const args = toolCall.arguments;
    const merge = (args['merge'] as boolean | undefined) ?? false;
    const todos = (args['todos'] as Array<Record<string, unknown>> | undefined) ?? [];

    // Claude SDK guidance: never create single-item todo lists.
    if (todos.length < 2) {
      return {
        error:
          'Never create single-item todo lists. If you only have one task, just do it directly.',
      };
    }

    // Check for tool call patterns in todo content (forbidden)
    const toolCallPatterns = [
      /\b(dispatch_\w+|update_project|read_project|write_file|read_file|todo_write|TodoWrite|ask_user|AskUserQuestion)\b/i,
      /\baction:\s*["']?\w+["']?/i,
      /\buse\s+(the\s+)?[\w_]+\s+tool/i,
      /\bcall\s+[\w_]+/i,
    ];

    for (const todo of todos) {
      const content = (todo['content'] as string) || '';
      for (const pattern of toolCallPatterns) {
        if (pattern.test(content)) {
          return {
            error: `Todo "${content.slice(0, 50)}..." contains tool/function references. Todos should describe WHAT to accomplish, not HOW.`,
            suggestion:
              'Rewrite todos to be task-focused. Good: "Create character profile for Alice". Bad: "Use dispatch_content_agent to create Alice".',
          };
        }
      }
    }

    // Apply todo updates.
    // - merge=false: replace list (preserving any existing completed items via manager logic)
    // - merge=true: merge by id onto existing items
    const result = merge
      ? this.todoManager.mergeTodosById(todos)
      : this.todoManager.writeTodos(todos);

    const updatedTodos = this.todoManager.getTodos();
    debugLog(
      `[GenericAgent] handleTodoTool: merge=${merge}, inputTodos=${todos.length}, resultTodos=${updatedTodos.length}`
    );
    debugLog(
      `[GenericAgent] handleTodoTool emitting todo_update with ${updatedTodos.length} todos: ${JSON.stringify(updatedTodos.map(t => ({ id: t.id, status: t.status, content: t.content?.slice(0, 30) })))}`
    );

    // Emit todo update event
    this.emit({
      type: 'todo_update',
      todos: updatedTodos,
      agentName: this.getEffectiveAgentName(),
    });

    return result;
  }

  // State for dispatch_agent sub-agent planning loop
  private planningState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentPlan: string;
    iterations: number;
    /** Tool call ID for streaming events */
    toolCallId: string;
  } | null = null;

  // State for dispatch_content_agent sub-agent (creative content generation)
  private contentState: {
    active: boolean;
    task: string;
    contentType: ContentType;
    context?: string;
    outputFile?: string;
    messages: Message[];
    currentContent: string;
    iterations: number;
    /** Tool call ID for streaming events */
    toolCallId: string;
  } | null = null;

  // State for dispatch_image_agent sub-agent (image prompt planning + generation)
  private imageGenState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentPrompt: string;
    negativePrompt: string;
    aspectRatio: string;
    iterations: number;
    /** Parameters passed from parent for generate_image */
    imageParams: {
      scene_number: number;
      image_type?: 'scene' | 'character_ref' | 'setting_ref';
      character_name?: string;
      setting_name?: string;
    };
    /** Reference images for consistency (used for scene generation) */
    referenceImages?: Array<{
      image_id: string;
      type: 'character' | 'setting';
      name: string;
    }>;
    /** Generation mode determined by image_type and reference availability */
    generationMode: 'text_to_image' | 'image_text_to_image';
    /** Tool call ID for streaming events */
    toolCallId: string;
  } | null = null;

  // State for dispatch_video_agent sub-agent (video generation)
  private videoGenState: {
    active: boolean;
    task: string;
    sceneNumber: number;
    sceneImageArtifactId: string;
    motionDescription?: string;
    context?: string;
    messages: Message[];
    currentParams: {
      duration: number;
      fps: number;
      motionStrength: number;
    };
    iterations: number;
  } | null = null;

  /**
   * Handle dispatch_agent tool - spawns a sub-agent for planning.
   * The sub-agent handles the full plan verification loop with the user.
   * It keeps iterating until the user approves the plan.
   */
  private async handleDispatchAgent(toolCall: ToolCall): Promise<unknown> {
    // Set mode for UI display
    this.currentMode = 'planning';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_agent' };
    }

    // Resolve all context_refs into a combined context
    const contextParts: Array<{ variableName: string; label: string; content: string }> = [];

    if (contextRefs && contextRefs.length > 0) {
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push({
            variableName: ref,
            label: stored.label,
            content: stored.content,
          });
          debugLog(
            `[GenericAgent] Resolved context_ref ${ref} for planning agent (${stored.label}, ${stored.content.length} chars)`
          );
        } else {
          debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
        }
      }
    }

    // Build combined context with clear sections
    let context: string | undefined;
    if (contextParts.length > 0) {
      context = contextParts
        .map(part => `## ${part.variableName} (${part.label})\n\n${part.content}`)
        .join('\n\n---\n\n');
      debugLog(
        `[GenericAgent] Combined ${contextParts.length} contexts for planning agent (${context.length} chars total)`
      );
    }

    // Check if we're resuming an existing planning session
    if (this.planningState?.active) {
      // This shouldn't happen - dispatch_agent shouldn't be called while planning is active
      return { error: 'Planning already in progress' };
    }

    // Initialize planning state with imported prompt
    const planningSystemPrompt = buildPlanningPrompt(task, context);

    this.planningState = {
      active: true,
      task,
      context,
      messages: [
        { role: 'system', content: planningSystemPrompt },
        { role: 'user', content: '<request>\nCreate an initial plan for this task.\n</request>' },
      ],
      currentPlan: '',
      iterations: 0,
      toolCallId: toolCall.id,
    };

    // Generate the initial plan
    return this.continuePlanningLoop();
  }

  /**
   * Continue the planning loop - generates plan and asks for user verification.
   */
  private async continuePlanningLoop(): Promise<unknown> {
    if (!this.planningState) {
      return { error: 'No active planning session' };
    }

    const maxIterations = 10;

    if (this.planningState.iterations >= maxIterations) {
      const result = {
        status: 'max_iterations',
        plan: this.planningState.currentPlan,
        task: this.planningState.task,
        message: 'Reached maximum iterations for plan refinement. Using the last version.',
      };
      this.planningState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    this.planningState.iterations++;

    try {
      // Generate or refine the plan with streaming
      let planContent = '';
      let isFirstChunk = true;
      debugLog(
        `[GenericAgent] continuePlanningLoop starting generation, toolCallId=${this.planningState.toolCallId}`
      );

      // If this is a subsequent iteration (after feedback), we need to reset the streaming display
      const shouldReset = this.planningState.iterations > 1;

      for await (const chunk of this.llm.generateStream({
        messages: this.planningState.messages,
        temperature: 0.7,
      })) {
        if (chunk.content) {
          planContent += chunk.content;
          debugLog(
            `[GenericAgent] tool_streaming emit: chunk=${chunk.content.length} chars, total=${planContent.length} chars`
          );
          // Emit tool_streaming to show content inside the ToolCallDisplay
          // On first chunk of a regeneration, include reset flag to clear old content and show display
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.planningState.toolCallId,
            chunk: chunk.content,
            done: false,
            agentName: this.getEffectiveAgentName(),
            toolName: 'dispatch_agent',
            reset: shouldReset && isFirstChunk,
          });
          isFirstChunk = false;
        }
        if (chunk.done) {
          debugLog(
            `[GenericAgent] tool_streaming DONE: total planContent=${planContent.length} chars`
          );
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.planningState.toolCallId,
            chunk: '',
            done: true,
            agentName: this.getEffectiveAgentName(),
          });
        }
      }

      this.planningState.currentPlan = planContent.trim() || 'No plan generated';

      // Add assistant response to history
      this.planningState.messages.push({
        role: 'assistant',
        content: this.planningState.currentPlan,
      });

      // Note: Plan is displayed via ToolCallDisplay when the tool result is rendered
      // No need to emit agent_text here as it would cause duplicate display

      // Return status indicating we need user verification
      // The main agent will pause and wait for user input
      const verificationQuestion =
        this.planningState.iterations === 1
          ? "I've created a plan for this task. Would you like to proceed or provide feedback?"
          : "I've updated the plan based on your feedback. Would you like to proceed or provide more feedback?";

      const verificationResult = {
        status: 'awaiting_verification',
        plan: this.planningState.currentPlan,
        task: this.planningState.task,
        iterations: this.planningState.iterations,
        question: verificationQuestion,
        options: [
          { label: 'Accept plan', description: 'Proceed with this plan and start execution' },
          { label: 'Provide feedback', description: 'Modify the plan with your input' },
        ],
        autoApproveTimeoutMs: 15000, // 15 seconds countdown for plan approval
      };
      debugLog(
        `[GenericAgent] continuePlanningLoop returning: ${JSON.stringify(
          {
            status: verificationResult.status,
            question: verificationResult.question?.slice(0, 50),
            optionsCount: verificationResult.options.length,
            options: verificationResult.options,
            autoApproveTimeoutMs: verificationResult.autoApproveTimeoutMs,
          },
          null,
          2
        )}`
      );
      return verificationResult;
    } catch (error) {
      const failedTask = this.planningState?.task;
      this.planningState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Planning failed: ${String(error)}`,
        task: failedTask,
      };
    }
  }

  /**
   * Handle user response to planning verification.
   * Uses LLM to classify whether the response is approval or feedback.
   */
  async handlePlanningResponse(userResponse: string): Promise<unknown> {
    if (!this.planningState) {
      return { error: 'No active planning session' };
    }

    // Use LLM to classify the user's intent
    const isApproval = await this.classifyPlanResponse(userResponse);

    if (isApproval) {
      // Generate plan name and summary using LLM
      const { name, summary } = await this.generatePlanMetadata(
        this.planningState.task,
        this.planningState.currentPlan
      );

      // Store full plan in external context file
      const { variableName } = contextStore.store(this.planningState.currentPlan, name, {
        source: 'tool',
        variableBaseName: 'plan',
      });

      const result = {
        status: 'approved',
        name,
        summary,
        plan_ref: variableName,
        task: this.planningState.task,
        iterations: this.planningState.iterations,
        message: `Plan "${name}" approved. Summary: ${summary}\n\nTo read the full plan, use fetch_context with ${variableName}.`,
        next_steps:
          'IMPORTANT: Now update the project state - call update_project to: 1) Set planner stage to "complete", 2) Mark the current phase as "completed", 3) Transition to the next phase.',
      };
      this.planningState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    // User wants to provide feedback - use their input directly with XML tags
    this.planningState.messages.push({
      role: 'user',
      content: `<user_feedback>\n${userResponse}\n</user_feedback>\n\n<request>\nPlease revise the plan based on the feedback above.\n</request>`,
    });

    // Continue the planning loop
    return this.continuePlanningLoop();
  }

  /**
   * Use LLM to classify whether user response indicates approval or feedback.
   */
  private async classifyPlanResponse(userResponse: string): Promise<boolean> {
    const normalized = userResponse.toLowerCase().trim();
    const directApprove = [
      'accept',
      'accept content',
      'approve',
      'approve content',
      'yes',
      'ok',
      'okay',
      'proceed',
      'go ahead',
      'start',
      'continue',
      'lgtm',
      '1',
    ];
    if (directApprove.some(value => normalized === value)) {
      return true;
    }
    const directFeedback = ['provide feedback', 'feedback', '2', 'no', 'not yet'];
    if (directFeedback.some(value => normalized === value)) {
      return false;
    }

    // Load classification prompt from file
    const classificationPrompt = loadAndRenderMarkdown('system/classification/plan-approval.md', {
      user_response: userResponse,
    });

    try {
      const response = await this.llm.generate({
        messages: [{ role: 'user', content: classificationPrompt }],
        temperature: 0,
        maxTokens: 10,
      });

      const result = (response.content ?? '').trim().toUpperCase();
      return result.includes('APPROVE');
    } catch {
      // On error, fall back to simple pattern matching
      const lower = userResponse.toLowerCase().trim();
      const approvalPatterns = [
        'yes',
        'ok',
        'okay',
        'proceed',
        'accept',
        'approve',
        'go',
        'start',
        'continue',
        'lgtm',
        'y',
        '1',
      ];
      return approvalPatterns.some(p => lower === p || lower.includes(p));
    }
  }

  /**
   * Generate a name and summary for an approved plan.
   * The summary is injected into message history; full plan is stored externally.
   */
  private async generatePlanMetadata(
    task: string,
    plan: string
  ): Promise<{ name: string; summary: string }> {
    const prompt = `Given this planning task and the resulting plan, generate:
1. A short descriptive name (3-5 words, no quotes)
2. A 1-2 sentence summary that captures the key steps and can be used to remember what the plan contains

<task>${task}</task>

<plan>${plan}</plan>

Respond in JSON format:
{"name": "...", "summary": "..."}`;

    try {
      const response = await this.llm.generate({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 200,
      });

      return JSON.parse(response.content ?? '{}');
    } catch {
      return {
        name: task.slice(0, 50),
        summary: `Plan for: ${task}`,
      };
    }
  }

  /**
   * Generate a name and summary for approved content.
   * The summary is injected into message history; full content is stored externally.
   */
  private async generateContentMetadata(
    task: string,
    contentType: string,
    content: string
  ): Promise<{ name: string; summary: string }> {
    const prompt = `Given this content creation task, content type, and the resulting content, generate:
1. A short descriptive name (3-5 words, no quotes)
2. A 1-2 sentence summary that captures the essence of the content and can be used to remember what it contains

<task>${task}</task>
<content_type>${contentType}</content_type>

<content>${content.slice(0, 3000)}${content.length > 3000 ? '...[truncated]' : ''}</content>

Respond in JSON format:
{"name": "...", "summary": "..."}`;

    try {
      const response = await this.llm.generate({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 200,
      });

      return JSON.parse(response.content ?? '{}');
    } catch {
      return {
        name: `${contentType}: ${task.slice(0, 30)}`,
        summary: `${contentType} content for: ${task.slice(0, 100)}`,
      };
    }
  }

  /**
   * Check if there's an active planning session awaiting user input.
   */
  isPlanningActive(): boolean {
    return this.planningState?.active ?? false;
  }

  /**
   * Check if there's an active content creation session awaiting user input.
   */
  isContentActive(): boolean {
    return this.contentState?.active ?? false;
  }

  /**
   * Try to resolve a context reference from project files.
   * This is a fallback when the context isn't found in the context store.
   * Supports both variable names ($plan) and direct file paths (plans/story.md).
   */
  private tryResolveFromProjectFiles(
    ref: string
  ): { label: string; content: string; file: string } | null {
    // Map of context ref patterns to project file paths
    const projectFileMap: Record<string, { file: string; label: string }> = {
      $plan: { file: 'plans/story.md', label: 'Story Plan' },
      $plot: { file: 'plans/plot.md', label: 'Plot' },
      $story: { file: 'plans/story.md', label: 'Story' },
      $scenes: { file: 'plans/scenes.md', label: 'Scenes' },
      $images: { file: 'plans/images.md', label: 'Images Plan' },
      $video: { file: 'plans/video.md', label: 'Video Plan' },
      $original_input: { file: 'original_input.md', label: 'Original Input' },
    };

    const projectDir = path.join(process.cwd(), '.kshana');

    // Check if ref is a direct file path (e.g., "plans/story.md")
    if (ref.includes('/') || ref.endsWith('.md')) {
      const filePath = path.join(projectDir, ref);
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.trim().length > 0) {
            // Generate label from filename
            const filename = path.basename(ref, '.md');
            const label = filename.charAt(0).toUpperCase() + filename.slice(1);
            return {
              label: label,
              content: content,
              file: ref,
            };
          }
        }
      } catch {
        // File read failed, continue to variable name lookup
      }
    }

    // Try to match the ref as a variable name (ignore numeric suffixes like $plan_2)
    const baseRef = ref.replace(/_\d+$/, '');
    const mapping = projectFileMap[baseRef] || projectFileMap[ref];

    if (!mapping) {
      return null;
    }

    // Try to read from project directory
    const filePath = path.join(projectDir, mapping.file);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.trim().length > 0) {
          return {
            label: mapping.label,
            content: content,
            file: mapping.file,
          };
        }
      }
    } catch {
      // File read failed, return null
    }

    return null;
  }

  /**
   * Handle dispatch_content_agent tool - spawns a sub-agent for creative content generation.
   * Unlike dispatch_agent (for technical planning), this creates actual creative content
   * like stories, character descriptions, and scene narratives.
   */
  private async handleDispatchContentAgent(toolCall: ToolCall): Promise<unknown> {
    // Set mode for UI display
    this.currentMode = 'content';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contentType = args['content_type'] as ContentType;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_content_agent' };
    }

    if (!contentType) {
      this.currentMode = 'orchestrator';
      return { error: 'No content_type provided for dispatch_content_agent' };
    }

    // Validate content_type is one of the allowed types
    const validContentTypes = ['plot', 'story', 'character', 'setting', 'scene', 'narration'];
    if (!validContentTypes.includes(contentType)) {
      this.currentMode = 'orchestrator';
      return {
        error: `Invalid content_type "${contentType}". Must be one of: ${validContentTypes.join(', ')}`,
        suggestion:
          'Use the appropriate content_type for your task. For example, use "character" for character profiles, "scene" for scene descriptions.',
      };
    }

    // ==========================================================================
    // PULL-BASED CONTEXT DISCOVERY
    // Instead of requiring exact variable names, we use label-based search
    // to find relevant context. This prevents silent failures from name mismatches.
    // ==========================================================================

    const contextParts: Array<{ variableName: string; label: string; content: string }> = [];
    const missingRefs: string[] = [];

    // Configuration for what context patterns are relevant to each content type
    const CONTENT_TYPE_LABEL_PATTERNS: Record<string, { required: string[]; optional: string[] }> = {
      plot: {
        required: ['original', 'input', 'user'],
        optional: [],
      },
      story: {
        required: ['original', 'input', 'plot'],
        optional: ['user'],
      },
      character: {
        // Priority order: look for full story/chapter content first
        required: ['full_story', 'full story', 'story', 'chapter', 'narrative'],
        optional: ['plot', 'original'],
      },
      setting: {
        // Priority order: look for full story/chapter content first
        required: ['full_story', 'full story', 'story', 'chapter', 'narrative'],
        optional: ['plot', 'original'],
      },
      scene: {
        required: ['full_story', 'story', 'chapter'],
        optional: ['character', 'setting', 'plot'],
      },
      narration: {
        required: ['story', 'scene'],
        optional: ['character', 'setting'],
      },
    };

    // Helper function to add context without duplicates
    const addContextPart = (variableName: string, label: string, content: string) => {
      if (!contextParts.some(p => p.variableName === variableName)) {
        contextParts.push({ variableName, label, content });
        return true;
      }
      return false;
    };

    // STEP 1: Try to resolve explicitly provided context_refs (backward compatibility)
    if (contextRefs && contextRefs.length > 0) {
      for (const ref of contextRefs) {
        // First try exact variable name match
        const stored = contextStore.get(ref);
        if (stored) {
          if (addContextPart(ref, stored.label, stored.content)) {
            debugLog(
              `[GenericAgent] Resolved context_ref ${ref} by exact match (${stored.label}, ${stored.content.length} chars)`
            );
          }
        } else {
          // Try to resolve from project files
          const projectFileContent = this.tryResolveFromProjectFiles(ref);
          if (projectFileContent) {
            if (addContextPart(ref, projectFileContent.label, projectFileContent.content)) {
              debugLog(
                `[GenericAgent] Resolved context_ref ${ref} from project file: ${projectFileContent.file}`
              );
            }
          } else {
            // FALLBACK: Try label-based search for this ref
            // Extract search pattern from the ref (e.g., "$full_story" -> "story", "$chapter_1" -> "chapter")
            const refPattern = ref.replace(/^\$/, '').replace(/_\d+$/, '').replace(/_/g, ' ');
            const labelMatches = contextStore.searchByLabelWithContent(refPattern);
            if (labelMatches.length > 0) {
              const bestMatch = labelMatches[0]!;
              if (addContextPart(bestMatch.variableName, bestMatch.label, bestMatch.content)) {
                debugLog(
                  `[GenericAgent] Resolved context_ref ${ref} via LABEL SEARCH (pattern: "${refPattern}") -> ${bestMatch.variableName} (${bestMatch.label})`
                );
              }
            } else {
              debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
              missingRefs.push(ref);
            }
          }
        }
      }
    }

    // STEP 2: Auto-discover relevant context if none was found or refs were incomplete
    // This is the PULL model - we automatically find what the content agent needs
    const patterns = CONTENT_TYPE_LABEL_PATTERNS[contentType];
    if (patterns) {
      // Search for required context patterns
      for (const pattern of patterns.required) {
        const matches = contextStore.searchByLabelWithContent(pattern);
        for (const match of matches) {
          if (addContextPart(match.variableName, match.label, match.content)) {
            debugLog(
              `[GenericAgent] AUTO-DISCOVERED context via required pattern "${pattern}": ${match.variableName} (${match.label})`
            );
          }
        }
      }

      // Search for optional context patterns if we have few contexts
      if (contextParts.length < 3) {
        for (const pattern of patterns.optional) {
          const matches = contextStore.searchByLabelWithContent(pattern);
          for (const match of matches) {
            if (addContextPart(match.variableName, match.label, match.content)) {
              debugLog(
                `[GenericAgent] AUTO-DISCOVERED context via optional pattern "${pattern}": ${match.variableName} (${match.label})`
              );
            }
          }
        }
      }
    }

    // STEP 3: Legacy fallback for plot phase (kept for backward compatibility)
    if (contextParts.length === 0 && contentType === 'plot') {
      const originalInput = contextStore.get('$original_input');
      if (originalInput) {
        addContextPart('$original_input', originalInput.label, originalInput.content);
        debugLog(
          `[GenericAgent] LEGACY FALLBACK: Injected $original_input for plot phase (${originalInput.content.length} chars)`
        );
      } else {
        debugLog(
          `[GenericAgent] WARNING: No context found for plot creation`
        );
      }
    }

    // Log summary of context discovery
    if (contextParts.length > 0) {
      debugLog(
        `[GenericAgent] Context discovery complete: found ${contextParts.length} contexts for ${contentType} creation: ${contextParts.map(p => `${p.variableName} (${p.label})`).join(', ')}`
      );
    } else {
      debugLog(`[GenericAgent] WARNING: No context found for ${contentType} creation`);
      debugLog(
        `[GenericAgent] Available context variables: ${
          contextStore
            .list()
            .map(c => `${c.variableName} (${c.label})`)
            .join(', ') || 'none'
        }`
      );
    }

    // Log missing refs for debugging (but they may have been resolved via label search)
    if (missingRefs.length > 0) {
      debugLog(`[GenericAgent] Note: Some context_refs were not found by exact match: ${missingRefs.join(', ')}`);
    }

    // Validate context usage: warn if $original_input is used for characters/settings
    // The approved $story should be used instead for consistency
    const usesOriginalInput = contextRefs?.some(ref => ref === '$original_input');
    const isCharacterOrSetting = contentType === 'character' || contentType === 'setting';
    if (usesOriginalInput && isCharacterOrSetting) {
      debugLog(
        `[GenericAgent] WARNING: Using $original_input for ${contentType} creation. Consider using $story instead for approved content.`
      );
      // Return a warning but allow execution to continue (soft validation)
      const storyAvailable =
        contextStore.get('$story') || this.tryResolveFromProjectFiles('$story');
      if (storyAvailable) {
        return {
          warning: `You are using $original_input for ${contentType} creation, but $story is available. Characters and settings should be extracted from the APPROVED STORY content, not the original input. Please use context_refs: ["$story"] instead.`,
          suggestion:
            'Update your Task call to use context_refs: ["$story"] for character and setting creation.',
        };
      }
    }

    // Build combined context with clear sections
    let context: string | undefined;
    if (contextParts.length > 0) {
      context = contextParts
        .map(part => `## ${part.variableName} (${part.label})\n\n${part.content}`)
        .join('\n\n---\n\n');
      debugLog(
        `[GenericAgent] Combined ${contextParts.length} contexts for content agent (${context.length} chars total)`
      );
    }

    // Check if we're resuming an existing content session
    if (this.contentState?.active) {
      return { error: 'Content creation already in progress' };
    }

    // Initialize content state with content prompt
    const contentSystemPrompt = buildContentPrompt(task, contentType, context);

    this.contentState = {
      active: true,
      task,
      contentType,
      context,
      outputFile,
      messages: [
        { role: 'system', content: contentSystemPrompt },
        {
          role: 'user',
          content: `<request>\nCreate the ${contentType} content for this task.\n</request>`,
        },
      ],
      currentContent: '',
      iterations: 0,
      toolCallId: toolCall.id,
    };

    // Generate the initial content
    return this.continueContentLoop();
  }

  /**
   * Continue the content creation loop - generates content and asks for user verification.
   */
  private async continueContentLoop(): Promise<unknown> {
    if (!this.contentState) {
      return { error: 'No active content session' };
    }

    const maxIterations = 10;

    if (this.contentState.iterations >= maxIterations) {
      const result = {
        status: 'max_iterations',
        content: this.contentState.currentContent,
        content_type: this.contentState.contentType,
        task: this.contentState.task,
        output_file: this.contentState.outputFile,
        message: 'Reached maximum iterations for content refinement. Using the last version.',
      };
      this.contentState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    this.contentState.iterations++;

    try {
      // Generate or refine the content with streaming
      let content = '';
      let isFirstChunk = true;

      // If this is a subsequent iteration (after feedback), we need to reset the streaming display
      const shouldReset = this.contentState.iterations > 1;

      for await (const chunk of this.llm.generateStream({
        messages: this.contentState.messages,
        temperature: 0.8, // Slightly higher temperature for creative content
      })) {
        if (chunk.content) {
          content += chunk.content;
          // Emit tool_streaming to show content inside the ToolCallDisplay
          // On first chunk of a regeneration, include reset flag to clear old content and show display
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.contentState.toolCallId,
            chunk: chunk.content,
            done: false,
            agentName: this.getEffectiveAgentName(),
            toolName: 'dispatch_content_agent',
            reset: shouldReset && isFirstChunk,
          });
          isFirstChunk = false;
        }
        if (chunk.done) {
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.contentState.toolCallId,
            chunk: '',
            done: true,
            agentName: this.getEffectiveAgentName(),
          });
        }
      }

      this.contentState.currentContent = content.trim() || 'No content generated';

      // Add assistant response to history
      this.contentState.messages.push({
        role: 'assistant',
        content: this.contentState.currentContent,
      });

      // Return status indicating we need user verification
      const verificationQuestion =
        this.contentState.iterations === 1
          ? `I've created the ${this.contentState.contentType} content. Would you like to accept it or provide feedback?`
          : `I've updated the ${this.contentState.contentType} content based on your feedback. Would you like to accept it or provide more feedback?`;

      const verificationResult = {
        status: 'awaiting_verification',
        content: this.contentState.currentContent,
        content_type: this.contentState.contentType,
        task: this.contentState.task,
        output_file: this.contentState.outputFile,
        iterations: this.contentState.iterations,
        question: verificationQuestion,
        options: [
          { label: 'Accept content', description: 'Approve this content and proceed' },
          { label: 'Provide feedback', description: 'Request changes to the content' },
        ],
        autoApproveTimeoutMs: 15000, // 15 seconds countdown for content approval
      };
      debugLog(
        `[GenericAgent] continueContentLoop returning: ${JSON.stringify(
          {
            status: verificationResult.status,
            contentType: verificationResult.content_type,
            question: verificationResult.question?.slice(0, 50),
            optionsCount: verificationResult.options.length,
          },
          null,
          2
        )}`
      );
      return verificationResult;
    } catch (error) {
      const failedTask = this.contentState?.task;
      this.contentState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Content creation failed: ${String(error)}`,
        task: failedTask,
      };
    }
  }

  /**
   * Handle user response to content verification.
   * Uses LLM to classify whether the response is approval or feedback.
   */
  async handleContentResponse(userResponse: string): Promise<unknown> {
    if (!this.contentState) {
      return { error: 'No active content session' };
    }

    // Use LLM to classify the user's intent (reuse same classification logic as planning)
    const isApproval = await this.classifyPlanResponse(userResponse);

    if (isApproval) {
      // Write content to output file if specified
      let fileSaved = false;
      if (this.contentState.outputFile) {
        try {
          const projectDir = path.join(process.cwd(), '.kshana');
          const filePath = path.join(projectDir, this.contentState.outputFile);

          // Ensure parent directory exists
          const parentDir = path.dirname(filePath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }

          fs.writeFileSync(filePath, this.contentState.currentContent, 'utf-8');
          fileSaved = true;
          debugLog(`[GenericAgent] Saved content to ${this.contentState.outputFile}`);
        } catch (err) {
          debugLog(
            `[GenericAgent] ERROR: Failed to save content to ${this.contentState.outputFile}: ${err}`
          );
        }
      }

      // Generate content name and summary using LLM (similar to planning)
      const { name, summary } = await this.generateContentMetadata(
        this.contentState.task,
        this.contentState.contentType,
        this.contentState.currentContent
      );

      // Store full content in external context store (NOT in messages)
      // This prevents context bloat from large content being repeatedly passed
      const { variableName } = contextStore.store(this.contentState.currentContent, name, {
        source: 'tool',
        variableBaseName: this.contentState.contentType,
      });

      const result = {
        status: 'approved',
        name,
        summary,
        content_ref: variableName,
        content_type: this.contentState.contentType,
        task: this.contentState.task,
        output_file: this.contentState.outputFile,
        file_saved: fileSaved,
        iterations: this.contentState.iterations,
        message: fileSaved
          ? `${this.contentState.contentType} content "${name}" approved and saved to ${this.contentState.outputFile}. Summary: ${summary}\n\nTo read the full content, use fetch_context with ${variableName}.`
          : `${this.contentState.contentType} content "${name}" approved. Summary: ${summary}\n\nTo read the full content, use fetch_context with ${variableName}.`,
        next_steps:
          'IMPORTANT: Now update the project state - call update_project to: 1) Set planner stage to "complete", 2) Mark the current phase as "completed", 3) Transition to the next phase.',
      };
      this.contentState = null;
      // Reset mode back to orchestrator
      this.currentMode = 'orchestrator';
      return result;
    }

    // User wants to provide feedback - use their input directly with XML tags
    this.contentState.messages.push({
      role: 'user',
      content: `<user_feedback>\n${userResponse}\n</user_feedback>\n\n<request>\nPlease revise the ${this.contentState.contentType} content based on the feedback above.\n</request>`,
    });

    // Continue the content loop
    return this.continueContentLoop();
  }

  /**
   * Check if there's an active image generation session awaiting user input.
   */
  isImageGenActive(): boolean {
    return this.imageGenState?.active ?? false;
  }

  /**
   * Handle dispatch_image_agent tool - spawns a sub-agent for image prompt crafting.
   * The sub-agent crafts detailed prompts, gets user feedback, and generates the image once approved.
   *
   * Supports two modes:
   * 1. Text-to-Image: For character_ref/setting_ref (no reference images needed)
   * 2. Image+Text-to-Image: For scenes (requires reference images for consistency)
   */
  private async handleDispatchImageAgent(toolCall: ToolCall): Promise<unknown> {
    // Set mode for UI display
    this.currentMode = 'image';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    let context = args['context'] as string | undefined;
    const contextRef = args['context_ref'] as string | undefined;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const sceneNumber = (args['scene_number'] as number) ?? 1;
    const imageType = args['image_type'] as 'scene' | 'character_ref' | 'setting_ref' | undefined;
    const characterName = args['character_name'] as string | undefined;
    const settingName = args['setting_name'] as string | undefined;
    const referenceImages = args['reference_images'] as
      | Array<{
          image_id: string;
          type: 'character' | 'setting';
          name: string;
        }>
      | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_image_agent' };
    }

    // Resolve context_refs (array) if provided - combines multiple contexts
    if (contextRefs && contextRefs.length > 0) {
      const contextParts: string[] = [];
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push(`## ${ref} (${stored.label})\n\n${stored.content}`);
          debugLog(
            `[GenericAgent] Resolved context_ref ${ref} for image agent (${stored.label}, ${stored.content.length} chars)`
          );
        } else {
          debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
        }
      }
      if (contextParts.length > 0) {
        context = contextParts.join('\n\n---\n\n');
      }
    }
    // Fallback to singular context_ref if provided
    else if (contextRef) {
      const stored = contextStore.get(contextRef);
      if (stored) {
        context = stored.content;
        debugLog(
          `[GenericAgent] Resolved context_ref ${contextRef} for image agent (${stored.label}, ${stored.content.length} chars)`
        );
      } else {
        return { error: `Context reference not found: ${contextRef}` };
      }
    }

    // Warn about long inline context that should use context_ref
    if (context && context.length > 500 && !contextRef && !contextRefs) {
      debugLog(
        `[GenericAgent] WARNING: Long context (${context.length} chars) passed to dispatch_image_agent without context_ref. Consider using store_context.`
      );
    }

    // Check if we're resuming an existing session
    if (this.imageGenState?.active) {
      return { error: 'Image generation already in progress' };
    }

    // Determine generation mode based on image type and reference availability
    const isSceneImage = imageType === 'scene';
    const hasReferences = referenceImages && referenceImages.length > 0;
    const generationMode: 'text_to_image' | 'image_text_to_image' =
      isSceneImage && hasReferences ? 'image_text_to_image' : 'text_to_image';

    // Warn if scene image requested without references
    if (isSceneImage && !hasReferences) {
      return {
        error: 'Scene images require reference_images for character/setting consistency.',
        suggestion:
          'Please provide reference_images array with character and setting references, or generate reference images first using image_type "character_ref" or "setting_ref".',
        image_type: imageType,
      };
    }

    // Build enhanced context for image+text-to-image mode
    let enhancedContext = context ?? '';
    if (generationMode === 'image_text_to_image' && referenceImages) {
      const refDescriptions = referenceImages
        .map(
          ref =>
            `- ${ref.type === 'character' ? 'Character' : 'Setting'} "${ref.name}" (ref: ${ref.image_id})`
        )
        .join('\n');
      enhancedContext += `\n\n<reference_images>\nThe following reference images will be used for visual consistency:\n${refDescriptions}\n\nIMPORTANT: The generated image must maintain visual consistency with these references. Characters should look the same as in their reference images. Settings should match their reference style.\n</reference_images>`;
    }

    // Initialize image gen state with the specialized prompt
    const imageGenSystemPrompt = buildImageGenerationPrompt(task, enhancedContext);

    this.imageGenState = {
      active: true,
      task,
      context: enhancedContext,
      messages: [
        { role: 'system', content: imageGenSystemPrompt },
        {
          role: 'user',
          content:
            '<request>\nPlease craft a detailed image generation prompt for this task.\n</request>',
        },
      ],
      currentPrompt: '',
      negativePrompt: '',
      aspectRatio: '16:9',
      iterations: 0,
      imageParams: {
        scene_number: sceneNumber,
        image_type: imageType,
        character_name: characterName,
        setting_name: settingName,
      },
      referenceImages,
      generationMode,
      toolCallId: toolCall.id,
    };

    // Generate the initial prompt
    return this.continueImageGenLoop();
  }

  /**
   * Continue the image generation loop - generates prompt and asks for user approval.
   */
  private async continueImageGenLoop(): Promise<unknown> {
    if (!this.imageGenState) {
      return { error: 'No active image generation session' };
    }

    const maxIterations = 10;

    if (this.imageGenState.iterations >= maxIterations) {
      const result = {
        status: 'max_iterations',
        prompt: this.imageGenState.currentPrompt,
        negative_prompt: this.imageGenState.negativePrompt,
        aspect_ratio: this.imageGenState.aspectRatio,
        task: this.imageGenState.task,
        message: 'Reached maximum iterations for prompt refinement. Using the last version.',
      };
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    this.imageGenState.iterations++;

    try {
      // Generate or refine the prompt with streaming
      let promptContent = '';
      let isFirstChunk = true;

      // If this is a subsequent iteration (after feedback), we need to reset the streaming display
      const shouldReset = this.imageGenState.iterations > 1;

      for await (const chunk of this.llm.generateStream({
        messages: this.imageGenState.messages,
        temperature: 0.7,
      })) {
        if (chunk.content) {
          promptContent += chunk.content;
          // Emit tool_streaming to show content inside the ToolCallDisplay
          // On first chunk of a regeneration, include reset flag to clear old content and show display
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.imageGenState.toolCallId,
            chunk: chunk.content,
            done: false,
            agentName: this.getEffectiveAgentName(),
            toolName: 'dispatch_image_agent',
            reset: shouldReset && isFirstChunk,
          });
          isFirstChunk = false;
        }
        if (chunk.done) {
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.imageGenState.toolCallId,
            chunk: '',
            done: true,
            agentName: this.getEffectiveAgentName(),
          });
        }
      }

      // Parse the prompt components from the response
      const parsed = this.parseImagePromptResponse(promptContent);
      this.imageGenState.currentPrompt = parsed.prompt;
      this.imageGenState.negativePrompt = parsed.negativePrompt;
      this.imageGenState.aspectRatio = parsed.aspectRatio;

      // Add assistant response to history
      this.imageGenState.messages.push({
        role: 'assistant',
        content: promptContent,
      });

      // Return status indicating we need user approval
      const verificationQuestion =
        this.imageGenState.iterations === 1
          ? "I've crafted an image prompt. Would you like to generate the image or provide feedback?"
          : "I've updated the prompt based on your feedback. Would you like to generate the image or provide more feedback?";

      return {
        status: 'awaiting_prompt_approval',
        prompt: this.imageGenState.currentPrompt,
        negative_prompt: this.imageGenState.negativePrompt,
        aspect_ratio: this.imageGenState.aspectRatio,
        task: this.imageGenState.task,
        iterations: this.imageGenState.iterations,
        question: verificationQuestion,
        options: [
          {
            label: 'Generate image',
            description: 'Proceed with this prompt and generate the image',
          },
          { label: 'Provide feedback', description: 'Modify the prompt with your input' },
        ],
        autoApproveTimeoutMs: 15000, // 15 seconds countdown for image prompt approval
      };
    } catch (error) {
      const failedTask = this.imageGenState?.task;
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Image prompt generation failed: ${String(error)}`,
        task: failedTask,
      };
    }
  }

  /**
   * Parse the image prompt response to extract prompt, negative prompt, and aspect ratio.
   */
  private parseImagePromptResponse(response: string): {
    prompt: string;
    negativePrompt: string;
    aspectRatio: string;
  } {
    let prompt = '';
    let negativePrompt = 'blurry, distorted, low quality, deformed, ugly, bad anatomy';
    let aspectRatio = '16:9';

    // Try to extract Image Prompt section
    const promptMatch = response.match(
      /\*\*Image Prompt:\*\*\s*\n([^\n*]+(?:\n(?!\*\*)[^\n*]+)*)/i
    );
    if (promptMatch?.[1]) {
      prompt = promptMatch[1].trim();
    }

    // Try to extract Negative Prompt section
    const negativeMatch = response.match(
      /\*\*Negative Prompt:\*\*\s*\n([^\n*]+(?:\n(?!\*\*)[^\n*]+)*)/i
    );
    if (negativeMatch?.[1]) {
      negativePrompt = negativeMatch[1].trim();
    }

    // Try to extract Aspect Ratio section
    const aspectMatch = response.match(/\*\*Aspect Ratio:\*\*\s*\n?\s*([^\n]+)/i);
    if (aspectMatch?.[1]) {
      const ratio = aspectMatch[1].trim();
      // Validate aspect ratio format
      if (/^\d+:\d+$/.test(ratio)) {
        aspectRatio = ratio;
      }
    }

    // If no structured prompt found, use the whole response as the prompt
    if (!prompt) {
      // Remove markdown headers and rationale sections
      prompt =
        response
          .replace(/\*\*[^*]+\*\*/g, '')
          .replace(/##[^\n]+\n/g, '')
          .trim()
          .split('\n')[0] || response.slice(0, 500);
    }

    return { prompt, negativePrompt, aspectRatio };
  }

  /**
   * Handle user response to image generation prompt approval.
   * Uses LLM to classify whether the response is approval or feedback.
   */
  async handleImageGenResponse(userResponse: string): Promise<unknown> {
    if (!this.imageGenState) {
      return { error: 'No active image generation session' };
    }

    // Use LLM to classify the user's intent
    const isApproval = await this.classifyImageGenResponse(userResponse);

    if (isApproval) {
      // User approved - execute the actual image generation
      return this.executeImageGeneration();
    }

    // User wants to provide feedback - use their input with XML tags
    this.imageGenState.messages.push({
      role: 'user',
      content: `<user_feedback>\n${userResponse}\n</user_feedback>\n\n<request>\nPlease revise the image prompt based on the feedback above.\n</request>`,
    });

    // Continue the image gen loop
    return this.continueImageGenLoop();
  }

  /**
   * Use LLM to classify whether user response indicates approval or feedback for image generation.
   */
  private async classifyImageGenResponse(userResponse: string): Promise<boolean> {
    // Load classification prompt from file
    const classificationPrompt = loadAndRenderMarkdown('system/classification/image-approval.md', {
      user_response: userResponse,
    });

    try {
      const response = await this.llm.generate({
        messages: [{ role: 'user', content: classificationPrompt }],
        temperature: 0,
        maxTokens: 10,
      });

      const result = (response.content ?? '').trim().toUpperCase();
      return result.includes('APPROVE');
    } catch {
      // On error, fall back to simple pattern matching
      const lower = userResponse.toLowerCase().trim();
      const approvalPatterns = [
        'yes',
        'ok',
        'okay',
        'generate',
        'go',
        'create',
        'make',
        'proceed',
        'lgtm',
        'y',
        '1',
      ];
      return approvalPatterns.some(p => lower === p || lower.includes(p));
    }
  }

  /**
   * Execute the actual image generation after user approval.
   */
  private async executeImageGeneration(): Promise<unknown> {
    if (!this.imageGenState) {
      return { error: 'No active image generation session' };
    }

    const {
      currentPrompt,
      negativePrompt,
      aspectRatio,
      imageParams,
      task,
      referenceImages,
      generationMode,
    } = this.imageGenState;

    // Get the generate_image tool
    const generateImageTool = this.tools.get('generate_image');
    if (!generateImageTool?.handler) {
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'generate_image tool not available',
        prompt: currentPrompt,
        task,
      };
    }

    // Get the wait_for_job tool
    const waitForJobTool = this.tools.get('wait_for_job');
    if (!waitForJobTool?.handler) {
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'wait_for_job tool not available',
        prompt: currentPrompt,
        task,
      };
    }

    // Build arguments for generate_image
    const generateArgs: Record<string, unknown> = {
      prompt: currentPrompt,
      negative_prompt: negativePrompt,
      aspect_ratio: aspectRatio,
      scene_number: imageParams.scene_number,
      generation_mode: generationMode,
    };

    if (imageParams.image_type) {
      generateArgs['image_type'] = imageParams.image_type;
    }
    if (imageParams.character_name) {
      generateArgs['character_name'] = imageParams.character_name;
    }
    if (imageParams.setting_name) {
      generateArgs['setting_name'] = imageParams.setting_name;
    }

    // Include reference images for image+text-to-image mode
    if (generationMode === 'image_text_to_image' && referenceImages && referenceImages.length > 0) {
      generateArgs['reference_images'] = referenceImages;
    }

    const toolCallId = `img-gen-${Date.now()}`;

    // Emit that we're generating the image
    this.emit({
      type: 'tool_call',
      toolCallId,
      toolName: 'generate_image',
      arguments: generateArgs,
      agentName: this.getEffectiveAgentName(),
    });

    try {
      // Step 1: Submit the image generation job
      const submitResult = await Promise.resolve(generateImageTool.handler(generateArgs));
      const submitResultObj = submitResult as Record<string, unknown>;

      // Check if submission failed
      if (submitResultObj['status'] === 'error') {
        const finalState = { ...this.imageGenState };
        this.imageGenState = null;
        this.currentMode = 'orchestrator';

        this.emit({
          type: 'tool_result',
          toolCallId,
          toolName: 'generate_image',
          result: submitResult,
          isError: true,
          agentName: this.getEffectiveAgentName(),
        });

        return {
          status: 'error',
          error: submitResultObj['error'] as string,
          prompt: finalState.currentPrompt,
          task: finalState.task,
        };
      }

      const jobId = submitResultObj['job_id'] as string;
      if (!jobId) {
        throw new Error('No job_id returned from generate_image');
      }

      // Emit that we're waiting for the job
      const waitToolCallId = `wait-job-${Date.now()}`;
      this.emit({
        type: 'tool_call',
        toolCallId: waitToolCallId,
        toolName: 'wait_for_job',
        arguments: { job_id: jobId },
        agentName: this.getEffectiveAgentName(),
      });

      // Step 2: Wait for the job to complete
      const waitResult = await Promise.resolve(waitForJobTool.handler({ job_id: jobId }));
      const waitResultObj = waitResult as Record<string, unknown>;

      // Clear the state
      const finalState = { ...this.imageGenState };
      this.imageGenState = null;
      this.currentMode = 'orchestrator';

      // Emit tool result for wait_for_job
      this.emit({
        type: 'tool_result',
        toolCallId: waitToolCallId,
        toolName: 'wait_for_job',
        result: waitResult,
        isError: waitResultObj['status'] === 'error' || waitResultObj['status'] === 'failed',
        agentName: this.getEffectiveAgentName(),
      });

      // Check if job failed
      if (waitResultObj['status'] === 'error' || waitResultObj['status'] === 'failed') {
        return {
          status: 'error',
          error: (waitResultObj['error'] as string) || 'Job failed',
          prompt: finalState.currentPrompt,
          task: finalState.task,
          job_id: jobId,
        };
      }

      return {
        status: 'completed',
        prompt: finalState.currentPrompt,
        negative_prompt: finalState.negativePrompt,
        aspect_ratio: finalState.aspectRatio,
        task: finalState.task,
        iterations: finalState.iterations,
        job_id: jobId,
        artifact_id: waitResultObj['artifact_id'],
        file_path: waitResultObj['file_path'],
        message: 'Image generated successfully.',
      };
    } catch (error) {
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Image generation failed: ${String(error)}`,
        prompt: currentPrompt,
        task,
      };
    }
  }

  /**
   * Handle dispatch_video_agent tool - spawns a sub-agent for video generation.
   * Presents video parameters to user for approval before generating.
   */
  private async handleDispatchVideoAgent(toolCall: ToolCall): Promise<unknown> {
    // Set mode for UI display
    this.currentMode = 'video';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    const sceneImageArtifactId = args['scene_image_artifact_id'] as string | undefined;
    const sceneNumber = (args['scene_number'] as number) ?? 1;
    const motionDescription = args['motion_description'] as string | undefined;
    const contextRef = args['context_ref'] as string | undefined;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const duration = (args['duration'] as number) ?? 4;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_video_agent' };
    }

    // scene_image_artifact_id is optional for stitching operations
    // But required for single scene video generation
    const isStitchOperation = task.toLowerCase().includes('stitch');
    if (!sceneImageArtifactId && !isStitchOperation) {
      this.currentMode = 'orchestrator';
      return { error: 'No scene_image_artifact_id provided for dispatch_video_agent' };
    }

    // Resolve context_refs (array) if provided - combines multiple contexts
    let context = '';
    if (contextRefs && contextRefs.length > 0) {
      const contextParts: string[] = [];
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push(`## ${ref} (${stored.label})\n\n${stored.content}`);
          debugLog(
            `[GenericAgent] Resolved context_ref ${ref} for video agent (${stored.label}, ${stored.content.length} chars)`
          );
        } else {
          debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
        }
      }
      if (contextParts.length > 0) {
        context = contextParts.join('\n\n---\n\n');
      }
    }
    // Fallback to singular context_ref if provided
    else if (contextRef) {
      const stored = contextStore.get(contextRef);
      if (stored) {
        context = stored.content;
        debugLog(
          `[GenericAgent] Resolved context_ref ${contextRef} for video agent (${stored.label}, ${stored.content.length} chars)`
        );
      } else {
        return { error: `Context reference not found: ${contextRef}` };
      }
    }

    // Check if we're already in a video generation session
    if (this.videoGenState?.active) {
      return { error: 'Video generation already in progress' };
    }

    // Initialize video gen state
    this.videoGenState = {
      active: true,
      task,
      sceneNumber,
      sceneImageArtifactId,
      motionDescription,
      context,
      messages: [],
      currentParams: {
        duration,
        fps: 24,
        motionStrength: 0.7,
      },
      iterations: 0,
    };

    // Build a summary for user approval
    const paramSummary = `**Video Generation Parameters:**
- Scene: #${sceneNumber}
- Source Image: ${sceneImageArtifactId}
- Duration: ${duration} seconds
- Motion: ${motionDescription ?? 'Auto-determined based on scene'}
- Task: ${task}`;

    // Return status indicating we need user approval
    return {
      status: 'awaiting_approval',
      params: this.videoGenState.currentParams,
      scene_number: sceneNumber,
      image_artifact_id: sceneImageArtifactId,
      motion_description: motionDescription,
      task,
      question: `I'm ready to generate video for scene ${sceneNumber}. Here are the parameters:\n\n${paramSummary}\n\nWould you like to proceed or adjust the parameters?`,
      options: [
        { label: 'Generate video', description: 'Proceed with these parameters' },
        { label: 'Provide feedback', description: 'Modify the parameters' },
      ],
      autoApproveTimeoutMs: 15000, // 15 seconds countdown
    };
  }

  /**
   * Handle user response to video generation approval.
   */
  async handleVideoGenResponse(userResponse: string): Promise<unknown> {
    if (!this.videoGenState) {
      return { error: 'No active video generation session' };
    }

    // Use simple pattern matching to classify response
    const lower = userResponse.toLowerCase().trim();
    const approvalPatterns = [
      'yes',
      'ok',
      'okay',
      'generate',
      'go',
      'proceed',
      'create',
      'make',
      'lgtm',
      'y',
      '1',
    ];
    const isApproval = approvalPatterns.some(p => lower === p || lower.startsWith(p));

    if (isApproval) {
      // User approved - execute video generation
      return this.executeVideoGeneration();
    }

    // User wants to provide feedback
    this.videoGenState.iterations++;
    if (this.videoGenState.iterations >= 5) {
      const result = {
        status: 'max_iterations',
        params: this.videoGenState.currentParams,
        task: this.videoGenState.task,
        message: 'Reached maximum iterations for parameter refinement. Using the last version.',
      };
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    // Parse feedback for parameter changes (simple parsing)
    if (lower.includes('duration') && /\d+/.test(lower)) {
      const match = lower.match(/(\d+)\s*(?:s|sec|seconds?)?/);
      if (match?.[1]) {
        this.videoGenState.currentParams.duration = parseInt(match[1], 10);
      }
    }

    // Return updated parameters for approval
    return {
      status: 'awaiting_approval',
      params: this.videoGenState.currentParams,
      scene_number: this.videoGenState.sceneNumber,
      image_artifact_id: this.videoGenState.sceneImageArtifactId,
      motion_description: this.videoGenState.motionDescription,
      task: this.videoGenState.task,
      iterations: this.videoGenState.iterations,
      question: `I've updated the parameters based on your feedback. Would you like to proceed or make more adjustments?`,
      options: [
        { label: 'Generate video', description: 'Proceed with these parameters' },
        { label: 'Provide feedback', description: 'Make more changes' },
      ],
      autoApproveTimeoutMs: 15000,
    };
  }

  /**
   * Execute the actual video generation after user approval.
   */
  private async executeVideoGeneration(): Promise<unknown> {
    if (!this.videoGenState) {
      return { error: 'No active video generation session' };
    }

    const { task, sceneNumber, sceneImageArtifactId, motionDescription, currentParams } =
      this.videoGenState;

    // Get the generate_video tool
    const generateVideoTool = this.tools.get('generate_video');
    if (!generateVideoTool?.handler) {
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'generate_video tool not available',
        task,
      };
    }

    // Get the wait_for_job tool
    const waitForJobTool = this.tools.get('wait_for_job');
    if (!waitForJobTool?.handler) {
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'wait_for_job tool not available',
        task,
      };
    }

    // Build arguments for generate_video
    const generateArgs: Record<string, unknown> = {
      scene_number: sceneNumber,
      scene_image_artifact_id: sceneImageArtifactId,
      prompt: motionDescription, // generate_video uses 'prompt' for motion description
      // duration and fps may be handled by the workflow
    };

    const toolCallId = `vid-gen-${Date.now()}`;

    // Emit that we're generating the video
    this.emit({
      type: 'tool_call',
      toolCallId,
      toolName: 'generate_video',
      arguments: generateArgs,
      agentName: this.getEffectiveAgentName(),
    });

    try {
      // Step 1: Submit the video generation job
      const submitResult = await Promise.resolve(generateVideoTool.handler(generateArgs));
      const submitResultObj = submitResult as Record<string, unknown>;

      // Check if submission failed
      if (submitResultObj['status'] === 'error') {
        const finalState = { ...this.videoGenState };
        this.videoGenState = null;
        this.currentMode = 'orchestrator';

        this.emit({
          type: 'tool_result',
          toolCallId,
          toolName: 'generate_video',
          result: submitResult,
          isError: true,
          agentName: this.getEffectiveAgentName(),
        });

        return {
          status: 'error',
          error: submitResultObj['error'] as string,
          scene_number: finalState.sceneNumber,
          task: finalState.task,
        };
      }

      const jobId = submitResultObj['job_id'] as string;
      if (!jobId) {
        throw new Error('No job_id returned from generate_video');
      }

      // Emit that we're waiting for the job
      const waitToolCallId = `wait-job-${Date.now()}`;
      this.emit({
        type: 'tool_call',
        toolCallId: waitToolCallId,
        toolName: 'wait_for_job',
        arguments: { job_id: jobId },
        agentName: this.getEffectiveAgentName(),
      });

      // Step 2: Wait for the job to complete
      const waitResult = await Promise.resolve(waitForJobTool.handler({ job_id: jobId }));
      const waitResultObj = waitResult as Record<string, unknown>;

      // Clear the state
      const finalState = { ...this.videoGenState };
      this.videoGenState = null;
      this.currentMode = 'orchestrator';

      // Emit tool result for wait_for_job
      this.emit({
        type: 'tool_result',
        toolCallId: waitToolCallId,
        toolName: 'wait_for_job',
        result: waitResult,
        isError: waitResultObj['status'] === 'error' || waitResultObj['status'] === 'failed',
        agentName: this.getEffectiveAgentName(),
      });

      // Check if job failed
      if (waitResultObj['status'] === 'error' || waitResultObj['status'] === 'failed') {
        return {
          status: 'error',
          error: (waitResultObj['error'] as string) || 'Job failed',
          scene_number: finalState.sceneNumber,
          task: finalState.task,
          job_id: jobId,
        };
      }

      return {
        status: 'completed',
        scene_number: finalState.sceneNumber,
        image_artifact_id: finalState.sceneImageArtifactId,
        params: finalState.currentParams,
        task: finalState.task,
        iterations: finalState.iterations,
        job_id: jobId,
        artifact_id: waitResultObj['artifact_id'],
        file_path: waitResultObj['file_path'],
        message: 'Video generated successfully.',
      };
    } catch (error) {
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Video generation failed: ${String(error)}`,
        task,
      };
    }
  }

  /**
   * Handle ask_user tool - pauses execution.
   * Supports confirmation, free-form, and multiple choice questions.
   * Supports auto_approve_timeout_ms for automatic approval after timeout.
   *
   * Default behavior: All non-confirmation questions get default options and 15s auto-approve.
   */
  private handleAskUser(toolCall: ToolCall): GenericAgentResult | null {
    const args = toolCall.arguments;
    // Support both legacy ask_user schema and Claude SDK-style AskUserQuestion schema.
    const question =
      (args['question'] as string | undefined) ?? (args['prompt'] as string | undefined) ?? '';

    // Legacy-only fields (kept for back-compat)
    const isConfirmation = (args['is_confirmation'] as boolean | undefined) ?? false;
    const providedOptions = args['options'] as
      | Array<{ label: string; description?: string }>
      | string[]
      | undefined;
    const providedTimeout = args['auto_approve_timeout_ms'] as number | undefined;

    // Claude SDK-style multiSelect (currently informational; UI supports single-select)
    const multiSelect = (args['multiSelect'] as boolean | undefined) ?? false;

    // Default options for non-confirmation questions without explicit options
    const DEFAULT_OPTIONS: Array<{ label: string; description?: string }> = [
      { label: 'Proceed', description: 'Continue with the suggested approach' },
      { label: 'Provide feedback', description: 'Enter your own response or modifications' },
    ];
    const DEFAULT_AUTO_APPROVE_TIMEOUT_MS = 15000; // 15 seconds

    // Normalize options to {label, description?}[]
    let normalizedOptions: Array<{ label: string; description?: string }> | undefined;
    if (Array.isArray(providedOptions) && providedOptions.length > 0) {
      if (typeof providedOptions[0] === 'string') {
        normalizedOptions = (providedOptions as string[]).map(label => ({ label }));
      } else {
        normalizedOptions = providedOptions as Array<{ label: string; description?: string }>;
      }
    }

    // Ensure "Other" is always available as per Claude SDK usage notes (for non-confirmation questions)
    if (!isConfirmation) {
      const opts = normalizedOptions ?? DEFAULT_OPTIONS;
      const hasOther = opts.some(o => o.label.toLowerCase() === 'other');
      normalizedOptions = hasOther
        ? opts
        : [...opts, { label: 'Other', description: 'Provide custom input' }];
    }

    // Use provided options or defaults (only for non-confirmation questions)
    const options = isConfirmation ? undefined : (normalizedOptions ?? DEFAULT_OPTIONS);
    const autoApproveTimeoutMs = isConfirmation
      ? undefined
      : (providedTimeout ?? DEFAULT_AUTO_APPROVE_TIMEOUT_MS);

    this.waitingForUser = true;
    this.pendingQuestion = question;

    const toolResult = {
      status: 'waiting_for_user',
      question,
      is_confirmation: isConfirmation,
      options: options ?? null,
      auto_approve_timeout_ms: autoApproveTimeoutMs ?? null,
      multiSelect,
    };

    this.messages.push({
      role: 'tool',
      content: JSON.stringify(toolResult),
      toolCallId: toolCall.id,
      name: toolCall.name,
    });

    // Emit question event with options and timeout
    debugLog(
      `[GenericAgent] ask_user emitting question: ${JSON.stringify(
        {
          question: question?.slice(0, 50),
          optionsCount: options?.length,
          options,
          isConfirmation,
          autoApproveTimeoutMs,
        },
        null,
        2
      )}`
    );
    this.emit({
      type: 'question',
      question,
      isConfirmation,
      options,
      data: args['data'] as Record<string, unknown> | undefined,
      autoApproveTimeoutMs,
    });

    return {
      status: 'waiting_for_user',
      output: question,
      todos: this.todoManager.getTodos(),
      pendingQuestion: question,
      isConfirmation,
      options,
      autoApproveTimeoutMs,
    };
  }

  /**
   * Handle user response to a question.
   */
  private handleUserResponse(response: string): void {
    // Find the last ask_user tool message and update it
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg?.role === 'tool' && msg.content) {
        try {
          const content = JSON.parse(msg.content) as Record<string, unknown>;
          if (content['status'] === 'waiting_for_user') {
            const isConfirmation = (content['is_confirmation'] as boolean | undefined) ?? false;

            if (isConfirmation) {
              const approvalKeywords = [
                'yes',
                'yeah',
                'yep',
                'ok',
                'okay',
                'sure',
                'go ahead',
                'proceed',
                'continue',
                'approved',
                'confirm',
              ];
              const approved = approvalKeywords.some(kw => response.toLowerCase().includes(kw));

              this.messages[i] = {
                ...msg,
                content: JSON.stringify({
                  approved,
                  user_response: response,
                  original_question: content['question'],
                }),
              };
            } else {
              this.messages[i] = {
                ...msg,
                content: JSON.stringify({
                  status: 'user_responded',
                  user_response: response,
                  original_question: content['question'],
                }),
              };
            }
            break;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  /**
   * Build the system message for this agent.
   */
  private buildSystemMessage(): string {
    return buildSystemMessage(this.isSubAgent, this.tools, this.customPrompt);
  }

  /**
   * Inject todo reminder and context variables after the first system message.
   */
  private injectTodoReminder(): Message[] {
    const hasTodos = this.todoManager.getTodos().length > 0;
    const hasContextVars = this.activeContextVariables.length > 0;

    if (!hasTodos && !hasContextVars) {
      return [...this.messages];
    }

    // Build reminder content
    const parts: string[] = [];

    if (hasTodos) {
      parts.push(this.todoManager.toReminderText());
    }

    if (hasContextVars) {
      parts.push(buildContextVariablesSection(this.activeContextVariables));
    }

    const reminder: Message = {
      role: 'system',
      content: parts.join('\n\n'),
    };

    // Insert after the first system message
    const firstMsg = this.messages[0];
    if (firstMsg) {
      return [firstMsg, reminder, ...this.messages.slice(1)];
    }
    return [reminder, ...this.messages];
  }

  /**
   * Get active context variables.
   */
  getContextVariables(): ContextVariable[] {
    return [...this.activeContextVariables];
  }

  /**
   * Check if context window is approaching capacity.
   * Returns true if we should compress old messages.
   */
  private shouldCompressContext(): boolean {
    const threshold = this.maxContextTokens * GenericAgent.CONTEXT_THRESHOLD;

    // Method 1: Check based on actual token usage from last call
    if (this.tokenUsage.lastPromptTokens > 0) {
      const shouldCompress = this.tokenUsage.lastPromptTokens > threshold;
      if (shouldCompress) {
        debugLog(
          `[GenericAgent] Context at ${Math.round((this.tokenUsage.lastPromptTokens / this.maxContextTokens) * 100)}% (${this.tokenUsage.lastPromptTokens}/${this.maxContextTokens} tokens) - compression needed`
        );
        return true;
      }
    }

    // Method 2: Estimate based on message count and content length
    // This helps catch cases where we haven't had a successful LLM call yet
    // Conservative estimate: ~3 chars per token (models vary, better to overestimate)
    // Plus overhead for tool definitions (~250 tokens each) and message formatting
    const estimatedContentTokens = this.messages.reduce((sum, msg) => {
      return sum + Math.ceil((msg.content?.length ?? 0) / 3) + 10; // +10 for message overhead
    }, 0);
    const estimatedToolTokens = this.tools.size * 250; // ~250 tokens per tool definition
    const estimatedTotal = estimatedContentTokens + estimatedToolTokens;

    if (estimatedTotal > threshold) {
      debugLog(
        `[GenericAgent] Estimated context at ${Math.round((estimatedTotal / this.maxContextTokens) * 100)}% (~${estimatedTotal}/${this.maxContextTokens} tokens) - compression needed`
      );
      return true;
    }

    // Method 3: Trigger compression if we have many messages regardless
    // This is a safety net for long conversations
    // Lower threshold to be more aggressive with compression
    const MESSAGE_COUNT_THRESHOLD = 20;
    if (this.messages.length > MESSAGE_COUNT_THRESHOLD) {
      debugLog(
        `[GenericAgent] Message count (${this.messages.length}) exceeds threshold (${MESSAGE_COUNT_THRESHOLD}) - compression needed`
      );
      return true;
    }

    return false;
  }

  /**
   * Compress conversation history when context approaches limit.
   * Uses LLM to summarize old messages while preserving system + recent.
   */
  private async compressConversationHistory(): Promise<void> {
    const { compressMessages, SUMMARIZER_SYSTEM_PROMPT } =
      await import('../context/MessageCompressor.js');

    debugLog(
      `[GenericAgent] Starting context compression. Current messages: ${this.messages.length}`
    );

    const result = await compressMessages(this.messages, async content => {
      // Use LLM to summarize the conversation
      const summaryResponse = await this.llm.generate({
        messages: [
          { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        maxTokens: 1000,
      });
      return summaryResponse.content ?? 'Conversation history compressed.';
    });

    if (result.wasCompressed) {
      this.messages = result.messages;
      debugLog(
        `[GenericAgent] Compressed ${result.removedCount} messages. New count: ${this.messages.length}`
      );

      // Log compression with phase context
      phaseLogger.info('GenericAgent', 'context_compression', 'Conversation history compressed', {
        removedCount: result.removedCount,
        newMessageCount: this.messages.length,
        maxContextTokens: this.maxContextTokens,
      });

      // Emit event so UI can show compression occurred
      this.emit({
        type: 'notification',
        level: 'info',
        message: `Context compressed: ${result.removedCount} messages summarized to stay within limits`,
      });
    }
  }
}

// Re-export tool categories for external use
export { SIMPLE_TOOLS, COMPLEX_TOOLS, isComplexTool };

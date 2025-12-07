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
import { TypedEventEmitter } from '../../events/index.js';
import type { LLMClient, Message, ToolCall, ToolDefinition, LLMResponse } from '../llm/index.js';
import { ExpandableTodoManager, type ExpandableTodoItem } from '../todo/index.js';
import { buildSystemMessage, buildPlanningPrompt, buildImageGenerationPrompt, wrapUserTask } from '../prompts/index.js';
import type { AgentConfig, AgentStatus, GenericAgentResult } from './AgentResult.js';

/**
 * Tool categories - simple tools execute immediately, complex require confirmation.
 */
const SIMPLE_TOOLS = new Set([
  'think',
  'ask_user',
  'dispatch_agent',
  'dispatch_image_agent',
  'wait_for_job',
  'todo_write',
]);

const COMPLEX_TOOLS = new Set(['generate_image', 'generate_video', 'edit_image']);

function isComplexTool(name: string): boolean {
  return COMPLEX_TOOLS.has(name);
}

function isBuiltinTodoTool(name: string): boolean {
  return name === 'todo_write';
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

  // Loop detection state
  private recentToolCalls: string[] = [];
  private static readonly LOOP_DETECTION_WINDOW = 6;
  private static readonly LOOP_THRESHOLD = 3; // Same tool called 3+ times in window

  constructor(
    tools: Map<string, ToolDefinition>,
    llm: LLMClient,
    config: AgentConfig = {}
  ) {
    super();
    this.tools = tools;
    this.llm = llm;
    this.isSubAgent = config.isSubAgent ?? false;
    this.maxIterations = config.maxIterations ?? 100;
    this.name = config.name ?? `agent-${nanoid(6)}`;
    this.customPrompt = config.customPrompt;
  }

  /**
   * Stop the agent's current execution.
   */
  stop(): void {
    this.aborted = true;
    this.emit({ type: 'agent_status', status: 'interrupted', agentName: this.name });
  }

  /**
   * Inject new user input during execution.
   * The agent will process this input on the next iteration.
   */
  injectInput(input: string): void {
    this.pendingUserInput = input;
    this.emit({ type: 'user_input_injected', input, agentName: this.name });
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
    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();

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

        // Handle stream completion
        if (chunk.done) {
          this.emit({ type: 'streaming_text', chunk: '', done: true });
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

    return {
      content: cleanedContent,
      toolCalls,
      finishReason: 'stop',
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
    this.emit({ type: 'agent_status', status: 'started', agentName: this.name });

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
          });

          // Note: Plan is shown via ToolCallDisplay, don't duplicate in output
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: planResultObj['question'] as string,
            options: planResultObj['options'] as Array<{ label: string; description?: string }>,
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
        this.emit({ type: 'agent_status', status: 'thinking', agentName: this.name });
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
          });

          // Prompt is shown via ToolCallDisplay
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: imageResultObj['question'] as string,
            options: imageResultObj['options'] as Array<{ label: string; description?: string }>,
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
        this.emit({ type: 'agent_status', status: 'thinking', agentName: this.name });
      } else {
        // Regular ask_user response
        this.handleUserResponse(userResponse);
        this.waitingForUser = false;
        this.pendingQuestion = undefined;
      }
    } else if (!this.waitingForUser) {
      // Start fresh - wrap user task in XML tags for structured prompts
      this.messages = [
        { role: 'system', content: this.buildSystemMessage() },
        { role: 'user', content: wrapUserTask(task) },
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
        const userInput = this.pendingUserInput;
        this.pendingUserInput = null;

        // Add user input as a new message with XML tags
        this.messages.push({
          role: 'user',
          content: `<user_interjection>\n${userInput}\n</user_interjection>`,
        });

        // Emit event
        this.emit({ type: 'agent_text', text: `User: ${userInput}`, isFinal: false });
      }

      this.iteration++;

      // Emit thinking status
      this.emit({ type: 'agent_status', status: 'thinking', agentName: this.name });

      // Build messages with todo reminder injected
      const messagesWithReminder = this.injectTodoReminder();

      // Stream LLM response
      const response = await this.generateWithStreaming(
        messagesWithReminder,
        Array.from(this.tools.values())
      );

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
        if (toolCall.name === 'ask_user') {
          const result = this.handleAskUser(toolCall);
          if (result) {
            this.emit({ type: 'agent_status', status: 'waiting', agentName: this.name });
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
      this.emit({ type: 'agent_status', status: 'error', agentName: this.name });
      return {
        status: 'interrupted',
        output: 'Agent reached maximum iterations without completing.',
        todos: this.todoManager.getTodos(),
        error: 'max_iterations_reached',
      };
    }

    // Emit completed status
    this.emit({ type: 'agent_status', status: 'completed', agentName: this.name });
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
   * Returns a warning message if looping detected, null otherwise.
   */
  private detectLoop(toolName: string, args: Record<string, unknown>): string | null {
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
      return `LOOP DETECTED: You've called ${toolName} with similar arguments ${count} times recently. ` +
        `This suggests you're stuck in a loop. Please either:\n` +
        `1. Complete the current task and stop (no more tool calls)\n` +
        `2. Use ask_user to get clarification\n` +
        `3. Try a different approach`;
    }

    // Also check for rapid tool repetition (same tool called consecutively)
    const lastFew = this.recentToolCalls.slice(-4);
    const sameToolCount = lastFew.filter(s => s.startsWith(toolName + ':')).length;
    if (sameToolCount >= 4) {
      return `WARNING: You've called ${toolName} 4 times in a row. ` +
        `If you're done with the task, stop calling tools and provide a final response.`;
    }

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
      agentName: this.name,
    });

    // Check for looping (skip for think tool - it's normal to think often)
    if (toolCall.name !== 'think' && toolCall.name !== 'todo_write') {
      const loopWarning = this.detectLoop(toolCall.name, toolCall.arguments);
      if (loopWarning) {
        const warningResult = {
          status: 'loop_warning',
          warning: loopWarning,
          tool: toolCall.name,
        };
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: warningResult,
          isError: false,
          agentName: this.name,
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
        agentName: this.name,
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
          agentName: this.name,
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: resultObj['options'] as Array<{ label: string; description?: string }>,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.name,
        });

        // Return special marker to indicate we're pausing for user input
        return { __awaiting_user_input: true, ...result };
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.name,
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
          agentName: this.name,
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: resultObj['options'] as Array<{ label: string; description?: string }>,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.name,
        });

        // Return special marker to indicate we're pausing for user input
        return { __awaiting_user_input: true, ...result };
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.name,
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
        agentName: this.name,
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
          agentName: this.name,
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
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.name,
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
        agentName: this.name,
      });
      return errorResult;
    }
  }

  /**
   * Handle built-in todo management tool.
   */
  private handleTodoTool(toolCall: ToolCall): unknown {
    const args = toolCall.arguments;
    const result = this.todoManager.writeTodos(args['todos'] as Array<Record<string, unknown>>);

    // Emit todo update event
    this.emit({
      type: 'todo_update',
      todos: this.todoManager.getTodos(),
      agentName: this.name,
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
  } | null = null;

  /**
   * Handle dispatch_agent tool - spawns a sub-agent for planning.
   * The sub-agent handles the full plan verification loop with the user.
   * It keeps iterating until the user approves the plan.
   */
  private async handleDispatchAgent(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const context = args['context'] as string | undefined;

    if (!task) {
      return { error: 'No task provided for dispatch_agent' };
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
      return result;
    }

    this.planningState.iterations++;

    try {
      // Generate or refine the plan with streaming
      // Note: skipHistory=true because plan is shown via ToolCallDisplay
      let planContent = '';

      for await (const chunk of this.llm.generateStream({
        messages: this.planningState.messages,
        temperature: 0.7,
      })) {
        if (chunk.content) {
          planContent += chunk.content;
          this.emit({ type: 'streaming_text', chunk: chunk.content, done: false, skipHistory: true });
        }
        if (chunk.done) {
          this.emit({ type: 'streaming_text', chunk: '', done: true, skipHistory: true });
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
      const verificationQuestion = this.planningState.iterations === 1
        ? 'I\'ve created a plan for this task. Would you like to proceed or provide feedback?'
        : 'I\'ve updated the plan based on your feedback. Would you like to proceed or provide more feedback?';

      return {
        status: 'awaiting_verification',
        plan: this.planningState.currentPlan,
        task: this.planningState.task,
        iterations: this.planningState.iterations,
        question: verificationQuestion,
        options: [
          { label: 'Accept plan', description: 'Proceed with this plan and start execution' },
          { label: 'Provide feedback', description: 'Modify the plan with your input' },
        ],
      };
    } catch (error) {
      this.planningState = null;
      return {
        error: `Planning failed: ${String(error)}`,
        task: this.planningState?.task,
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
      const result = {
        status: 'approved',
        plan: this.planningState.currentPlan,
        task: this.planningState.task,
        iterations: this.planningState.iterations,
        message: 'Plan approved by user. Ready for execution.',
      };
      this.planningState = null;
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
    const classificationPrompt = `You are a simple intent classifier. Determine if the user's response indicates they want to APPROVE and proceed with the plan, or if they are providing FEEDBACK to modify it.

<user_response>
${userResponse}
</user_response>

Respond with exactly one word: "APPROVE" or "FEEDBACK"

Examples of APPROVE responses:
- "yes", "ok", "proceed", "looks good", "accept", "go ahead", "start", "continue", "lgtm", "y", "1"

Examples of FEEDBACK responses:
- "add more detail to step 3", "I think we should...", "can you change...", "what about...", "no", "2"

Your classification:`;

    try {
      const response = await this.llm.generate({
        messages: [
          { role: 'user', content: classificationPrompt },
        ],
        temperature: 0,
        maxTokens: 10,
      });

      const result = (response.content ?? '').trim().toUpperCase();
      return result.includes('APPROVE');
    } catch {
      // On error, fall back to simple pattern matching
      const lower = userResponse.toLowerCase().trim();
      const approvalPatterns = ['yes', 'ok', 'okay', 'proceed', 'accept', 'approve', 'go', 'start', 'continue', 'lgtm', 'y', '1'];
      return approvalPatterns.some(p => lower === p || lower.includes(p));
    }
  }

  /**
   * Check if there's an active planning session awaiting user input.
   */
  isPlanningActive(): boolean {
    return this.planningState?.active ?? false;
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
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const context = args['context'] as string | undefined;
    const sceneNumber = (args['scene_number'] as number) ?? 1;
    const imageType = args['image_type'] as 'scene' | 'character_ref' | 'setting_ref' | undefined;
    const characterName = args['character_name'] as string | undefined;
    const settingName = args['setting_name'] as string | undefined;
    const referenceImages = args['reference_images'] as Array<{
      image_id: string;
      type: 'character' | 'setting';
      name: string;
    }> | undefined;

    if (!task) {
      return { error: 'No task provided for dispatch_image_agent' };
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
        suggestion: 'Please provide reference_images array with character and setting references, or generate reference images first using image_type "character_ref" or "setting_ref".',
        image_type: imageType,
      };
    }

    // Build enhanced context for image+text-to-image mode
    let enhancedContext = context ?? '';
    if (generationMode === 'image_text_to_image' && referenceImages) {
      const refDescriptions = referenceImages.map(ref =>
        `- ${ref.type === 'character' ? 'Character' : 'Setting'} "${ref.name}" (ref: ${ref.image_id})`
      ).join('\n');
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
        { role: 'user', content: '<request>\nPlease craft a detailed image generation prompt for this task.\n</request>' },
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
      return result;
    }

    this.imageGenState.iterations++;

    try {
      // Generate or refine the prompt with streaming
      let promptContent = '';

      for await (const chunk of this.llm.generateStream({
        messages: this.imageGenState.messages,
        temperature: 0.7,
      })) {
        if (chunk.content) {
          promptContent += chunk.content;
          this.emit({ type: 'streaming_text', chunk: chunk.content, done: false, skipHistory: true });
        }
        if (chunk.done) {
          this.emit({ type: 'streaming_text', chunk: '', done: true, skipHistory: true });
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
      const verificationQuestion = this.imageGenState.iterations === 1
        ? 'I\'ve crafted an image prompt. Would you like to generate the image or provide feedback?'
        : 'I\'ve updated the prompt based on your feedback. Would you like to generate the image or provide more feedback?';

      return {
        status: 'awaiting_prompt_approval',
        prompt: this.imageGenState.currentPrompt,
        negative_prompt: this.imageGenState.negativePrompt,
        aspect_ratio: this.imageGenState.aspectRatio,
        task: this.imageGenState.task,
        iterations: this.imageGenState.iterations,
        question: verificationQuestion,
        options: [
          { label: 'Generate image', description: 'Proceed with this prompt and generate the image' },
          { label: 'Provide feedback', description: 'Modify the prompt with your input' },
        ],
      };
    } catch (error) {
      this.imageGenState = null;
      return {
        error: `Image prompt generation failed: ${String(error)}`,
        task: this.imageGenState?.task,
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
    const promptMatch = response.match(/\*\*Image Prompt:\*\*\s*\n([^\n*]+(?:\n(?!\*\*)[^\n*]+)*)/i);
    if (promptMatch) {
      prompt = promptMatch[1].trim();
    }

    // Try to extract Negative Prompt section
    const negativeMatch = response.match(/\*\*Negative Prompt:\*\*\s*\n([^\n*]+(?:\n(?!\*\*)[^\n*]+)*)/i);
    if (negativeMatch) {
      negativePrompt = negativeMatch[1].trim();
    }

    // Try to extract Aspect Ratio section
    const aspectMatch = response.match(/\*\*Aspect Ratio:\*\*\s*\n?\s*([^\n]+)/i);
    if (aspectMatch) {
      const ratio = aspectMatch[1].trim();
      // Validate aspect ratio format
      if (/^\d+:\d+$/.test(ratio)) {
        aspectRatio = ratio;
      }
    }

    // If no structured prompt found, use the whole response as the prompt
    if (!prompt) {
      // Remove markdown headers and rationale sections
      prompt = response
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
    const classificationPrompt = `You are a simple intent classifier. Determine if the user's response indicates they want to APPROVE and generate the image, or if they are providing FEEDBACK to modify the prompt.

<user_response>
${userResponse}
</user_response>

Respond with exactly one word: "APPROVE" or "FEEDBACK"

Examples of APPROVE responses:
- "yes", "ok", "generate", "looks good", "go ahead", "create it", "make it", "proceed", "lgtm", "y", "1"

Examples of FEEDBACK responses:
- "make it more colorful", "add more detail", "change the lighting", "I want...", "can you...", "no", "2"

Your classification:`;

    try {
      const response = await this.llm.generate({
        messages: [
          { role: 'user', content: classificationPrompt },
        ],
        temperature: 0,
        maxTokens: 10,
      });

      const result = (response.content ?? '').trim().toUpperCase();
      return result.includes('APPROVE');
    } catch {
      // On error, fall back to simple pattern matching
      const lower = userResponse.toLowerCase().trim();
      const approvalPatterns = ['yes', 'ok', 'okay', 'generate', 'go', 'create', 'make', 'proceed', 'lgtm', 'y', '1'];
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
      return {
        error: 'generate_image tool not available',
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

    // Emit that we're generating the image
    this.emit({
      type: 'tool_call',
      toolCallId: `img-gen-${Date.now()}`,
      toolName: 'generate_image',
      arguments: generateArgs,
      agentName: this.name,
    });

    try {
      // Execute the image generation
      const result = await Promise.resolve(generateImageTool.handler(generateArgs));

      // Clear the state
      const finalState = { ...this.imageGenState };
      this.imageGenState = null;

      // Emit tool result
      this.emit({
        type: 'tool_result',
        toolCallId: `img-gen-${Date.now()}`,
        toolName: 'generate_image',
        result,
        isError: false,
        agentName: this.name,
      });

      return {
        status: 'completed',
        prompt: finalState.currentPrompt,
        negative_prompt: finalState.negativePrompt,
        aspect_ratio: finalState.aspectRatio,
        task: finalState.task,
        iterations: finalState.iterations,
        generation_result: result,
        message: 'Image generated successfully.',
      };
    } catch (error) {
      this.imageGenState = null;
      return {
        error: `Image generation failed: ${String(error)}`,
        prompt: currentPrompt,
        task,
      };
    }
  }

  /**
   * Handle ask_user tool - pauses execution.
   * Supports confirmation, free-form, and multiple choice questions.
   */
  private handleAskUser(toolCall: ToolCall): GenericAgentResult | null {
    const args = toolCall.arguments;
    const question = args['question'] as string;
    const isConfirmation = (args['is_confirmation'] as boolean | undefined) ?? false;
    const options = args['options'] as Array<{ label: string; description?: string }> | undefined;

    this.waitingForUser = true;
    this.pendingQuestion = question;

    const toolResult = {
      status: 'waiting_for_user',
      question,
      is_confirmation: isConfirmation,
      options: options ?? null,
    };

    this.messages.push({
      role: 'tool',
      content: JSON.stringify(toolResult),
      toolCallId: toolCall.id,
      name: toolCall.name,
    });

    // Emit question event with options
    this.emit({
      type: 'question',
      question,
      isConfirmation,
      options,
      data: args['data'] as Record<string, unknown> | undefined,
    });

    return {
      status: 'waiting_for_user',
      output: question,
      todos: this.todoManager.getTodos(),
      pendingQuestion: question,
      isConfirmation,
      options,
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
              const approved = approvalKeywords.some(kw =>
                response.toLowerCase().includes(kw)
              );

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
   * Inject todo reminder after the first system message.
   */
  private injectTodoReminder(): Message[] {
    if (this.todoManager.getTodos().length === 0) {
      return [...this.messages];
    }

    const reminder: Message = {
      role: 'system',
      content: this.todoManager.toReminderText(),
    };

    // Insert after the first system message
    const firstMsg = this.messages[0];
    if (firstMsg) {
      return [firstMsg, reminder, ...this.messages.slice(1)];
    }
    return [reminder, ...this.messages];
  }
}

// Re-export tool categories for external use
export { SIMPLE_TOOLS, COMPLEX_TOOLS, isComplexTool };

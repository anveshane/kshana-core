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
import type { LLMClient, Message, ToolCall, ToolDefinition } from '../llm/index.js';
import { ExpandableTodoManager, type ExpandableTodoItem } from '../todo/index.js';
import { buildSystemMessage } from '../prompts/index.js';
import type { AgentConfig, AgentStatus, GenericAgentResult } from './AgentResult.js';

/**
 * Tool categories - simple tools execute immediately, complex require confirmation.
 */
const SIMPLE_TOOLS = new Set([
  'think',
  'ask_user',
  'dispatch_agent',
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
   * Run the agent on a task.
   * Returns when completed, errored, or waiting for user input.
   */
  async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    // Reset abort state for new run
    this.aborted = false;

    // Emit started status
    this.emit({ type: 'agent_status', status: 'started', agentName: this.name });

    // Resume from user question or start fresh
    if (userResponse && this.waitingForUser && this.messages.length > 0) {
      this.handleUserResponse(userResponse);
      this.waitingForUser = false;
      this.pendingQuestion = undefined;
    } else if (!this.waitingForUser) {
      // Start fresh
      this.messages = [
        { role: 'system', content: this.buildSystemMessage() },
        { role: 'user', content: task },
      ];
      this.iteration = 0;
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

        // Add user input as a new message
        this.messages.push({
          role: 'user',
          content: `[User interjection during execution]: ${userInput}`,
        });

        // Emit event
        this.emit({ type: 'agent_text', text: `User: ${userInput}`, isFinal: false });
      }

      this.iteration++;

      // Emit thinking status
      this.emit({ type: 'agent_status', status: 'thinking', agentName: this.name });

      // Build messages with todo reminder injected
      const messagesWithReminder = this.injectTodoReminder();

      // Get LLM response
      const response = await this.llm.generate({
        messages: messagesWithReminder,
        tools: Array.from(this.tools.values()),
        temperature: 0.7,
      });

      // Add assistant message to history
      this.messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // Emit streaming text event
      if (response.content) {
        this.emit({ type: 'agent_text', text: response.content, isFinal: false });
      }

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

  /**
   * Handle dispatch_agent tool - spawns a sub-agent for planning.
   */
  private async handleDispatchAgent(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const context = args['context'] as string | undefined;

    if (!task) {
      return { error: 'No task provided for dispatch_agent' };
    }

    // Build context section if provided
    const contextSection = context
      ? `\n\nContext/Background:\n${context}\n`
      : '';

    // Create a sub-agent for planning
    const planningPrompt = `You are a planning assistant. Analyze the following task and create a detailed, actionable plan.
${contextSection}
Task: ${task}

Provide a structured plan with:
1. Clear steps to accomplish the task
2. Any prerequisites or dependencies
3. Potential challenges and solutions
4. Expected outcomes for each step

Be specific and actionable. Your plan will be used to create a todo list for execution.`;

    try {
      // Make a single LLM call for planning
      const response = await this.llm.generate({
        messages: [
          { role: 'system', content: planningPrompt },
          { role: 'user', content: task },
        ],
        temperature: 0.7,
      });

      const plan = response.content || 'No plan generated';

      return {
        status: 'success',
        plan,
        task,
      };
    } catch (error) {
      return {
        error: `Planning failed: ${String(error)}`,
        task,
      };
    }
  }

  /**
   * Handle ask_user tool - pauses execution.
   */
  private handleAskUser(toolCall: ToolCall): GenericAgentResult | null {
    const args = toolCall.arguments;
    const question = args['question'] as string;
    const isConfirmation = (args['is_confirmation'] as boolean | undefined) ?? false;

    this.waitingForUser = true;
    this.pendingQuestion = question;

    const toolResult = {
      status: 'waiting_for_user',
      question,
      is_confirmation: isConfirmation,
    };

    this.messages.push({
      role: 'tool',
      content: JSON.stringify(toolResult),
      toolCallId: toolCall.id,
      name: toolCall.name,
    });

    // Emit question event
    this.emit({
      type: 'question',
      question,
      isConfirmation,
      data: args['data'] as Record<string, unknown> | undefined,
    });

    return {
      status: 'waiting_for_user',
      output: question,
      todos: this.todoManager.getTodos(),
      pendingQuestion: question,
      isConfirmation,
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

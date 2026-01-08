/**
 * SDKMessageAdapter - The keystone component that bridges the agent harness with existing UI.
 *
 * This adapter translates streaming LLM responses (using existing LLMClient) into events
 * compatible with the existing TypedEventEmitter system, enabling zero UI changes.
 *
 * Implements Claude Code SDK harness patterns with flexible LLM backend.
 */

import { TypedEventEmitter } from '../events/index.js';
import type { ToolCall } from '../core/llm/types.js';

interface ActiveTool {
  name: string;
  startTime: number;
  input?: Record<string, unknown>;
}

export interface StreamChunk {
  text?: string;
  tool_calls?: ToolCall[];
  done?: boolean;
}

/**
 * Adapter that consumes LLMClient streaming chunks and emits events
 * compatible with the existing event system.
 *
 * Following Claude Code SDK harness patterns but using our existing LLMClient.
 */
export class SDKMessageAdapter extends TypedEventEmitter {
  private activeTools = new Map<string, ActiveTool>();
  private currentStreamingText = '';
  private agentName: string;

  constructor(agentName: string = 'Agent') {
    super();
    this.agentName = agentName;
  }

  /**
   * Consume LLMClient streaming chunks and emit compatible events.
   */
  async consumeStreamingChunks(
    stream: AsyncIterable<StreamChunk>,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      this.emit({
        type: 'agent_status',
        status: 'thinking',
        agentName: this.agentName,
      });

      for await (const chunk of stream) {
        if (signal?.aborted) {
          break;
        }

        await this.handleChunk(chunk);
      }

      // Emit final streaming done
      if (this.currentStreamingText) {
        this.emit({
          type: 'streaming_text',
          chunk: '',
          done: true,
        });
        this.currentStreamingText = '';
      }
    } catch (error) {
      this.emit({
        type: 'agent_status',
        status: 'error',
        agentName: this.agentName,
      });
      throw error;
    }
  }

  /**
   * Handle individual streaming chunks.
   */
  private async handleChunk(chunk: StreamChunk): Promise<void> {
    // Handle text streaming
    if (chunk.text) {
      this.handleTextChunk(chunk.text);
    }

    // Handle tool calls
    if (chunk.tool_calls && chunk.tool_calls.length > 0) {
      for (const toolCall of chunk.tool_calls) {
        this.handleToolCall(toolCall);
      }
    }

    // Handle completion
    if (chunk.done) {
      if (this.currentStreamingText) {
        this.emit({
          type: 'streaming_text',
          chunk: '',
          done: true,
        });
        this.currentStreamingText = '';
      }
    }
  }

  /**
   * Handle text chunk (streaming text).
   */
  private handleTextChunk(text: string): void {
    this.currentStreamingText += text;

    this.emit({
      type: 'streaming_text',
      chunk: text,
      done: false,
    });
  }

  /**
   * Handle tool call.
   */
  private handleToolCall(toolCall: ToolCall): void {
    const toolCallId = toolCall.id;
    const toolName = toolCall.name;
    const toolInput = toolCall.arguments as Record<string, unknown>;

    this.activeTools.set(toolCallId, {
      name: toolName,
      startTime: Date.now(),
      input: toolInput,
    });

    this.emit({
      type: 'tool_call',
      toolCallId,
      toolName,
      arguments: toolInput,
      agentName: this.agentName,
    });
  }

  /**
   * Emit tool result event (called externally after tool execution).
   */
  emitToolResult(toolCallId: string, result: unknown, isError: boolean = false): void {
    const tool = this.activeTools.get(toolCallId);

    if (tool) {
      this.emit({
        type: 'tool_result',
        toolCallId,
        toolName: tool.name,
        result,
        isError,
        agentName: this.agentName,
      });

      this.activeTools.delete(toolCallId);
    }
  }

  /**
   * Emit question event (for ask_user tool).
   */
  emitQuestion(
    question: string,
    isConfirmation: boolean = false,
    options?: Array<{ label: string; description?: string }>,
    autoApproveTimeoutMs?: number
  ): void {
    this.emit({
      type: 'question',
      question,
      isConfirmation,
      options,
      autoApproveTimeoutMs,
    });
  }

  /**
   * Emit todo update event.
   */
  emitTodoUpdate(todos: unknown[]): void {
    this.emit({
      type: 'todo_update',
      todos,
    });
  }

  /**
   * Emit agent status event.
   */
  emitStatus(status: 'started' | 'thinking' | 'waiting' | 'completed' | 'error' | 'interrupted'): void {
    this.emit({
      type: 'agent_status',
      status,
      agentName: this.agentName,
    });
  }

  /**
   * Get agent name.
   */
  getAgentName(): string {
    return this.agentName;
  }

  /**
   * Set agent name (for sub-agents).
   */
  setAgentName(name: string): void {
    this.agentName = name;
  }

  /**
   * Get active tools.
   */
  getActiveTools(): Map<string, ActiveTool> {
    return this.activeTools;
  }

  /**
   * Clear all active tools.
   */
  clearActiveTools(): void {
    this.activeTools.clear();
  }
}

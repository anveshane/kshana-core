/**
 * Core LLM types for the agent framework.
 * Designed for OpenAI-compatible APIs.
 */

/**
 * A tool call requested by the LLM.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * LLM response after generation.
 */
export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Conversation message roles.
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * A conversation message.
 */
export interface Message {
  role: MessageRole;
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

/**
 * JSON Schema for tool parameters.
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Context passed to tool handlers for streaming progress updates.
 */
export interface ToolContext {
  /**
   * Stream a progress update during long-running operations.
   * The chunk will be displayed in the UI as a streaming message.
   */
  streamProgress?: (chunk: string) => void;
  /**
   * Get the current tool call ID.
   */
  getToolCallId?: () => string;
}

/**
 * Tool definition for the LLM.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  handler?: (args: Record<string, unknown>, context?: ToolContext) => unknown | Promise<unknown>;
}

/**
 * Streaming chunk from LLM.
 */
export interface StreamChunk {
  content?: string;
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  };
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Options for LLM generation.
 */
export interface GenerateOptions {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/**
 * LLM client configuration.
 */
export interface LLMClientConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

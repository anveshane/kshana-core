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
  /**
   * Provider reasoning payload returned by reasoning/thinking models.
   * Kept for provider protocol continuity only; do not display to users.
   */
  reasoning?: string;
  reasoningDetails?: unknown[];
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
  /**
   * Provider reasoning payload to replay on follow-up requests when required
   * by reasoning/thinking models during tool use.
   */
  reasoning?: string;
  reasoningDetails?: unknown[];
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
 * Tool definition for the LLM.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  handler?: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

/**
 * Streaming chunk from LLM.
 */
export interface StreamChunk {
  content?: string;
  reasoning?: string;
  reasoningDetails?: unknown[];
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
  responseFormat?:
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: { name: string; strict?: boolean; schema: Record<string, unknown> };
      };
}

/**
 * LLM client configuration.
 */
export interface LLMClientConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  /**
   * Whether the LLM has implicit thinking capability (e.g., DeepSeek, Claude extended thinking).
   * When true:
   * - The explicit 'think' tool should be disabled (redundant)
   * - Content inside <think> tags should be emitted as 'streaming_think' events
   * - The UI should display thinking content in a dedicated area
   * Can also be set via LLM_IMPLICIT_THINKING=true environment variable.
   */
  hasImplicitThinking?: boolean;
  /**
   * Custom headers to send with each request.
   * Useful for providers that require additional authentication or metadata.
   */
  defaultHeaders?: Record<string, string>;
  /**
   * Organization ID for providers that support it (e.g., OpenAI).
   */
  organization?: string;
}

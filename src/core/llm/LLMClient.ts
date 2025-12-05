/**
 * OpenAI-compatible LLM client with streaming support.
 */
import OpenAI from 'openai';
import type {
  Message,
  ToolDefinition,
  LLMResponse,
  ToolCall,
  StreamChunk,
  GenerateOptions,
  LLMClientConfig,
} from './types.js';

export class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(config: LLMClientConfig = {}) {
    this.client = new OpenAI({
      baseURL: config.baseUrl ?? process.env['LLM_BASE_URL'] ?? 'http://127.0.0.1:1234/v1',
      apiKey: config.apiKey ?? process.env['LLM_API_KEY'] ?? 'not-needed',
    });
    this.model = config.model ?? process.env['LLM_MODEL'] ?? 'local-model';
  }

  /**
   * Generate a response from the LLM.
   */
  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature = 0.7, maxTokens } = options;

    const request: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: this.convertMessages(messages),
      temperature,
      stream: false,
    };

    if (maxTokens) request.max_tokens = maxTokens;
    if (tools && tools.length > 0) {
      request.tools = this.convertTools(tools);
    }

    const response = await this.client.chat.completions.create(request);
    return this.parseResponse(response);
  }

  /**
   * Generate a streaming response from the LLM.
   */
  async *generateStream(
    options: Omit<GenerateOptions, 'stream'>
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const { messages, tools, temperature = 0.7 } = options;

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: this.convertMessages(messages),
      tools: tools ? this.convertTools(tools) : undefined,
      temperature,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        yield { content: delta.content, done: false };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          yield {
            toolCallDelta: {
              index: tc.index,
              id: tc.id,
              name: tc.function?.name,
              arguments: tc.function?.arguments,
            },
            done: false,
          };
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        yield { done: true };
      }
    }
  }

  /**
   * Convert internal messages to OpenAI format.
   */
  private convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map(msg => {
      if (msg.role === 'system') {
        return { role: 'system' as const, content: msg.content ?? '' };
      }
      if (msg.role === 'user') {
        return { role: 'user' as const, content: msg.content ?? '' };
      }
      if (msg.role === 'assistant') {
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: msg.content ?? '',
        };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        return assistantMsg;
      }
      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: msg.toolCallId ?? '',
          content: msg.content ?? '',
        };
      }
      throw new Error(`Unknown message role: ${msg.role}`);
    });
  }

  /**
   * Convert internal tool definitions to OpenAI format.
   */
  private convertTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown>,
      },
    }));
  }

  /**
   * Parse OpenAI response to internal format.
   */
  private parseResponse(response: OpenAI.ChatCompletion): LLMResponse {
    const choice = response.choices[0];
    if (!choice) {
      return { content: null, toolCalls: [], finishReason: null };
    }

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: this.safeParseJson(tc.function.arguments),
    }));

    return {
      content: this.cleanContent(choice.message.content),
      toolCalls,
      finishReason: choice.finish_reason,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * Safely parse JSON, returning empty object on failure.
   */
  private safeParseJson(str: string): Record<string, unknown> {
    try {
      return JSON.parse(str) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /**
   * Clean LLM content (remove <think> tags, etc.).
   */
  private cleanContent(content: string | null): string | null {
    if (!content) return null;
    // Remove <think> tags from reasoning models
    return content.replace(/<think>.*?<\/think>/gs, '').trim();
  }
}

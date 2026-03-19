/**
 * OpenAI-compatible LLM client with streaming support.
 */

// Load environment variables from .env for standalone usage
import 'dotenv/config';
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
import { getLLMLogger } from './LLMLogger.js';

/**
 * Known context lengths for common model families.
 * Used as a fallback when the provider doesn't report context length.
 * Patterns are matched case-insensitively against the model ID.
 */
const KNOWN_MODEL_CONTEXT_LENGTHS: Array<{ pattern: RegExp; contextLength: number }> = [
  // Qwen models
  { pattern: /qwen.*2\.5.*coder.*32b/i, contextLength: 32768 },
  { pattern: /qwen.*2\.5/i, contextLength: 32768 },
  { pattern: /qwen.*3/i, contextLength: 32768 },
  // Llama models
  { pattern: /llama.*3\.3/i, contextLength: 131072 },
  { pattern: /llama.*3\.2/i, contextLength: 131072 },
  { pattern: /llama.*3\.1/i, contextLength: 131072 },
  { pattern: /llama.*3/i, contextLength: 8192 },
  // Mistral / Mixtral
  { pattern: /mistral.*large/i, contextLength: 131072 },
  { pattern: /mistral.*nemo/i, contextLength: 131072 },
  { pattern: /mixtral/i, contextLength: 32768 },
  { pattern: /mistral/i, contextLength: 32768 },
  // DeepSeek
  { pattern: /deepseek.*v3/i, contextLength: 65536 },
  { pattern: /deepseek.*v2/i, contextLength: 32768 },
  { pattern: /deepseek.*coder/i, contextLength: 32768 },
  { pattern: /deepseek/i, contextLength: 32768 },
  // Gemma
  { pattern: /gemma.*2.*27b/i, contextLength: 8192 },
  { pattern: /gemma.*2/i, contextLength: 8192 },
  { pattern: /gemma/i, contextLength: 8192 },
  // Phi
  { pattern: /phi.*4/i, contextLength: 16384 },
  { pattern: /phi.*3/i, contextLength: 131072 },
  // Command R
  { pattern: /command.*r.*plus/i, contextLength: 131072 },
  { pattern: /command.*r/i, contextLength: 131072 },
];

/**
 * Try to infer context length from the model name/ID.
 * Returns null if no match is found.
 */
function inferContextLengthFromModel(modelId: string): number | null {
  for (const { pattern, contextLength } of KNOWN_MODEL_CONTEXT_LENGTHS) {
    if (pattern.test(modelId)) {
      return contextLength;
    }
  }
  return null;
}

export class LLMClient {
  private client: OpenAI;
  private model: string;
  private baseUrl: string;
  private cachedContextLength: number | null = null;
  private _hasImplicitThinking: boolean;

  constructor(config: LLMClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? process.env['LLM_BASE_URL'] ?? 'http://127.0.0.1:1234/v1';

    const apiKey = config.apiKey ?? process.env['LLM_API_KEY'] ?? 'not-needed';
    const organization = config.organization ?? process.env['LLM_ORGANIZATION'];
    const defaultHeaders = config.defaultHeaders ?? this.parseDefaultHeaders();

    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey,
      timeout: 5 * 60 * 1000, // 5 minutes for thinking/reasoning models
      organization,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    });
    this.model = config.model ?? process.env['LLM_MODEL'] ?? 'local-model';
    // Check config, then env var for implicit thinking capability
    this._hasImplicitThinking =
      config.hasImplicitThinking ?? process.env['LLM_IMPLICIT_THINKING']?.toLowerCase() === 'true';
  }

  /**
   * Parse default headers from environment variable.
   * Format: LLM_DEFAULT_HEADERS="Header1:Value1,Header2:Value2"
   */
  private parseDefaultHeaders(): Record<string, string> {
    const headersEnv = process.env['LLM_DEFAULT_HEADERS'];
    if (!headersEnv) return {};

    const headers: Record<string, string> = {};
    for (const pair of headersEnv.split(',')) {
      const [key, ...valueParts] = pair.split(':');
      if (key && valueParts.length > 0) {
        headers[key.trim()] = valueParts.join(':').trim();
      }
    }
    return headers;
  }

  /**
   * Check if the LLM has implicit thinking capability.
   * When true, the LLM outputs <think> tags naturally and the explicit 'think' tool should be disabled.
   */
  get hasImplicitThinking(): boolean {
    return this._hasImplicitThinking;
  }

  /**
   * Get the model's context length from the provider.
   * Queries /v1/models endpoint and extracts context_length.
   * Falls back to env var LLM_CONTEXT_TOKENS or default if not available.
   */
  async getContextLength(): Promise<number> {
    // Return cached value if available
    if (this.cachedContextLength !== null) {
      return this.cachedContextLength;
    }

    const DEFAULT_CONTEXT = 16000;
    const envContextLength = process.env['LLM_CONTEXT_TOKENS'];

    // Env var takes priority — it's the user's explicit override
    if (envContextLength) {
      const parsed = parseInt(envContextLength, 10);
      if (parsed > 0) {
        this.cachedContextLength = parsed;
        this.validateContextLength(parsed);
        return parsed;
      }
    }

    try {
      // Query the models endpoint
      const response = await fetch(`${this.baseUrl}/models`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = (await response.json()) as {
        data?: Array<{
          id: string;
          context_length?: number;
          max_context_length?: number;
          // LM Studio specific fields
          max_model_len?: number;
        }>;
      };

      // Find our model in the list
      const modelInfo = data.data?.find(
        m => m.id === this.model || m.id.toLowerCase().includes(this.model.toLowerCase())
      );

      // Try various field names that providers use
      const contextLength =
        modelInfo?.context_length ??
        modelInfo?.max_context_length ??
        modelInfo?.max_model_len ??
        null;

      if (contextLength && contextLength > 0) {
        this.cachedContextLength = contextLength;
        this.validateContextLength(contextLength);
        return contextLength;
      }
    } catch (error) {
      // Silently fall back - many providers don't support this endpoint
    }

    // Try to infer from model name as a better fallback than 16000
    const inferred = inferContextLengthFromModel(this.model);
    if (inferred) {
      this.cachedContextLength = inferred;
      this.validateContextLength(inferred);
      return inferred;
    }

    // Last resort fallback
    console.warn(
      `[LLMClient] Could not determine context length for model "${this.model}". ` +
      `Falling back to ${DEFAULT_CONTEXT} tokens. Set LLM_CONTEXT_TOKENS env var to override.`
    );
    this.cachedContextLength = DEFAULT_CONTEXT;
    this.validateContextLength(DEFAULT_CONTEXT);

    return DEFAULT_CONTEXT;
  }

  /**
   * Validate that context length meets minimum requirements.
   * Throws an error if context is too small to run effectively.
   */
  private validateContextLength(contextLength: number): void {
    const MIN_CONTEXT_LENGTH = 8000;
    if (contextLength < MIN_CONTEXT_LENGTH) {
      throw new Error(
        `Context length (${contextLength} tokens) is below minimum required (${MIN_CONTEXT_LENGTH} tokens).\n` +
          `The agent cannot run effectively with such a small context window.\n` +
          `Please either:\n` +
          `  1. Use a model with larger context (recommended: 16000+ tokens)\n` +
          `  2. Increase the context in LM Studio model settings\n` +
          `  3. Set LLM_CONTEXT_TOKENS=${MIN_CONTEXT_LENGTH} or higher in .env`
      );
    }
  }

  /**
   * Get the current model name.
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Generate a response from the LLM.
   */
  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const { messages, tools, temperature = 0.7, maxTokens, responseFormat } = options;
    const logger = getLLMLogger();

    // Log request
    logger.logRequest(messages, tools, { temperature });

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
    if (responseFormat) {
      request.response_format = responseFormat;
    }

    const response = await this.client.chat.completions.create(request);
    const result = this.parseResponse(response);

    // Log response
    logger.logResponse(result);

    return result;
  }

  /**
   * Generate a streaming response from the LLM.
   */
  async *generateStream(
    options: Omit<GenerateOptions, 'stream'>
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const { messages, tools, temperature = 0.7, responseFormat } = options;
    const logger = getLLMLogger();

    // Log request
    logger.logRequest(messages, tools, { temperature });

    const request: OpenAI.ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages: this.convertMessages(messages),
      tools: tools ? this.convertTools(tools) : undefined,
      temperature,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (responseFormat) {
      request.response_format = responseFormat;
    }

    const stream = await this.client.chat.completions.create(request);

    // Accumulate for final logging
    let fullContent = '';
    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> =
      new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      // Reasoning models may send content via reasoning_content delta
      const deltaAny = delta as unknown as Record<string, unknown> | undefined;
      const textChunk = delta?.content
        || (deltaAny?.['reasoning_content'] as string | undefined)
        || '';
      if (textChunk) {
        fullContent += textChunk;
        logger.logStreamChunk(textChunk);
        yield { content: textChunk, done: false };
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          // Accumulate tool calls for logging
          let acc = toolCallAccumulators.get(tc.index);
          if (!acc) {
            acc = { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' };
            toolCallAccumulators.set(tc.index, acc);
          }
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) acc.arguments += tc.function.arguments;

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
        // Build final tool calls for logging
        const toolCalls: ToolCall[] = [];
        for (const [, acc] of toolCallAccumulators) {
          if (acc.id && acc.name) {
            try {
              toolCalls.push({
                id: acc.id,
                name: acc.name,
                arguments: acc.arguments ? JSON.parse(acc.arguments) : {},
              });
            } catch {
              toolCalls.push({
                id: acc.id,
                name: acc.name,
                arguments: {},
              });
            }
          }
        }

        // Log complete response
        logger.logStreamComplete({
          content: fullContent || null,
          toolCalls,
          finishReason: chunk.choices[0].finish_reason,
        });

        // Include usage if available (requires stream_options: { include_usage: true })
        const usage = chunk.usage
          ? {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            }
          : undefined;

        yield { done: true, usage };
      } else if (chunk.usage && (!chunk.choices || chunk.choices.length === 0)) {
        // llama.cpp sends usage in a separate final chunk with empty choices array.
        // Yield it as a usage-only update so context tracking picks it up.
        yield {
          done: true,
          usage: {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          },
        };
      }
    }
  }

  /**
   * Convert internal messages to OpenAI format.
   */
  private convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
    // Consolidate all system messages into a single one at the start.
    // Many local models (Llama, etc.) require exactly one system message at the beginning.
    const systemParts: string[] = [];
    const nonSystemMessages: Message[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        if (msg.content) systemParts.push(msg.content);
      } else {
        nonSystemMessages.push(msg);
      }
    }

    const result: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemParts.length > 0) {
      result.push({ role: 'system' as const, content: systemParts.join('\n\n') });
    }

    for (const msg of nonSystemMessages) {
      if (msg.role === 'user') {
        result.push({ role: 'user' as const, content: msg.content ?? '' });
      } else if (msg.role === 'assistant') {
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
        result.push(assistantMsg);
      } else if (msg.role === 'tool') {
        result.push({
          role: 'tool' as const,
          tool_call_id: msg.toolCallId ?? '',
          content: msg.content ?? '',
        });
      } else {
        throw new Error(`Unknown message role: ${msg.role}`);
      }
    }

    return result;
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

    // Reasoning models (deepseek format) put output in reasoning_content with empty content
    const msg = choice.message as unknown as Record<string, unknown>;
    const rawContent = (choice.message.content as string | null)
      || (msg['reasoning_content'] as string | null)
      || null;

    return {
      content: this.cleanContent(rawContent),
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
    let cleaned = content
      .replace(/<think>.*?<\/think>/gs, '') // Complete think blocks
      .replace(/<think>.*$/gs, '') // Orphan opening tag (no closing)
      .replace(/<\/think>/g, ''); // Orphan closing tag (no opening)
    return cleaned.trim();
  }
}

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
import { getLLMLogger } from './LLMLogger.js';

const DEFAULT_TRANSIENT_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /ENOTFOUND/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
  /network error/i,
  /fetch failed/i,
  /connection reset/i,
];

export class LLMClient {
  private client: OpenAI;
  private model: string;
  private baseUrl: string;
  private cachedContextLength: number | null = null;
  private isGeminiProvider: boolean;

  constructor(config: LLMClientConfig = {}) {
    const provider = process.env['LLM_PROVIDER']?.toLowerCase();

    if (provider === 'gemini') {
      this.baseUrl = config.baseUrl ?? process.env['LLM_BASE_URL'] ?? 'https://generativelanguage.googleapis.com/v1beta/openai/';
      this.client = new OpenAI({
        baseURL: this.baseUrl,
        apiKey: config.apiKey ?? process.env['GEMINI_API_KEY'] ?? process.env['LLM_API_KEY'] ?? 'not-needed',
      });
      // Gemini models usually default to gemini-1.5-flash unless specified
      this.model = config.model ?? process.env['LLM_MODEL'] ?? 'gemini-1.5-flash';
      this.isGeminiProvider = true;
    } else {
      // Default / Local
      this.baseUrl = config.baseUrl ?? process.env['LLM_BASE_URL'] ?? 'http://127.0.0.1:1234/v1';
      this.client = new OpenAI({
        baseURL: this.baseUrl,
        apiKey: config.apiKey ?? process.env['LLM_API_KEY'] ?? 'not-needed',
      });
      this.model = config.model ?? process.env['LLM_MODEL'] ?? 'local-model';
      // Also check baseUrl to detect Gemini even if provider env var isn't set
      this.isGeminiProvider = this.baseUrl.includes('generativelanguage.googleapis.com');
    }
  }

  private getMaxTransientRetries(): number {
    const rawValue = process.env['LLM_TRANSIENT_RETRIES'];
    if (!rawValue) return DEFAULT_TRANSIENT_RETRIES;
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_TRANSIENT_RETRIES;
    }
    return parsed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getRetryDelayMs(attempt: number): number {
    const baseDelay = Math.min(500 * 2 ** attempt, 4000);
    const jitter = Math.floor(Math.random() * 250);
    return baseDelay + jitter;
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }

    if ('status' in error) {
      return error.status as number;
    }
    if ('statusCode' in error) {
      return error.statusCode as number;
    }
    if (
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'status' in error.response
    ) {
      return error.response.status as number;
    }
    return undefined;
  }

  private isRetryableError(
    error: unknown,
    statusCode?: number,
  ): boolean {
    if (typeof statusCode === 'number' && RETRYABLE_STATUS_CODES.has(statusCode)) {
      return true;
    }

    const message = this.getErrorMessage(error);
    return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
  }

  private buildEnhancedError(
    prefix: string,
    error: unknown,
    statusCode?: number,
  ): Error {
    const errorMessage = this.getErrorMessage(error);
    const enhancedError = new Error(
      `${prefix}: ${errorMessage}${statusCode ? ` (status: ${statusCode})` : ''}`,
    );
    if (error instanceof Error && error.stack) {
      enhancedError.stack = error.stack;
    }
    return enhancedError;
  }

  private async createStreamingCompletion(
    requestParams: OpenAI.ChatCompletionCreateParamsStreaming,
  ): Promise<AsyncIterable<OpenAI.ChatCompletionChunk>> {
    try {
      return await this.client.chat.completions.create(requestParams) as AsyncIterable<OpenAI.ChatCompletionChunk>;
    } catch (error: unknown) {
      const statusCode = this.extractStatusCode(error);

      // If we get a 400 and stream_options was included, retry once without it.
      if (statusCode === 400 && requestParams.stream_options) {
        console.warn(
          '[LLMClient] Got 400 with stream_options, retrying streaming request without stream_options...',
        );
        const retryParams: OpenAI.ChatCompletionCreateParamsStreaming = {
          model: requestParams.model,
          messages: requestParams.messages,
          tools: requestParams.tools,
          temperature: requestParams.temperature,
          stream: true,
        };
        return await this.client.chat.completions.create(retryParams) as AsyncIterable<OpenAI.ChatCompletionChunk>;
      }

      throw error;
    }
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

    try {
      // Query the models endpoint
      const response = await fetch(`${this.baseUrl}/models`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json() as {
        data?: Array<{
          id: string;
          context_length?: number;
          max_context_length?: number;
          // LM Studio specific fields
          max_model_len?: number;
        }>;
      };

      // Find our model in the list
      const modelInfo = data.data?.find(m =>
        m.id === this.model ||
        m.id.toLowerCase().includes(this.model.toLowerCase())
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

    // Fall back to env var or default
    const fallback = envContextLength ? parseInt(envContextLength, 10) : DEFAULT_CONTEXT;
    this.cachedContextLength = fallback;
    this.validateContextLength(fallback);

    return fallback;
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
    const { messages, tools, temperature = 0.7, maxTokens } = options;
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

    const maxRetries = this.getMaxTransientRetries();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await this.client.chat.completions.create(request);
        const result = this.parseResponse(response);

        // Log response
        logger.logResponse(result);

        return result;
      } catch (error: unknown) {
        const statusCode = this.extractStatusCode(error);
        const retryable = this.isRetryableError(error, statusCode);
        const errorMessage = this.getErrorMessage(error);

        if (retryable && attempt < maxRetries) {
          const delayMs = this.getRetryDelayMs(attempt);
          console.warn(
            `[LLMClient] Transient generate() failure (attempt ${attempt + 1}/${maxRetries + 1}): ${errorMessage}. Retrying in ${delayMs}ms...`,
          );
          await this.sleep(delayMs);
          continue;
        }

        console.error(
          `[LLMClient] API call failed: ${errorMessage}${statusCode ? ` (status: ${statusCode})` : ''}`,
        );
        throw this.buildEnhancedError('LLM API call failed', error, statusCode);
      }
    }

    // This is unreachable, but keeps TypeScript happy.
    throw new Error('LLM API call failed: retries exhausted');
  }

  /**
   * Generate a streaming response from the LLM.
   */
  async *generateStream(
    options: Omit<GenerateOptions, 'stream'>
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const { messages, tools, temperature = 0.7 } = options;
    const logger = getLLMLogger();

    // Log request
    logger.logRequest(messages, tools, { temperature });

    const maxRetries = this.getMaxTransientRetries();

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      // Build request - Gemini may not support stream_options
      const requestParams: OpenAI.ChatCompletionCreateParamsStreaming = {
        model: this.model,
        messages: this.convertMessages(messages),
        tools: tools ? this.convertTools(tools) : undefined,
        temperature,
        stream: true,
      };

      if (!this.isGeminiProvider) {
        requestParams.stream_options = { include_usage: true };
      }

      // Accumulate for final logging
      let fullContent = '';
      let emittedStreamChunk = false;
      let streamCompleted = false;
      const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();

      try {
        const stream = await this.createStreamingCompletion(requestParams);

        for await (const chunk of stream) {
          // Add safety check for stream chunks
          if (!chunk.choices || !Array.isArray(chunk.choices) || chunk.choices.length === 0) {
            console.warn('[LLMClient] Stream chunk missing choices array or empty, skipping chunk');
            continue;
          }

          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            fullContent += delta.content;
            emittedStreamChunk = true;
            logger.logStreamChunk(delta.content);
            yield { content: delta.content, done: false };
          }

          if (delta?.tool_calls) {
            emittedStreamChunk = true;
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
              finishReason: chunk.choices[0]?.finish_reason ?? null,
            });

            // Include usage if available (requires stream_options: { include_usage: true })
            const usage = chunk.usage
              ? {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              }
              : undefined;

            streamCompleted = true;
            yield { done: true, usage };
          }
        }

        // Some providers can end the stream without a finish chunk.
        if (!streamCompleted) {
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
          logger.logStreamComplete({
            content: fullContent || null,
            toolCalls,
            finishReason: 'stop',
          });
          yield { done: true };
        }

        return;
      } catch (error: unknown) {
        const statusCode = this.extractStatusCode(error);
        const retryable = this.isRetryableError(error, statusCode);
        const errorMessage = this.getErrorMessage(error);

        if (
          streamCompleted ||
          (retryable && emittedStreamChunk && toolCallAccumulators.size === 0 && fullContent.trim().length > 0)
        ) {
          // If the stream was interrupted after emitting only text, preserve already streamed content.
          console.warn(
            `[LLMClient] Streaming interrupted after partial text (${errorMessage}). Preserving partial response.`,
          );
          logger.logStreamComplete({
            content: fullContent || null,
            toolCalls: [],
            finishReason: 'network_interrupted',
          });
          yield { done: true };
          return;
        }

        if (retryable && !emittedStreamChunk && attempt < maxRetries) {
          const delayMs = this.getRetryDelayMs(attempt);
          console.warn(
            `[LLMClient] Transient generateStream() failure (attempt ${attempt + 1}/${maxRetries + 1}): ${errorMessage}. Retrying in ${delayMs}ms...`,
          );
          await this.sleep(delayMs);
          continue;
        }

        console.error(
          `[LLMClient] Streaming API call failed: ${errorMessage}${statusCode ? ` (status: ${statusCode})` : ''}`,
        );
        throw this.buildEnhancedError(
          'LLM streaming API call failed',
          error,
          statusCode,
        );
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
    // Validate response structure
    if (!response || !response.choices || !Array.isArray(response.choices)) {
      // Check for Gemini content filtering (indicated by completion_tokens: 0)
      const isContentFiltered = response?.usage?.completion_tokens === 0 && 
                                 response?.usage?.prompt_tokens > 0 &&
                                 this.isGeminiProvider;
      
      if (isContentFiltered) {
        console.error('[LLMClient] Gemini API blocked response due to content filtering. The prompt may have triggered safety filters.');
        console.error('[LLMClient] Response structure:', JSON.stringify(response, null, 2));
        console.error('[LLMClient] Suggestion: Try rephrasing the prompt or adjusting safety settings in Gemini API.');
      } else {
        console.error('[LLMClient] Invalid API response structure:', JSON.stringify(response, null, 2));
      }
      
      return {
        content: null,
        toolCalls: [],
        finishReason: null,
        usage: response?.usage
          ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
          : undefined,
      };
    }

    if (response.choices.length === 0) {
      // Check for Gemini content filtering
      const isContentFiltered = response.usage?.completion_tokens === 0 && 
                                 response.usage?.prompt_tokens > 0 &&
                                 this.isGeminiProvider;
      
      if (isContentFiltered) {
        console.warn('[LLMClient] Gemini API returned empty choices array - likely content filtering. completion_tokens: 0 indicates response was blocked.');
      } else {
        console.warn('[LLMClient] API returned empty choices array');
      }
      
      return {
        content: null,
        toolCalls: [],
        finishReason: null,
        usage: response.usage
          ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
          : undefined,
      };
    }

    const choice = response.choices[0];
    if (!choice) {
      return {
        content: null,
        toolCalls: [],
        finishReason: null,
        usage: response.usage
          ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
          : undefined,
      };
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

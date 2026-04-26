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
      timeout: 200 * 1000, // 200 seconds — prevent stuck reasoning loops
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
   * Review an image using the VLM (vision) capability.
   * Sends the image + a text prompt and returns the LLM's assessment.
   */
  async reviewImage(imagePath: string, reviewPrompt: string): Promise<{ pass: boolean; issues: string[] }> {
    const fs = await import('fs');
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = imagePath.endsWith('.jpg') || imagePath.endsWith('.jpeg') ? 'jpeg' : 'png';
    const dataUrl = `data:image/${ext};base64,${base64}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are a strict image quality inspector for AI-generated images. Examine the image for BOTH prompt adherence AND generation artifacts.

Respond with ONLY a JSON object: {"pass": true/false, "issues": ["issue1", "issue2"]}

FAIL the image if ANY of these are present:

**Anatomical errors:**
- Extra or missing limbs, fingers, hands, arms, legs
- Fused or merged body parts between subjects
- Wrong number of people (duplicated or missing subjects)
- Distorted faces, asymmetric eyes, melted features
- Impossible body proportions or poses

**Generation artifacts:**
- Blurry, smeared, or melted regions
- Incoherent object boundaries (objects merging into each other)
- Text or watermark artifacts
- Color banding, noise patches, or checkerboard patterns
- Duplicated elements (same object appearing twice unintentionally)
- Floating or disconnected body parts or objects

**Composition errors:**
- Subject completely missing from the frame
- Wrong subject (described a woman, shows a man, etc.)
- Scene completely different from the prompt description
- Key element from the prompt is absent

PASS the image ONLY if it is clean, coherent, anatomically correct, and reasonably matches the prompt. Minor stylistic differences are acceptable. Artifacts are NOT acceptable.`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Intended prompt: ${reviewPrompt}\n\nInspect this image carefully. Check for anatomical errors, generation artifacts, and prompt adherence.` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 200,
    });

    const text = response.choices[0]?.message?.content ?? '';
    try {
      // Try to parse JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          pass: Boolean(parsed.pass),
          issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        };
      }
    } catch {
      // If JSON parsing fails, check for pass/fail keywords
    }

    // Fallback: check if response indicates pass or fail
    const lower = text.toLowerCase();
    if (lower.includes('"pass": true') || lower.includes('pass')) {
      return { pass: true, issues: [] };
    }
    return { pass: false, issues: [text.substring(0, 200)] };
  }

  /**
   * General-purpose text completion: send a user message (and optional
   * system prompt) and return the raw response text. No image, no
   * tools, no streaming. Used by the fidelity judge in
   * `src/core/eval/vlmJudge.ts` for the prompt-aware comparison call
   * after the perception call has produced a description.
   */
  async chatText(
    userText: string,
    systemText?: string,
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemText) messages.push({ role: 'system', content: systemText });
    messages.push({ role: 'user', content: userText });

    const response = await this.client.chat.completions.create({
      model: this.model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
      temperature: opts?.temperature ?? 0.1,
      max_tokens: opts?.maxTokens ?? 2000,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  /**
   * General-purpose VLM call: send an image + a system/user prompt pair
   * and return the raw response text.
   *
   * Unlike `reviewImage` (which collapses the response into pass/fail),
   * this returns whatever the model generated — used by the structured
   * fidelity judge in `src/core/eval/vlmJudge.ts` which needs the full
   * JSON it asked for.
   */
  async chatWithImage(
    imagePath: string,
    userText: string,
    systemText?: string,
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const fs = await import('fs');
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString('base64');
    const ext = imagePath.endsWith('.jpg') || imagePath.endsWith('.jpeg') ? 'jpeg' : 'png';
    const dataUrl = `data:image/${ext};base64,${base64}`;

    const messages: Array<{ role: 'system' | 'user'; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> = [];
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    });

    // `reasoning.exclude: true` is an OpenRouter extension that tells
    // reasoning models (qwen3.5, deepseek-r1, etc.) to NOT emit a
    // chain-of-thought — without it, reasoning tokens consume the entire
    // max_tokens budget and `content` comes back null. Harmless for
    // non-reasoning models (the field is ignored).
    const response = await this.client.chat.completions.create({
      model: this.model,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: messages as any,
      temperature: opts?.temperature ?? 0.1,
      max_tokens: opts?.maxTokens ?? 2000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reasoning: { exclude: true } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    return response.choices[0]?.message?.content ?? '';
  }

  /**
   * Generate a streaming response from the LLM.
   */
  async *generateStream(
    options: Omit<GenerateOptions, 'stream'>
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const { messages, tools, temperature = 0.7, responseFormat, maxTokens } = options;
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
    if (maxTokens) {
      request.max_tokens = maxTokens;
    }

    // Total wall-clock timeout for the entire streaming call (including thinking)
    const STREAM_TIMEOUT_MS = 200_000; // 200 seconds
    const abortController = new AbortController();
    const abortTimer = setTimeout(() => {
      console.error(`[LLMClient] Hard timeout at ${STREAM_TIMEOUT_MS / 1000}s — aborting stream`);
      abortController.abort();
    }, STREAM_TIMEOUT_MS);

    const stream = await this.client.chat.completions.create(request, {
      signal: abortController.signal,
    });
    const streamStartTime = Date.now();

    // Accumulate for final logging
    let fullContent = '';
    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> =
      new Map();

    for await (const chunk of stream) {
      // Check total elapsed time — abort if stuck in reasoning loop
      const elapsed = Date.now() - streamStartTime;
      if (elapsed > STREAM_TIMEOUT_MS) {
        console.error(`[LLMClient] Stream timeout after ${Math.round(elapsed / 1000)}s — aborting`);
        try {
          // Try multiple abort methods
          if ('controller' in stream && (stream as any).controller?.abort) {
            (stream as any).controller.abort();
          }
          if ('abort' in stream && typeof (stream as any).abort === 'function') {
            (stream as any).abort();
          }
        } catch { /* abort failed — throw anyway */ }
        throw new Error(`LLM call exceeded ${STREAM_TIMEOUT_MS / 1000}s total time limit (elapsed: ${Math.round(elapsed / 1000)}s)`);
      }
      const delta = chunk.choices[0]?.delta;
      // Cast to access llama.cpp extension fields not in OpenAI types
      const deltaExt = delta as typeof delta & { reasoning_content?: string };

      // Separate reasoning_content (llama.cpp extension) from regular content.
      // Without this, reasoning tokens leak into delta.content for models like Nemotron.
      if (deltaExt?.reasoning_content) {
        // Emit as thinking content, not regular content
        yield { thinking: deltaExt.reasoning_content, done: false };
        continue; // Don't process as regular content
      }

      if (delta?.content) {
        fullContent += delta.content;
        logger.logStreamChunk(delta.content);
        yield { content: delta.content, done: false };
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
      }
    }

    // Stream completed normally — cancel the hard timeout
    clearTimeout(abortTimer);
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
    let cleaned = content
      .replace(/<think>.*?<\/think>/gs, '') // Complete think blocks
      .replace(/<think>.*$/gs, '') // Orphan opening tag (no closing)
      .replace(/<\/think>/g, ''); // Orphan closing tag (no opening)
    return cleaned.trim();
  }
}

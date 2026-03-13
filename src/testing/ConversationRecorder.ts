/**
 * ConversationRecorder — wraps an LLM client, captures every generate call.
 *
 * Used in Layer 4 (Golden Flow Runs) to record real LLM conversations
 * that can later be replayed deterministically by ReplayLLMClient.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Message,
  LLMResponse,
  GenerateOptions,
  StreamChunk,
  ToolDefinition,
} from '../core/llm/types.js';
import type { GenericProjectFile } from '../core/templates/types.js';

/**
 * A single recorded turn of LLM conversation.
 */
export interface RecordedTurn {
  turnIndex: number;
  request: {
    messages: Message[];
    tools: ToolDefinition[];
    temperature: number;
  };
  response: LLMResponse;
  timestamp: string;
}

/**
 * Full conversation recording with metadata.
 */
export interface ConversationRecording {
  version: string;
  recordedAt: string;
  model: string;
  scenario: string;
  turns: RecordedTurn[];
  finalResult?: Record<string, unknown>;
  projectStateAfter?: GenericProjectFile;
}

/**
 * Interface that both real LLMClient and MockLLMClient satisfy.
 * Used to wrap any LLM client for recording.
 */
export interface RecordableLLMClient {
  generate(options: GenerateOptions): Promise<LLMResponse>;
  generateStream?(
    options: Omit<GenerateOptions, 'stream'>
  ): AsyncGenerator<StreamChunk, void, unknown>;
  getContextLength(): Promise<number>;
}

/**
 * Wraps an LLM client, recording every generate() call and response.
 */
export class ConversationRecorder implements RecordableLLMClient {
  private inner: RecordableLLMClient;
  private turns: RecordedTurn[] = [];
  private model: string;
  private scenario: string;

  constructor(
    inner: RecordableLLMClient,
    options: { model?: string; scenario?: string } = {}
  ) {
    this.inner = inner;
    this.model = options.model ?? 'unknown';
    this.scenario = options.scenario ?? 'unknown';
  }

  /**
   * Proxy generate() — records request + response.
   */
  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const response = await this.inner.generate(options);

    this.turns.push({
      turnIndex: this.turns.length,
      request: {
        messages: structuredClone(options.messages),
        tools: stripHandlers(options.tools ?? []),
        temperature: options.temperature ?? 1,
      },
      response: structuredClone(response),
      timestamp: new Date().toISOString(),
    });

    return response;
  }

  /**
   * Proxy generateStream() — buffers the full response then records it.
   * Falls back to generate() if the inner client doesn't support streaming.
   */
  async *generateStream(
    options: Omit<GenerateOptions, 'stream'>
  ): AsyncGenerator<StreamChunk, void, unknown> {
    if (!this.inner.generateStream) {
      const response = await this.generate(options);
      if (response.content) {
        yield { content: response.content, done: false };
      }
      yield { done: true };
      return;
    }

    // Accumulate chunks for recording while yielding them through
    let content = '';
    const toolCalls: LLMResponse['toolCalls'] = [];
    let usage: LLMResponse['usage'];

    for await (const chunk of this.inner.generateStream(options)) {
      if (chunk.content) content += chunk.content;
      if (chunk.toolCallDelta?.id) {
        toolCalls.push({
          id: chunk.toolCallDelta.id,
          name: chunk.toolCallDelta.name ?? '',
          arguments: chunk.toolCallDelta.arguments
            ? JSON.parse(chunk.toolCallDelta.arguments)
            : {},
        });
      }
      if (chunk.usage) usage = chunk.usage;
      yield chunk;
    }

    // Record the assembled response
    this.turns.push({
      turnIndex: this.turns.length,
      request: {
        messages: structuredClone(options.messages),
        tools: stripHandlers(options.tools ?? []),
        temperature: options.temperature ?? 1,
      },
      response: {
        content: content || null,
        toolCalls,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        usage,
      },
      timestamp: new Date().toISOString(),
    });
  }

  async getContextLength(): Promise<number> {
    return this.inner.getContextLength();
  }

  /**
   * Get all recorded turns so far.
   */
  getTurns(): RecordedTurn[] {
    return this.turns;
  }

  /**
   * Get number of recorded turns.
   */
  getTurnCount(): number {
    return this.turns.length;
  }

  /**
   * Build the full recording object.
   */
  toRecording(
    options: {
      finalResult?: Record<string, unknown>;
      projectStateAfter?: GenericProjectFile;
    } = {}
  ): ConversationRecording {
    return {
      version: '1.0',
      recordedAt: new Date().toISOString(),
      model: this.model,
      scenario: this.scenario,
      turns: structuredClone(this.turns),
      finalResult: options.finalResult,
      projectStateAfter: options.projectStateAfter,
    };
  }

  /**
   * Save recording to a JSON file.
   */
  save(
    filePath: string,
    options: {
      finalResult?: Record<string, unknown>;
      projectStateAfter?: GenericProjectFile;
    } = {}
  ): void {
    mkdirSync(dirname(filePath), { recursive: true });
    const recording = this.toRecording(options);
    writeFileSync(filePath, JSON.stringify(recording, null, 2));
  }

  /**
   * Reset the recorder for a new session.
   */
  reset(): void {
    this.turns = [];
  }
}

/**
 * Strip handler functions from tool definitions (not serializable).
 */
function stripHandlers(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map(({ handler: _handler, ...rest }) => rest);
}

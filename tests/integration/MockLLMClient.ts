/**
 * Mock LLM Client for integration testing.
 * Allows defining expected responses for specific message patterns.
 */
import type {
  Message,
  ToolDefinition,
  LLMResponse,
  StreamChunk,
  GenerateOptions,
} from '../../src/core/llm/types.js';

export interface MockResponse {
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface MockExpectation {
  /** Matcher for messages - can match on system prompt content, user message, etc. */
  match: (messages: Message[]) => boolean;
  /** Response to return when matched */
  response: MockResponse;
  /** Optional: Capture the messages for assertions */
  capture?: (messages: Message[]) => void;
}

/**
 * Mock LLM Client that returns predefined responses based on message patterns.
 */
export class MockLLMClient {
  private expectations: MockExpectation[] = [];
  private defaultResponse: MockResponse = { content: 'Default mock response' };
  private callHistory: Message[][] = [];

  /**
   * Add an expectation for a specific message pattern.
   */
  expect(expectation: MockExpectation): this {
    this.expectations.push(expectation);
    return this;
  }

  /**
   * Set the default response when no expectation matches.
   */
  setDefaultResponse(response: MockResponse): this {
    this.defaultResponse = response;
    return this;
  }

  /**
   * Get the call history for assertions.
   */
  getCallHistory(): Message[][] {
    return this.callHistory;
  }

  /**
   * Clear all expectations and history.
   */
  reset(): void {
    this.expectations = [];
    this.callHistory = [];
    this.defaultResponse = { content: 'Default mock response' };
  }

  /**
   * Get the model's context length.
   * Returns a default value for testing.
   */
  async getContextLength(): Promise<number> {
    return 16000; // Default context length for testing
  }

  /**
   * Generate a response (non-streaming).
   */
  async generate(options: GenerateOptions): Promise<LLMResponse> {
    const { messages } = options;
    this.callHistory.push([...messages]);

    // Find matching expectation
    for (const exp of this.expectations) {
      if (exp.match(messages)) {
        if (exp.capture) {
          exp.capture(messages);
        }
        return this.buildResponse(exp.response);
      }
    }

    // Return default response
    return this.buildResponse(this.defaultResponse);
  }

  /**
   * Generate a streaming response.
   */
  async *generateStream(
    options: Omit<GenerateOptions, 'stream'>
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const response = await this.generate(options);

    // Stream content character by character (simplified)
    if (response.content) {
      for (const char of response.content) {
        yield { content: char, done: false };
      }
    }

    // Stream tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (let i = 0; i < response.toolCalls.length; i++) {
        const tc = response.toolCalls[i]!;
        yield {
          toolCallDelta: {
            index: i,
            id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
          done: false,
        };
      }
    }

    yield { done: true };
  }

  private buildResponse(mockResponse: MockResponse): LLMResponse {
    return {
      content: mockResponse.content ?? null,
      toolCalls: mockResponse.toolCalls ?? [],
      finishReason: mockResponse.toolCalls?.length ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    };
  }
}

// Helper matchers for common patterns

/**
 * Match if any message contains the given text.
 */
export function containsText(text: string): (messages: Message[]) => boolean {
  return (messages) => messages.some(m => m.content?.includes(text) ?? false);
}

/**
 * Match if the system message contains the given text.
 */
export function systemContains(text: string): (messages: Message[]) => boolean {
  return (messages) => {
    const systemMsg = messages.find(m => m.role === 'system');
    return systemMsg?.content?.includes(text) ?? false;
  };
}

/**
 * Match if the last user message contains the given text.
 */
export function lastUserContains(text: string): (messages: Message[]) => boolean {
  return (messages) => {
    const userMsgs = messages.filter(m => m.role === 'user');
    const lastUser = userMsgs[userMsgs.length - 1];
    return lastUser?.content?.includes(text) ?? false;
  };
}

/**
 * Match the Nth call to the LLM.
 */
export function nthCall(n: number): (messages: Message[]) => boolean {
  let callCount = 0;
  return () => {
    callCount++;
    return callCount === n;
  };
}

/**
 * Always match (useful for default responses).
 */
export function always(): (messages: Message[]) => boolean {
  return () => true;
}

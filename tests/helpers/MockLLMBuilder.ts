/**
 * Mock LLM Builder
 *
 * Fluent builder for creating mock LLM responses.
 * Simplifies test setup by providing a chainable API.
 */

import type { Message, ToolCall, LLMResponse, GenerateOptions } from '../../src/core/llm/types.js';
import { MockLLMClient } from '../integration/MockLLMClient.js';
import { FixtureLoader } from './FixtureLoader.js';

export interface MockToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface MockResponseConfig {
  content?: string;
  toolCalls?: MockToolCall[];
}

export class MockLLMBuilder {
  private mockLLM: MockLLMClient;
  private responseQueue: LLMResponse[] = [];
  private callIndex = 0;

  constructor() {
    this.mockLLM = new MockLLMClient();
  }

  /**
   * Add a text response.
   */
  withText(content: string): this {
    this.responseQueue.push({
      content,
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    return this;
  }

  /**
   * Add a tool call response.
   */
  withToolCall(name: string, args: Record<string, unknown>): this {
    const toolCall: ToolCall = {
      id: `call_${this.callIndex++}`,
      name,
      arguments: args,
    };

    this.responseQueue.push({
      content: null,
      toolCalls: [toolCall],
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    return this;
  }

  /**
   * Add multiple tool calls in one response.
   */
  withToolCalls(calls: Array<{ name: string; arguments: Record<string, unknown> }>): this {
    const toolCalls: ToolCall[] = calls.map((call, i) => ({
      id: `call_${this.callIndex++}_${i}`,
      name: call.name,
      arguments: call.arguments,
    }));

    this.responseQueue.push({
      content: null,
      toolCalls,
      finishReason: 'tool_calls',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    return this;
  }

  /**
   * Add a dispatch_agent tool call.
   * Commonly used in tests.
   */
  withDispatchAgent(task: string, contextRefs: string[] = []): this {
    return this.withToolCall('dispatch_agent', {
      task,
      context_refs: contextRefs,
    });
  }

  /**
   * Add a dispatch_content_agent tool call.
   */
  withDispatchContentAgent(
    contentType: string,
    task: string,
    contextRefs: string[] = []
  ): this {
    return this.withToolCall('dispatch_content_agent', {
      content_type: contentType,
      task,
      context_refs: contextRefs,
    });
  }

  /**
   * Add a generate_content tool call.
   */
  withGenerateContent(contentType: string, content: string): this {
    return this.withToolCall('generate_content', {
      content_type: contentType,
      content,
    });
  }

  /**
   * Add an AskUserQuestion tool call.
   */
  withAskUserQuestion(question: string, options: Array<{ label: string; description: string }>): this {
    return this.withToolCall('AskUserQuestion', {
      question,
      options,
    });
  }

  /**
   * Add a TodoWrite tool call.
   */
  withTodoWrite(todos: Array<{ subject: string; description?: string }>): this {
    return this.withToolCall('TodoWrite', {
      todos,
    });
  }

  /**
   * Add a planning agent response (typically creates a plan).
   */
  withPlanningAgentResponse(planContent: string): this {
    return this
      .withText('I will create a plan for this task.')
      .withToolCall('generate_content', {
        content_type: 'plan',
        content: planContent,
      });
  }

  /**
   * Add a content agent response (typically creates content).
   */
  withContentAgentResponse(content: string): this {
    return this
      .withText('I will generate the content.')
      .withToolCall('generate_content', {
        content_type: 'story',
        content,
      });
  }

  /**
   * Add user approval response (for auto-approve scenarios).
   */
  withUserApproval(approval: 'APPROVE' | 'REJECT' | 'REVISE'): this {
    return this.withText(approval);
  }

  /**
   * Add a custom response config.
   */
  withResponse(config: MockResponseConfig): this {
    const toolCalls: ToolCall[] = (config.toolCalls || []).map((tc, i) => ({
      id: `call_${this.callIndex++}_${i}`,
      name: tc.name,
      arguments: tc.arguments,
    }));

    this.responseQueue.push({
      content: config.content || null,
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    });
    return this;
  }

  /**
   * Set responses from a fixture file.
   * @param fixturePath - Path to JSON fixture file
   */
  withFixture(fixturePath: string): this {
    const responses = FixtureLoader.loadJSON<Array<MockResponseConfig>>(fixturePath);

    for (const response of responses) {
      this.withResponse(response);
    }
    return this;
  }

  /**
   * Build the MockLLMClient.
   * @returns Configured MockLLMClient
   */
  build(): MockLLMClient {
    // Set up the mock LLM to return queued responses in order
    let responseIndex = 0;

    this.mockLLM.expect({
      match: () => true, // Always match
      response: this.responseQueue[0] || { content: 'Default response' },
      capture: (messages) => {
        // Return the next response in the queue
        const response = this.responseQueue[responseIndex] || {
          content: 'Default response',
        };
        responseIndex++;

        // Update the expectation to return this response
        // This is a bit of a hack, but works for our purposes
        (this.mockLLM as any).expectations[0].response = response;
      },
    });

    return this.mockLLM;
  }

  /**
   * Get the underlying MockLLMClient for advanced configuration.
   */
  getMockLLM(): MockLLMClient {
    return this.mockLLM;
  }

  /**
   * Reset the builder for reuse.
   */
  reset(): this {
    this.responseQueue = [];
    this.callIndex = 0;
    return this;
  }

  /**
   * Create a new builder instance.
   */
  static create(): MockLLMBuilder {
    return new MockLLMBuilder();
  }
}

/**
 * Convenience function to create a MockLLMBuilder.
 */
export function createMockLLMBuilder(): MockLLMBuilder {
  return MockLLMBuilder.create();
}

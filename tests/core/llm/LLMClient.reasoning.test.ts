import { describe, expect, it } from 'vitest';
import { LLMClient, type LLMResponse, type Message } from '../../../src/core/llm/index.js';

describe('LLMClient reasoning payload handling', () => {
  it('preserves reasoning fields from provider responses', () => {
    const client = new LLMClient({
      baseUrl: 'http://localhost/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });

    const response = (client as unknown as {
      parseResponse: (response: unknown) => LLMResponse;
    }).parseResponse({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            reasoning: 'private reasoning text',
            reasoning_details: [{ type: 'reasoning.text', text: 'private reasoning text' }],
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'read_file', arguments: '{"file_path":"original_input.md"}' },
              },
            ],
          },
        },
      ],
    });

    expect(response.reasoning).toBe('private reasoning text');
    expect(response.reasoningDetails).toEqual([
      { type: 'reasoning.text', text: 'private reasoning text' },
    ]);
    expect(response.toolCalls).toEqual([
      {
        id: 'call_1',
        name: 'read_file',
        arguments: { file_path: 'original_input.md' },
      },
    ]);
  });

  it('replays preserved reasoning on assistant messages', () => {
    const client = new LLMClient({
      baseUrl: 'http://localhost/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    const convertMessages = (client as unknown as {
      convertMessages: (messages: Message[]) => Array<Record<string, unknown>>;
    }).convertMessages.bind(client);

    const [assistantWithDetails] = convertMessages([
      {
        role: 'assistant',
        content: null,
        reasoning: 'private reasoning text',
        reasoningDetails: [{ type: 'reasoning.text', text: 'private reasoning text' }],
        toolCalls: [{ id: 'call_1', name: 'read_file', arguments: { file_path: 'a.md' } }],
      },
    ]);

    expect(assistantWithDetails?.['reasoning_details']).toEqual([
      { type: 'reasoning.text', text: 'private reasoning text' },
    ]);
    expect(assistantWithDetails?.['reasoning_content']).toBeUndefined();

    const [assistantWithText] = convertMessages([
      {
        role: 'assistant',
        content: 'Done',
        reasoning: 'private reasoning text',
      },
    ]);

    expect(assistantWithText?.['reasoning_content']).toBe('private reasoning text');
  });
});

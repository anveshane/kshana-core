/**
 * Layer 0: Recorded Replay Tests
 *
 * Tests the ConversationRecorder and ReplayLLMClient infrastructure.
 * These tests run without any LLM — they verify that:
 * 1. Conversations can be recorded and saved
 * 2. Recordings can be replayed deterministically
 * 3. Drift detection catches message changes
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConversationRecorder,
  type RecordableLLMClient,
  type ConversationRecording,
} from '../../src/testing/ConversationRecorder.js';
import {
  ReplayLLMClient,
  DriftError,
} from '../../src/testing/ReplayLLMClient.js';
import type { LLMResponse, GenerateOptions, Message } from '../../src/core/llm/types.js';

// --- Test helpers ---

function createMockInner(responses: LLMResponse[]): RecordableLLMClient {
  let callIndex = 0;
  return {
    async generate(_options: GenerateOptions): Promise<LLMResponse> {
      const response = responses[callIndex] ?? {
        content: 'default response',
        toolCalls: [],
        finishReason: 'stop',
      };
      callIndex++;
      return response;
    },
    async getContextLength() {
      return 16000;
    },
  };
}

function makeMessages(...contents: Array<{ role: Message['role']; content: string }>): Message[] {
  return contents.map(({ role, content }) => ({ role, content }));
}

const RESPONSE_A: LLMResponse = {
  content: 'I will create a plan for you.',
  toolCalls: [
    { id: 'tc_1', name: 'TodoWrite', arguments: { todos: [{ content: 'Step 1' }] } },
  ],
  finishReason: 'tool_calls',
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
};

const RESPONSE_B: LLMResponse = {
  content: 'Here is the generated story.',
  toolCalls: [
    { id: 'tc_2', name: 'generate_content', arguments: { type: 'story', content: '...' } },
  ],
  finishReason: 'tool_calls',
  usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
};

// --- ConversationRecorder tests ---

describe('ConversationRecorder', () => {
  let recorder: ConversationRecorder;
  let innerClient: RecordableLLMClient;

  beforeEach(() => {
    innerClient = createMockInner([RESPONSE_A, RESPONSE_B]);
    recorder = new ConversationRecorder(innerClient, {
      model: 'test-model',
      scenario: 'test-scenario',
    });
  });

  it('records generate calls', async () => {
    const messages = makeMessages(
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Create a plan.' }
    );

    const response = await recorder.generate({ messages });

    expect(response).toEqual(RESPONSE_A);
    expect(recorder.getTurnCount()).toBe(1);

    const turns = recorder.getTurns();
    expect(turns[0]!.turnIndex).toBe(0);
    expect(turns[0]!.request.messages).toEqual(messages);
    expect(turns[0]!.response).toEqual(RESPONSE_A);
  });

  it('records multiple turns in sequence', async () => {
    await recorder.generate({
      messages: makeMessages({ role: 'user', content: 'First' }),
    });
    await recorder.generate({
      messages: makeMessages({ role: 'user', content: 'Second' }),
    });

    expect(recorder.getTurnCount()).toBe(2);
    expect(recorder.getTurns()[0]!.turnIndex).toBe(0);
    expect(recorder.getTurns()[1]!.turnIndex).toBe(1);
  });

  it('produces a valid recording object', async () => {
    await recorder.generate({
      messages: makeMessages({ role: 'user', content: 'Hello' }),
    });

    const recording = recorder.toRecording({ finalResult: { status: 'complete' } });

    expect(recording.version).toBe('1.0');
    expect(recording.model).toBe('test-model');
    expect(recording.scenario).toBe('test-scenario');
    expect(recording.turns).toHaveLength(1);
    expect(recording.finalResult).toEqual({ status: 'complete' });
    expect(recording.recordedAt).toBeTruthy();
  });

  it('deep clones messages to avoid mutation', async () => {
    const messages = makeMessages({ role: 'user', content: 'original' });
    await recorder.generate({ messages });

    // Mutate after recording
    messages[0]!.content = 'mutated';

    expect(recorder.getTurns()[0]!.request.messages[0]!.content).toBe('original');
  });

  it('strips tool handlers from recorded tools', async () => {
    await recorder.generate({
      messages: makeMessages({ role: 'user', content: 'test' }),
      tools: [
        {
          name: 'TestTool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {} },
          handler: () => 'result',
        },
      ],
    });

    const turn = recorder.getTurns()[0]!;
    expect(turn.request.tools[0]).not.toHaveProperty('handler');
    expect(turn.request.tools[0]!.name).toBe('TestTool');
  });

  it('resets state cleanly', async () => {
    await recorder.generate({
      messages: makeMessages({ role: 'user', content: 'test' }),
    });
    expect(recorder.getTurnCount()).toBe(1);

    recorder.reset();
    expect(recorder.getTurnCount()).toBe(0);
    expect(recorder.getTurns()).toEqual([]);
  });
});

// --- ReplayLLMClient tests ---

describe('ReplayLLMClient', () => {
  let recording: ConversationRecording;

  beforeEach(() => {
    recording = {
      version: '1.0',
      recordedAt: '2024-01-01T00:00:00Z',
      model: 'test-model',
      scenario: 'test-scenario',
      turns: [
        {
          turnIndex: 0,
          request: {
            messages: makeMessages(
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: 'Create a plan.' }
            ),
            tools: [],
            temperature: 0,
          },
          response: RESPONSE_A,
          timestamp: '2024-01-01T00:00:01Z',
        },
        {
          turnIndex: 1,
          request: {
            messages: makeMessages(
              { role: 'system', content: 'You are a helpful assistant.' },
              { role: 'user', content: 'Create a plan.' },
              { role: 'assistant', content: RESPONSE_A.content ?? '' },
              { role: 'tool', content: '{"success": true}' },
              { role: 'user', content: 'Now write the story.' }
            ),
            tools: [],
            temperature: 0,
          },
          response: RESPONSE_B,
          timestamp: '2024-01-01T00:00:02Z',
        },
      ],
    };
  });

  it('replays recorded responses in order', async () => {
    const client = new ReplayLLMClient(recording, { tolerance: 'lenient' });

    const r1 = await client.generate({
      messages: recording.turns[0]!.request.messages,
    });
    expect(r1).toEqual(RESPONSE_A);

    const r2 = await client.generate({
      messages: recording.turns[1]!.request.messages,
    });
    expect(r2).toEqual(RESPONSE_B);
  });

  it('throws when replay is exhausted', async () => {
    const client = new ReplayLLMClient(recording, { tolerance: 'lenient' });

    await client.generate({ messages: recording.turns[0]!.request.messages });
    await client.generate({ messages: recording.turns[1]!.request.messages });

    await expect(
      client.generate({ messages: makeMessages({ role: 'user', content: 'extra' }) })
    ).rejects.toThrow('Replay exhausted');
  });

  it('tracks turn count and completion', async () => {
    const client = new ReplayLLMClient(recording, { tolerance: 'lenient' });

    expect(client.getTurnCount()).toBe(0);
    expect(client.getTotalTurns()).toBe(2);
    expect(client.isComplete()).toBe(false);

    await client.generate({ messages: recording.turns[0]!.request.messages });
    expect(client.getTurnCount()).toBe(1);

    await client.generate({ messages: recording.turns[1]!.request.messages });
    expect(client.getTurnCount()).toBe(2);
    expect(client.isComplete()).toBe(true);
  });

  describe('drift detection', () => {
    it('strict mode detects content changes', async () => {
      const client = new ReplayLLMClient(recording, { tolerance: 'strict' });

      // Same structure but different system message content
      const modified = makeMessages(
        { role: 'system', content: 'You are a VERY helpful assistant.' },
        { role: 'user', content: 'Create a plan.' }
      );

      await expect(client.generate({ messages: modified })).rejects.toThrow(DriftError);
    });

    it('structural mode allows whitespace changes in system messages', async () => {
      const client = new ReplayLLMClient(recording, { tolerance: 'structural' });

      // Same content, minor whitespace differences
      const modified = makeMessages(
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Create a plan.' }
      );

      const response = await client.generate({ messages: modified });
      expect(response).toEqual(RESPONSE_A);
    });

    it('structural mode detects role changes', async () => {
      const client = new ReplayLLMClient(recording, {
        tolerance: 'structural',
        maxDriftScore: 0.1,
      });

      // Completely wrong role
      const modified: Message[] = [
        { role: 'user', content: 'You are a helpful assistant.' },
        { role: 'system', content: 'Create a plan.' },
      ];

      await expect(client.generate({ messages: modified })).rejects.toThrow(DriftError);
    });

    it('lenient mode only cares about tool call sequence', async () => {
      const client = new ReplayLLMClient(recording, { tolerance: 'lenient' });

      // Different content but same structure
      const modified = makeMessages(
        { role: 'system', content: 'Completely different system message.' },
        { role: 'user', content: 'Totally different user message.' }
      );

      const response = await client.generate({ messages: modified });
      expect(response).toEqual(RESPONSE_A);
    });

    it('reportOnly mode collects reports without failing', async () => {
      const client = new ReplayLLMClient(recording, {
        tolerance: 'strict',
        reportOnly: true,
      });

      const modified = makeMessages(
        { role: 'system', content: 'COMPLETELY different message.' },
        { role: 'user', content: 'Also different.' }
      );

      // Should not throw
      const response = await client.generate({ messages: modified });
      expect(response).toEqual(RESPONSE_A);

      const reports = client.getDriftReports();
      expect(reports).toHaveLength(1);
      expect(reports[0]!.score).toBeGreaterThan(0);
    });
  });

  describe('streaming replay', () => {
    it('yields recorded content and tool calls as chunks', async () => {
      const client = new ReplayLLMClient(recording, { tolerance: 'lenient' });

      const chunks: Array<{ content?: string; toolCallDelta?: unknown; done: boolean }> = [];
      for await (const chunk of client.generateStream({
        messages: recording.turns[0]!.request.messages,
      })) {
        chunks.push(chunk);
      }

      // Content chunk + tool call chunk + done chunk
      expect(chunks.length).toBe(3);
      expect(chunks[0]!.content).toBe(RESPONSE_A.content);
      expect(chunks[chunks.length - 1]!.done).toBe(true);
    });
  });
});

// --- Round-trip test: Record then Replay ---

describe('Record → Replay round-trip', () => {
  it('recording can be replayed with zero drift', async () => {
    // Step 1: Record
    const inner = createMockInner([RESPONSE_A, RESPONSE_B]);
    const recorder = new ConversationRecorder(inner, { model: 'test', scenario: 'roundtrip' });

    const msg1 = makeMessages({ role: 'user', content: 'First message' });
    const msg2 = makeMessages(
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: RESPONSE_A.content ?? '' },
      { role: 'user', content: 'Second message' }
    );

    await recorder.generate({ messages: msg1, temperature: 0 });
    await recorder.generate({ messages: msg2, temperature: 0 });

    const recording = recorder.toRecording();

    // Step 2: Replay with identical messages
    const replayer = new ReplayLLMClient(recording, { tolerance: 'strict' });

    const r1 = await replayer.generate({ messages: msg1 });
    const r2 = await replayer.generate({ messages: msg2 });

    expect(r1).toEqual(RESPONSE_A);
    expect(r2).toEqual(RESPONSE_B);
    expect(replayer.getMaxDrift()).toBe(0);
    expect(replayer.isComplete()).toBe(true);
  });
});

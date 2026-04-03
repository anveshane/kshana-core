import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/posthog.js', () => ({
  captureSessionEnded: vi.fn(),
  captureSessionStarted: vi.fn(),
  captureWorkflowCompleted: vi.fn(),
  captureWorkflowFailed: vi.fn(),
  captureWorkflowStarted: vi.fn(),
}));

import { ConversationManager } from '../../src/server/ConversationManager.js';
import { WebSocketHandler } from '../../src/server/WebSocketHandler.js';

class FakeSocket {
  readyState = 1;
  sent: string[] = [];

  send(payload: string): void {
    this.sent.push(payload);
  }
}

describe('WebSocketHandler tool event forwarding', () => {
  it('sends tool_call messages with the real toolCallId and error status', () => {
    const manager = new ConversationManager({
      llmConfig: {},
    });
    const handler = new WebSocketHandler(manager);
    const socket = new FakeSocket();

    const events = (
      handler as unknown as {
        createEventHandlers: (
          sessionId: string,
          socket: FakeSocket,
        ) => {
          onToolCall: (
            sid: string,
            toolCallId: string,
            toolName: string,
            args: Record<string, unknown>,
            agentName?: string,
          ) => void;
          onToolResult: (
            sid: string,
            toolCallId: string,
            toolName: string,
            result: unknown,
            isError?: boolean,
            agentName?: string,
          ) => void;
        };
      }
    ).createEventHandlers('session-1', socket);

    events.onToolCall(
      'session-1',
      'tool-1',
      'generate_content',
      { content_type: 'plot' },
      'Orchestrator',
    );
    events.onToolResult(
      'session-1',
      'tool-1',
      'generate_content',
      'failure',
      true,
      'Orchestrator',
    );

    expect(socket.sent).toHaveLength(2);
    expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
      type: 'tool_call',
      sessionId: 'session-1',
      data: {
        toolCallId: 'tool-1',
        toolName: 'generate_content',
        status: 'started',
      },
    });
    expect(JSON.parse(socket.sent[1] ?? '{}')).toMatchObject({
      type: 'tool_call',
      sessionId: 'session-1',
      data: {
        toolCallId: 'tool-1',
        toolName: 'generate_content',
        status: 'error',
        error: 'failure',
      },
    });

    (manager as unknown as { shutdown: () => void }).shutdown();
  });
});

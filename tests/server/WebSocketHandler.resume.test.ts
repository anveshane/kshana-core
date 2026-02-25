import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationEvents } from '../../src/server/ConversationManager.js';
import { WebSocketHandler } from '../../src/server/WebSocketHandler.js';
import { getProjectFileOps } from '../../src/server/ProjectFileOps.js';

type AgentResultStatus =
  | 'completed'
  | 'waiting_for_user'
  | 'error'
  | 'interrupted';

interface MockAgentResult {
  output: string;
  status: AgentResultStatus;
}

interface MockSessionState {
  id: string;
  projectDir?: string;
}

class MockConversationManager {
  readonly sessions = new Map<string, MockSessionState>();
  runTaskImpl: (
    sessionId: string,
    _task: string,
    events?: ConversationEvents,
  ) => Promise<MockAgentResult> = async (_sessionId, _task, _events) => {
    return { output: 'ok', status: 'completed' };
  };

  async createSession(
    basePath?: string,
    preGeneratedSessionId?: string,
  ): Promise<{ id: string }> {
    const id = preGeneratedSessionId ?? `session-${Date.now()}`;
    this.sessions.set(id, { id, projectDir: basePath });
    return { id };
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSessionProjectDir(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.projectDir;
  }

  async runTask(
    sessionId: string,
    task: string,
    events?: ConversationEvents,
  ): Promise<MockAgentResult> {
    return this.runTaskImpl(sessionId, task, events);
  }

  async sendResponse(
    sessionId: string,
    response: string,
    events?: ConversationEvents,
  ): Promise<MockAgentResult> {
    return this.runTaskImpl(sessionId, response, events);
  }

  async cancelTask(
    _sessionId: string,
    _reason?: 'user_stop' | 'project_switch',
  ): Promise<boolean> {
    return true;
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }
}

class FakeSocket {
  readyState = 1;
  sent: string[] = [];
  private listeners = new Map<string, Array<(...args: any[]) => void>>();

  on(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.emit('close');
  }

  terminate(): void {
    this.close();
  }

  ping(): void {
    // no-op for tests
  }

  emitMessage(message: unknown): void {
    const serialized =
      typeof message === 'string' ? message : JSON.stringify(message);
    this.emit('message', Buffer.from(serialized));
  }

  emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers) {
      handler(...args);
    }
  }
}

function parseSocketMessages(socket: FakeSocket): Array<Record<string, any>> {
  return socket.sent.map((payload) => JSON.parse(payload));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number = 2000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out while waiting for condition');
    }
    await sleep(5);
  }
}

async function connectChatSession(
  handler: WebSocketHandler,
  socket: FakeSocket,
  query: { project_dir?: string; session_id?: string } = {},
): Promise<string> {
  const connectPromise = handler.handleConnection(socket as any, {
    query: { channel: 'chat', ...query },
  });

  await waitFor(() => parseSocketMessages(socket).length > 0);
  const firstMessage = parseSocketMessages(socket)[0];
  if (!firstMessage) {
    throw new Error('Expected at least one server message during connection');
  }

  if (firstMessage.type === 'file_sync_request') {
    socket.emitMessage({
      type: 'file_sync_init',
      data: { files: [] },
    });
  }

  await connectPromise;

  const allMessages = parseSocketMessages(socket);
  const latestWithSession = [...allMessages]
    .reverse()
    .find((message) => typeof message.sessionId === 'string');
  if (!latestWithSession?.sessionId) {
    throw new Error('Expected sessionId in server messages');
  }
  return latestWithSession.sessionId as string;
}

describe('WebSocketHandler session resume', () => {
  let manager: MockConversationManager;
  let handler: WebSocketHandler;
  let reconnectGraceOriginal: number;

  beforeEach(() => {
    manager = new MockConversationManager();
    handler = new WebSocketHandler(manager as any);
    reconnectGraceOriginal = (WebSocketHandler as any).RECONNECT_GRACE_MS;
    getProjectFileOps().setLocalMode();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (WebSocketHandler as any).RECONNECT_GRACE_MS = reconnectGraceOriginal;
    handler.shutdown();
    getProjectFileOps().setLocalMode();
    vi.restoreAllMocks();
  });

  it('resumes existing session when reconnecting with same session_id and project_dir', async () => {
    const socket1 = new FakeSocket();
    const sessionId = await connectChatSession(handler, socket1, {
      project_dir: '/tmp/project-resume',
    });

    expect(manager.hasSession(sessionId)).toBe(true);
    socket1.close(1006, 'network_lost');

    const socket2 = new FakeSocket();
    const resumedSessionId = await connectChatSession(handler, socket2, {
      project_dir: '/tmp/project-resume',
      session_id: sessionId,
    });

    expect(resumedSessionId).toBe(sessionId);
    expect(manager.sessions.size).toBe(1);
    const statusMessage = parseSocketMessages(socket2).find(
      (message) =>
        message.type === 'status' &&
        message.data?.message === 'Session resumed successfully',
    );
    expect(statusMessage).toBeDefined();
  });

  it('flushes buffered server events in order when reconnecting within grace TTL', async () => {
    manager.runTaskImpl = async (sessionId, _task, events) => {
      await sleep(15);
      events?.onToolCall?.(sessionId, 'read_project', { path: 'project.json' });
      events?.onAgentText?.(sessionId, 'chunk-1', false);
      events?.onToolResult?.(sessionId, 'read_project', { ok: true });
      events?.onAgentText?.(sessionId, 'chunk-2', true);
      return { output: 'final-output', status: 'completed' };
    };

    const socket1 = new FakeSocket();
    const sessionId = await connectChatSession(handler, socket1, {
      project_dir: '/tmp/project-buffer',
    });

    socket1.emitMessage({
      type: 'start_task',
      data: { task: 'continue' },
    });
    await sleep(5);
    socket1.close(1006, 'network_lost');

    await sleep(60);

    const socket2 = new FakeSocket();
    await connectChatSession(handler, socket2, {
      project_dir: '/tmp/project-buffer',
      session_id: sessionId,
    });

    const messageTypes = parseSocketMessages(socket2)
      .map((message) => message.type)
      .filter((type) => type !== 'file_sync_request');

    expect(messageTypes).toEqual(
      expect.arrayContaining([
        'tool_call',
        'stream_chunk',
        'agent_response',
        'status',
      ]),
    );

    const firstBufferedToolCallIndex = messageTypes.indexOf('tool_call');
    const firstBufferedChunkIndex = messageTypes.indexOf('stream_chunk');
    const responseIndex = messageTypes.indexOf('agent_response');
    expect(firstBufferedToolCallIndex).toBeLessThan(firstBufferedChunkIndex);
    expect(firstBufferedChunkIndex).toBeLessThan(responseIndex);
  });

  it('creates a fresh session after reconnect grace TTL expires', async () => {
    (WebSocketHandler as any).RECONNECT_GRACE_MS = 25;

    const socket1 = new FakeSocket();
    const oldSessionId = await connectChatSession(handler, socket1, {
      project_dir: '/tmp/project-expiry',
    });

    socket1.close(1006, 'network_lost');
    await sleep(60);

    const socket2 = new FakeSocket();
    const newSessionId = await connectChatSession(handler, socket2, {
      project_dir: '/tmp/project-expiry',
      session_id: oldSessionId,
    });

    expect(newSessionId).not.toBe(oldSessionId);
    expect(manager.hasSession(oldSessionId)).toBe(false);
    expect(manager.hasSession(newSessionId)).toBe(true);
  });

  it('rejects a second active connection with the same session_id', async () => {
    const socket1 = new FakeSocket();
    const sessionId = await connectChatSession(handler, socket1, {
      project_dir: '/tmp/project-conflict',
    });

    const socket2 = new FakeSocket();
    await handler.handleConnection(socket2 as any, {
      query: {
        channel: 'chat',
        project_dir: '/tmp/project-conflict',
        session_id: sessionId,
      },
    });

    const errorMessage = parseSocketMessages(socket2).find(
      (message) => message.type === 'error',
    );
    expect(errorMessage?.data?.code).toBe('session_in_use');
    expect(socket2.readyState).toBe(3);
  });
});

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

class MockConversationManager {
  readonly sessions = new Map<string, { id: string; projectDir?: string }>();
  runTaskImpl: (
    sessionId: string,
    _task: string,
    events?: ConversationEvents,
  ) => Promise<MockAgentResult> = async (_sessionId, _task, _events) => {
    return { output: 'ok', status: 'completed' };
  };
  cancelTaskImpl: (
    sessionId: string,
    reason: 'user_stop' | 'project_switch',
  ) => Promise<boolean> = async (_sessionId, _reason) => true;

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
    sessionId: string,
    reason: 'user_stop' | 'project_switch',
  ): Promise<boolean> {
    return this.cancelTaskImpl(sessionId, reason);
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
    // no-op
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
  if (firstMessage?.type === 'file_sync_request') {
    socket.emitMessage({
      type: 'file_sync_init',
      data: { files: [] },
    });
  }

  await connectPromise;
  const latestWithSession = [...parseSocketMessages(socket)]
    .reverse()
    .find((message) => typeof message.sessionId === 'string');

  if (!latestWithSession?.sessionId) {
    throw new Error('Expected sessionId in server messages');
  }
  return latestWithSession.sessionId as string;
}

describe('WebSocketHandler cancel semantics', () => {
  let manager: MockConversationManager;
  let handler: WebSocketHandler;

  beforeEach(() => {
    manager = new MockConversationManager();
    handler = new WebSocketHandler(manager as any);
    getProjectFileOps().setLocalMode();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    handler.shutdown();
    getProjectFileOps().setLocalMode();
    vi.restoreAllMocks();
  });

  it('awaits cancel completion before sending cancellation acknowledgement', async () => {
    let resolveCancel: ((value: boolean) => void) | null = null;
    manager.cancelTaskImpl = async (_sessionId, _reason) => {
      return await new Promise<boolean>((resolve) => {
        resolveCancel = resolve;
      });
    };

    const socket = new FakeSocket();
    await connectChatSession(handler, socket, { project_dir: '/tmp/cancel-await' });

    socket.emitMessage({
      type: 'cancel',
      data: {},
    });

    await sleep(25);
    const beforeResolve = parseSocketMessages(socket).filter(
      (message) =>
        message.type === 'status' &&
        message.data?.message === 'Task cancelled',
    );
    expect(beforeResolve).toHaveLength(0);

    if (!resolveCancel) {
      throw new Error('Expected cancel promise resolver to be set');
    }
    resolveCancel(true);

    await waitFor(() =>
      parseSocketMessages(socket).some(
        (message) =>
          message.type === 'status' &&
          message.data?.status === 'ready' &&
          message.data?.message === 'Task cancelled',
      ),
    );
  });

  it('forwards project_switch reason to conversation manager and returns non-error status', async () => {
    const cancelSpy = vi.fn(async () => true);
    manager.cancelTaskImpl = cancelSpy;

    const socket = new FakeSocket();
    const sessionId = await connectChatSession(handler, socket, {
      project_dir: '/tmp/cancel-project-switch',
    });

    socket.emitMessage({
      type: 'cancel',
      data: { reason: 'project_switch' },
    });

    await waitFor(() =>
      parseSocketMessages(socket).some(
        (message) =>
          message.type === 'status' &&
          message.data?.message === 'Task cancelled',
      ),
    );

    expect(cancelSpy).toHaveBeenCalledWith(sessionId, 'project_switch');
    const errorMessages = parseSocketMessages(socket).filter(
      (message) => message.type === 'error',
    );
    expect(errorMessages).toHaveLength(0);
  });

  it('maps interrupted run results to cancelled status semantics', async () => {
    manager.runTaskImpl = async () => ({
      output: 'stopped',
      status: 'interrupted',
    });

    const socket = new FakeSocket();
    await connectChatSession(handler, socket, {
      project_dir: '/tmp/interrupted-mapping',
    });

    socket.emitMessage({
      type: 'start_task',
      data: { task: 'run' },
    });

    await waitFor(() =>
      parseSocketMessages(socket).some(
        (message) => message.type === 'agent_response',
      ),
    );

    const agentResponse = parseSocketMessages(socket).find(
      (message) => message.type === 'agent_response',
    );
    expect(agentResponse?.data?.status).toBe('cancelled');

    const terminalStatus = [...parseSocketMessages(socket)]
      .reverse()
      .find((message) => message.type === 'status');
    expect(terminalStatus?.data?.status).toBe('ready');
    expect(terminalStatus?.data?.message).toBe('Task cancelled');
  });
});

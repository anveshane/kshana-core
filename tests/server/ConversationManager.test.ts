import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/posthog.js', () => ({
  captureSessionEnded: vi.fn(),
  captureSessionStarted: vi.fn(),
  captureWorkflowCompleted: vi.fn(),
  captureWorkflowFailed: vi.fn(),
  captureWorkflowStarted: vi.fn(),
}));

import { ConversationManager } from '../../src/server/ConversationManager.js';

function createManager(): ConversationManager {
  return new ConversationManager({
    llmConfig: {},
    sessionTimeoutMs: 30 * 60 * 1000,
  });
}

function setAwaitingInput(manager: ConversationManager, sessionId: string): void {
  const sessions = (
    manager as unknown as {
      sessions: Map<string, { state: { status: string } }>;
    }
  ).sessions;
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Missing test session ${sessionId}`);
  }

  session.state.status = 'awaiting_input';
}

function disposeManager(manager: ConversationManager): void {
  const cleanupInterval = (
    manager as unknown as {
      cleanupInterval?: ReturnType<typeof setInterval>;
    }
  ).cleanupInterval;
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  (
    manager as unknown as {
      sessions: Map<string, unknown>;
    }
  ).sessions.clear();
}

describe('ConversationManager session activity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('expires awaiting_input sessions after two hours without new activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T10:00:00.000Z'));

    const manager = createManager();
    const session = manager.createSession();
    setAwaitingInput(manager, session.id);

    vi.advanceTimersByTime(2 * 60 * 60 * 1000 + 60 * 1000);

    expect(manager.hasSession(session.id)).toBe(false);

    disposeManager(manager);
  });

  it('keeps awaiting_input sessions alive when the server refreshes activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T10:00:00.000Z'));

    const manager = createManager();
    const session = manager.createSession();
    setAwaitingInput(manager, session.id);

    vi.advanceTimersByTime(90 * 60 * 1000);

    expect(manager.touchSession(session.id)).toBe(true);

    vi.advanceTimersByTime(91 * 60 * 1000);

    expect(manager.hasSession(session.id)).toBe(true);

    disposeManager(manager);
  });
});

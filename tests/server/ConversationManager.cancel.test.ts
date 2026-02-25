import { afterEach, describe, expect, it, vi } from 'vitest';
import * as videoTasks from '../../src/tasks/video/index.js';
import { ConversationManager } from '../../src/server/ConversationManager.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('ConversationManager cancelTask', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('awaits video runtime cancellation before resolving true', async () => {
    const manager = new ConversationManager({
      llmConfig: {} as any,
      taskType: 'video',
    });

    let resolveRuntimeCancel: (() => void) | null = null;
    const runtimeCancelSpy = vi
      .spyOn(videoTasks, 'cancelVideoRuntime')
      .mockImplementation(
        async () =>
          await new Promise<void>((resolve) => {
            resolveRuntimeCancel = resolve;
          }),
      );

    const stopSpy = vi.fn();
    const abortController = new AbortController();
    (manager as any).sessions.set('session-cancel', {
      state: {
        id: 'session-cancel',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        status: 'running',
        taskHistory: [],
      },
      agent: {
        stop: stopSpy,
      },
      abortController,
      basePath: '/tmp/project-video',
    });

    const cancelPromise = manager.cancelTask('session-cancel', 'project_switch');
    let settled = false;
    cancelPromise.then(() => {
      settled = true;
    });

    await sleep(15);
    expect(settled).toBe(false);
    expect(abortController.signal.aborted).toBe(true);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(runtimeCancelSpy).toHaveBeenCalledWith('project_switch');

    if (!resolveRuntimeCancel) {
      throw new Error('Expected cancel runtime resolver to be initialized');
    }
    resolveRuntimeCancel();

    await expect(cancelPromise).resolves.toBe(true);
    expect((manager as any).sessions.get('session-cancel').state.status).toBe(
      'idle',
    );

    manager.shutdown();
  });
});

/**
 * Tests for the pi-agent ↔ ExecutorAgent bridge layer (`runExecutor`).
 *
 * What's being tested: the wiring contract between runExecutor and a
 * RunExecutorAgent — event translation (tool_call/tool_result/notification
 * → onTool/onResult/onAsset/onNotification callbacks), lastSeenNodeId
 * tagging across interleaved events, AbortSignal → agent.stop()
 * cancellation, and result-status mapping (completed/cancelled/failed).
 *
 * What's NOT tested: the real ExecutorAgent's behavior — that's the
 * planner's concern, not the bridge's. We inject a stub agent via
 * `agentFactory` so this suite is fast (~ms) and deterministic.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runExecutor,
  type RunExecutorAgent,
  type RunExecutorAgentFactory,
} from '../../src/server/runners/runExecutor.js';
import type { GenericProjectFile } from '../../src/core/templates/types.js';

// ── Stub agent + factory ─────────────────────────────────────────────

interface StubControls {
  emit(event: 'tool_call' | 'tool_result' | 'notification', data: unknown): void;
  resolve(result: { status: string; error?: string }): void;
  reject(err: Error): void;
  stopCalls: number;
  getStopReasonValue: string | null;
  setStopReason(reason: string | null): void;
}

function createStubAgent(): { agent: RunExecutorAgent; controls: StubControls } {
  const handlers = new Map<string, Array<(e: unknown) => void>>();
  let runResolve: (r: { status: string; error?: string }) => void = () => {};
  let runReject: (e: Error) => void = () => {};
  let stopReason: string | null = null;
  let stopCalls = 0;

  const agent: RunExecutorAgent = {
    on(event, handler) {
      const bucket = handlers.get(event) ?? [];
      bucket.push(handler);
      handlers.set(event, bucket);
      return undefined;
    },
    run(_task) {
      return new Promise((res, rej) => {
        runResolve = res;
        runReject = rej;
      });
    },
    stop() {
      stopCalls += 1;
    },
    getStopReason() {
      return stopReason;
    },
  };

  const controls: StubControls = {
    emit(event, data) {
      for (const h of handlers.get(event) ?? []) h(data);
    },
    resolve(result) {
      runResolve(result);
    },
    reject(err) {
      runReject(err);
    },
    get stopCalls() {
      return stopCalls;
    },
    get getStopReasonValue() {
      return stopReason;
    },
    setStopReason(reason: string | null) {
      stopReason = reason;
    },
  };

  return { agent, controls };
}

// ── Fixtures ─────────────────────────────────────────────────────────

const minimalProject: GenericProjectFile = {
  templateId: 'narrative',
  name: 'test',
  // The bridge doesn't actually inspect these fields; the stub agent
  // ignores them. We just need a non-empty object to pass through.
} as unknown as GenericProjectFile;

function makeFactory(stub: {
  agent: RunExecutorAgent;
  controls: StubControls;
}): RunExecutorAgentFactory {
  return () => stub.agent;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('runExecutor bridge', () => {
  it('translates tool_call → onTool with toolName + nodeId from arguments.shot', async () => {
    const stub = createStubAgent();
    const onTool = vi.fn();

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/fake-project',
      target: {},
      agentFactory: makeFactory(stub),
      onTool,
    });

    stub.controls.emit('tool_call', {
      toolName: 'image_text_to_image',
      arguments: { shot: 'shot_1', somethingElse: 'ignored' },
    });

    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(onTool).toHaveBeenCalledTimes(1);
    expect(onTool).toHaveBeenCalledWith({
      toolName: 'image_text_to_image',
      nodeId: 'shot_1',
    });
  });

  it('falls back through arguments.shot → arguments.node → arguments.itemId for nodeId', async () => {
    const stub = createStubAgent();
    const onTool = vi.fn();

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
      onTool,
    });

    // No `shot`, has `node`
    stub.controls.emit('tool_call', {
      toolName: 't1',
      arguments: { node: 'node_id_1' },
    });
    // No `shot` or `node`, has `itemId`
    stub.controls.emit('tool_call', {
      toolName: 't2',
      arguments: { itemId: 'item_42' },
    });
    // None of them present
    stub.controls.emit('tool_call', { toolName: 't3', arguments: {} });

    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(onTool).toHaveBeenNthCalledWith(1, { toolName: 't1', nodeId: 'node_id_1' });
    expect(onTool).toHaveBeenNthCalledWith(2, { toolName: 't2', nodeId: 'item_42' });
    expect(onTool).toHaveBeenNthCalledWith(3, { toolName: 't3', nodeId: undefined });
  });

  it('translates tool_result → onResult with file_path + status', async () => {
    const stub = createStubAgent();
    const onResult = vi.fn();

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
      onResult,
    });

    stub.controls.emit('tool_result', {
      toolName: 'image_text_to_image',
      result: { file_path: '/abs/x.png', status: 'completed' },
    });

    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(onResult).toHaveBeenCalledWith({
      toolName: 'image_text_to_image',
      filePath: '/abs/x.png',
      status: 'completed',
    });
  });

  it('emits onAsset for image / video file_paths, classified by extension', async () => {
    const stub = createStubAgent();
    const onAsset = vi.fn();

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
      onAsset,
    });

    stub.controls.emit('tool_result', {
      toolName: 't_img',
      result: { file_path: '/abs/foo.png' },
    });
    stub.controls.emit('tool_result', {
      toolName: 't_vid',
      result: { file_path: '/abs/foo.mp4' },
    });
    stub.controls.emit('tool_result', {
      toolName: 't_other',
      result: { file_path: '/abs/foo.json' }, // not image/video → no asset
    });
    stub.controls.emit('tool_result', {
      toolName: 't_no_path',
      result: { status: 'completed' }, // no file_path → no asset
    });

    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(onAsset).toHaveBeenCalledTimes(2);
    expect(onAsset).toHaveBeenNthCalledWith(1, {
      kind: 'image',
      filePath: '/abs/foo.png',
      toolName: 't_img',
      nodeId: undefined,
    });
    expect(onAsset).toHaveBeenNthCalledWith(2, {
      kind: 'video',
      filePath: '/abs/foo.mp4',
      toolName: 't_vid',
      nodeId: undefined,
    });
  });

  it('tags onAsset with lastSeenNodeId from the most recent tool_call', async () => {
    const stub = createStubAgent();
    const onAsset = vi.fn();

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
      onTool: () => {}, // also opt into onTool wiring path
      onAsset,
    });

    // tool_call sets lastSeenNodeId
    stub.controls.emit('tool_call', {
      toolName: 't1',
      arguments: { shot: 'shot_3' },
    });
    // tool_result inherits it
    stub.controls.emit('tool_result', {
      toolName: 't1',
      result: { file_path: '/abs/a.png' },
    });
    // a new tool_call updates it
    stub.controls.emit('tool_call', {
      toolName: 't2',
      arguments: { node: 'node_99' },
    });
    stub.controls.emit('tool_result', {
      toolName: 't2',
      result: { file_path: '/abs/b.mp4' },
    });

    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(onAsset).toHaveBeenNthCalledWith(1, expect.objectContaining({
      filePath: '/abs/a.png',
      nodeId: 'shot_3',
    }));
    expect(onAsset).toHaveBeenNthCalledWith(2, expect.objectContaining({
      filePath: '/abs/b.mp4',
      nodeId: 'node_99',
    }));
  });

  it('translates notification events → onNotification with level + message', async () => {
    const stub = createStubAgent();
    const onNotification = vi.fn();

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
      onNotification,
    });

    stub.controls.emit('notification', { level: 'warning', message: 'slow queue' });

    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(onNotification).toHaveBeenCalledWith({
      level: 'warning',
      message: 'slow queue',
    });
  });

  it('does NOT subscribe to tool_call when no onTool/onAsset is provided', async () => {
    // Optimization in the bridge: if neither onTool nor onAsset is set,
    // the tool_call subscription is skipped. This guards against
    // unnecessary work for callers that only care about results.
    const stub = createStubAgent();
    const handlerCounts = new Map<string, number>();
    const originalOn = stub.agent.on;
    stub.agent.on = (event, handler) => {
      handlerCounts.set(event, (handlerCounts.get(event) ?? 0) + 1);
      return originalOn.call(stub.agent, event, handler);
    };

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
      // no onTool, no onAsset, no onResult → only tool_result subscribes
      // (tool_result is always subscribed because of the unconditional
      // agent.on('tool_result', ...) block in runExecutor)
    });

    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(handlerCounts.get('tool_call')).toBeUndefined();
    expect(handlerCounts.get('tool_result')).toBe(1); // always wired
    expect(handlerCounts.get('notification')).toBeUndefined();
  });

  // ── Cancellation path ─────────────────────────────────────────────

  it('forwards AbortSignal abort → agent.stop()', async () => {
    const stub = createStubAgent();
    const controller = new AbortController();

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
      signal: controller.signal,
    });

    expect(stub.controls.stopCalls).toBe(0);
    controller.abort();
    expect(stub.controls.stopCalls).toBe(1);

    // Resolve so the runPromise doesn't dangle.
    stub.controls.resolve({ status: 'cancelled' });
    await runPromise;
  });

  // ── Result mapping ────────────────────────────────────────────────

  it('maps result.status="completed" + no stopReason → completed', async () => {
    const stub = createStubAgent();
    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
    });
    stub.controls.resolve({ status: 'completed' });
    const result = await runPromise;
    expect(result.status).toBe('completed');
    expect(result.stopReason).toBe(null);
    expect(result.error).toBeUndefined();
  });

  it('maps non-completed status + stopReason="cancelled" → cancelled', async () => {
    // Note: per mapExecutorStatus, raw status='completed' ALWAYS wins
    // — paused_at_stage and cancelled stopReasons only matter when the
    // agent itself didn't already declare success. Here we test the
    // cancellation-override path with a non-completed raw status.
    const stub = createStubAgent();
    stub.controls.setStopReason('cancelled');
    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
    });
    stub.controls.resolve({ status: 'interrupted' });
    const result = await runPromise;
    expect(result.status).toBe('cancelled');
    expect(result.stopReason).toBe('cancelled');
    expect(result.rawResultStatus).toBe('interrupted');
  });

  it('maps stopReason="paused_at_stage" → completed (paused is treated as success)', async () => {
    const stub = createStubAgent();
    stub.controls.setStopReason('paused_at_stage');
    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: { stage: 'shot_image' },
      agentFactory: makeFactory(stub),
    });
    // Raw status anything-but-completed; the paused-at-stage stopReason
    // promotes it to completed.
    stub.controls.resolve({ status: 'paused' });
    const result = await runPromise;
    expect(result.status).toBe('completed');
    expect(result.stopReason).toBe('paused_at_stage');
  });

  it('maps result.error + status=error → failed with error string', async () => {
    const stub = createStubAgent();
    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
    });
    stub.controls.resolve({ status: 'error', error: 'workflow exploded' });
    const result = await runPromise;
    expect(result.status).toBe('failed');
    expect(result.error).toBe('workflow exploded');
    expect(result.rawResultStatus).toBe('error');
  });

  it('thrown error during run + signal aborted → cancelled (not failed)', async () => {
    const stub = createStubAgent();
    const controller = new AbortController();
    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
      signal: controller.signal,
    });

    controller.abort();
    stub.controls.reject(new Error('agent threw mid-run'));

    const result = await runPromise;
    expect(result.status).toBe('cancelled');
    expect(result.stopReason).toBe('cancelled');
    expect(result.rawResultStatus).toBe('thrown');
  });

  it('thrown error during run + no abort → failed with error', async () => {
    const stub = createStubAgent();
    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: makeFactory(stub),
    });

    stub.controls.reject(new Error('boom'));

    const result = await runPromise;
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    expect(result.rawResultStatus).toBe('thrown');
  });

  // ── Target options ────────────────────────────────────────────────

  it('passes stopAtStage / stopAfterNode / skipMedia through to the agent factory', async () => {
    const stub = createStubAgent();
    let capturedOpts: Record<string, unknown> | undefined;
    const factory: RunExecutorAgentFactory = (_llm, opts) => {
      capturedOpts = opts as unknown as Record<string, unknown>;
      return stub.agent;
    };

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: { stage: 'shot_image', skipMedia: true },
      agentFactory: factory,
      name: 'test-name',
    });
    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(capturedOpts).toBeDefined();
    expect(capturedOpts!['stopAtStage']).toBe('shot_image');
    expect(capturedOpts!['skipMediaGeneration']).toBe(true);
    expect(capturedOpts!['name']).toBe('test-name');
    expect(capturedOpts!['stopAfterNode']).toBeUndefined();
  });

  it('omits stopAtStage / stopAfterNode / skipMediaGeneration when not in target', async () => {
    const stub = createStubAgent();
    let capturedOpts: Record<string, unknown> | undefined;
    const factory: RunExecutorAgentFactory = (_llm, opts) => {
      capturedOpts = opts as unknown as Record<string, unknown>;
      return stub.agent;
    };

    const runPromise = runExecutor({
      project: minimalProject,
      projectDir: '/tmp/p',
      target: {},
      agentFactory: factory,
    });
    stub.controls.resolve({ status: 'completed' });
    await runPromise;

    expect(capturedOpts!['stopAtStage']).toBeUndefined();
    expect(capturedOpts!['stopAfterNode']).toBeUndefined();
    expect(capturedOpts!['skipMediaGeneration']).toBeUndefined();
    // `name` defaults to 'in-process'.
    expect(capturedOpts!['name']).toBe('in-process');
  });
});

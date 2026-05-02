/**
 * Production runner that wires the agent-control HTTP routes to a
 * real ExecutorAgent. Thin wrapper around the shared in-process
 * `runExecutor` core; this file just adapts the AgentRunner /
 * RunnerContext / RunFnResult shapes the HTTP path uses.
 *
 * Concurrency caveat (same as before, lives in runExecutor):
 * pipeline tools read the process-global `activeProjectDir`. The
 * JobManager already serializes per-project; cross-project is the
 * caller's responsibility.
 */

import type { GenericProjectFile } from '../core/templates/types.js';
import type { AgentRunner, RunnerContext } from './agentRoutes.js';
import type { RunFnResult } from './jobManager.js';
import { runExecutor } from './runners/runExecutor.js';

export function createExecutorRunner(): AgentRunner {
  return async (ctx: RunnerContext): Promise<RunFnResult> => {
    // Bridge JobManager's stop hook to AbortSignal — runExecutor speaks
    // AbortSignal, the JobManager API hands us a setStopFn registry.
    const ac = new AbortController();
    ctx.setStopFn?.(() => ac.abort());

    const result = await runExecutor({
      project: ctx.project as unknown as GenericProjectFile,
      projectDir: ctx.projectDir,
      target: {
        ...(ctx.target.stage ? { stage: ctx.target.stage } : {}),
        ...(ctx.target.nodeId ? { nodeId: ctx.target.nodeId } : {}),
        ...(ctx.target.skipMedia ? { skipMedia: true } : {}),
      },
      signal: ac.signal,
      name: 'pi-agent-run-to',
    });

    return {
      status: result.status,
      stopReason: result.stopReason,
      ...(result.error ? { error: result.error } : {}),
    };
  };
}

/**
 * Production runner that wires the agent-control HTTP routes to a
 * real ExecutorAgent. Mirrors `scripts/run-to.ts` but as an injectable
 * function so tests can stub it.
 *
 * One important caveat: a number of pipeline tools read the
 * process-global `activeProjectDir` (see `src/tasks/video/workflow/
 * activeProject.ts`). To keep things sane when one Node process serves
 * multiple agents, the runner sets the active project dir for the
 * duration of the run. Concurrent runs across DIFFERENT projects
 * would clobber each other's `activeProjectDir`, so callers should
 * serialize cross-project run-tos. The JobManager already serializes
 * per-project; cross-project is the user's responsibility for now.
 */

import { LLMClient } from '../core/llm/index.js';
import { ExecutorAgent } from '../core/planner/ExecutorAgent.js';
import { getVideoTemplate } from '../tasks/video/index.js';
import { setActiveProjectDir } from '../tasks/video/workflow/activeProject.js';
import { resolveProjectDuration } from '../core/project/projectTypes.js';
import type { GenericProjectFile } from '../core/templates/types.js';
import type { AgentRunner, RunnerContext } from './agentRoutes.js';
import type { RunFnResult } from './jobManager.js';

export function createExecutorRunner(): AgentRunner {
  return async (ctx: RunnerContext): Promise<RunFnResult> => {
    setActiveProjectDir(ctx.projectDir);

    const project = ctx.project as unknown as GenericProjectFile;
    const template = getVideoTemplate(project.templateId || 'narrative');
    const llm = new LLMClient({
      baseUrl: process.env['LLM_BASE_URL'],
      apiKey: process.env['LLM_API_KEY'],
      model: process.env['LLM_MODEL'],
    });

    const stopAtStage = ctx.target.stage;
    const stopAfterNode = ctx.target.nodeId;
    const skipMedia = ctx.target.skipMedia === true;

    const agent = new ExecutorAgent(llm, {
      template,
      project,
      projectDir: ctx.projectDir,
      goal: {
        targetArtifacts: ['final_video'],
        preferences: {
          style: project.style || 'cinematic_realism',
          duration: resolveProjectDuration(project),
        },
        description: stopAtStage
          ? `Run pipeline up to stage ${stopAtStage}`
          : stopAfterNode
            ? `Run pipeline up to node ${stopAfterNode}`
            : 'Run pipeline to completion',
      },
      name: 'pi-agent-run-to',
      ...(stopAtStage ? { stopAtStage } : {}),
      ...(stopAfterNode ? { stopAfterNode } : {}),
      ...(skipMedia ? { skipMediaGeneration: true } : {}),
    });

    // Wire the JobManager cancel hook so HTTP `POST /stop` interrupts in-process
    // (faster than the file sentinel, which the executor only checks each tick).
    ctx.setStopFn?.(() => {
      try { (agent as unknown as { stop?: () => void }).stop?.(); } catch { /* best-effort */ }
    });

    try {
      const result = await agent.run(
        stopAtStage
          ? `Run pipeline up to stage ${stopAtStage}`
          : stopAfterNode
            ? `Run pipeline up to node ${stopAfterNode}`
            : 'Run pipeline',
      );

      const stopReason = typeof (agent as unknown as { getStopReason?: () => unknown }).getStopReason === 'function'
        ? (agent as unknown as { getStopReason(): string | null }).getStopReason()
        : null;

      // 'paused_at_stage' is success — same convention as run-to.ts.
      // 'cancelled' is signalled via stopReason; the result.status itself
      // is one of 'completed' | 'error' | 'interrupted' | 'waiting_for_user'.
      const status: RunFnResult['status'] =
        result.status === 'completed' ? 'completed'
        : stopReason === 'paused_at_stage' ? 'completed'
        : stopReason === 'cancelled' ? 'cancelled'
        : 'failed';

      return {
        status,
        stopReason: stopReason ?? null,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (err) {
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

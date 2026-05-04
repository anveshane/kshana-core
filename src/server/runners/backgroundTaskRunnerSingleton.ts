/**
 * Process-wide singleton instance of `BackgroundTaskRunner`.
 *
 * The runner is the single source of truth for "what long kshana
 * operation is currently running" across the host. The pi-agent
 * dispatch tools (`kshana_dispatch_run_to`, etc.) talk to this
 * instance; the kshanaCoreManager subscribes to its events and
 * forwards them to the originating chat session's IPC stream.
 *
 * The singleton's `executor` understands every supported `TaskKind`
 * — for the MVP that's `run_to`, with the others to follow as
 * they're plumbed.
 *
 * Tests should NEVER use this singleton directly. Construct a
 * fresh `BackgroundTaskRunner` with a stub executor instead.
 */

import {
  BackgroundTaskRunner,
  type TaskExecutionContext,
} from './BackgroundTaskRunner.js';
import { runExecutor } from './runExecutor.js';
import { resolveProjectDir } from '../../agent/pi/tools/resolveProjectDir.js';
import { getProjectsDir } from '../../agent/pi/paths.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyRunTarget } from './classifyRunTarget.js';
import { resolveNodeId, type ExecutorState } from '../../core/project/projectTypes.js';
import type { GenericProjectFile } from '../../core/templates/types.js';

async function executeRunTo(ctx: TaskExecutionContext): Promise<void> {
  const params = ctx.spec.params as {
    projectDir?: string;
    stage?: string;
    skip_media?: boolean;
  };

  const projectDir = resolveProjectDir({
    name: ctx.spec.projectName,
    basePath: getProjectsDir(),
    ...(params.projectDir ? { projectDir: params.projectDir } : {}),
  });

  const projectJsonPath = join(projectDir, 'project.json');
  if (!existsSync(projectJsonPath)) {
    throw new Error(`project.json not found in ${projectDir}`);
  }
  const project = JSON.parse(readFileSync(projectJsonPath, 'utf-8')) as GenericProjectFile;

  let resolvedTarget: { stage?: string; nodeId?: string };
  const classified = classifyRunTarget(params.stage ?? null);
  if (classified.alias) {
    const state = (project as unknown as { executorState?: ExecutorState })
      .executorState;
    if (!state) {
      throw new Error(
        `Cannot resolve alias '${classified.alias}' — project has no executorState yet. Run kshana_run_to without a target first to bootstrap.`,
      );
    }
    const resolved = resolveNodeId(state, classified.alias);
    if (!resolved) {
      throw new Error(`Unknown alias: '${classified.alias}'.`);
    }
    resolvedTarget = { nodeId: resolved };
  } else {
    resolvedTarget = {
      ...(classified.stage ? { stage: classified.stage } : {}),
      ...(classified.nodeId ? { nodeId: classified.nodeId } : {}),
    };
  }

  const result = await runExecutor({
    project,
    projectDir,
    target: {
      ...resolvedTarget,
      ...(params.skip_media ? { skipMedia: true } : {}),
    },
    signal: ctx.signal,
    name: 'task-runner-run-to',
    onTool: (info) => ctx.hooks.onTool(info),
    onResult: (info) => ctx.hooks.onResult(info),
    onNotification: (info) => ctx.hooks.onNotification(info),
    ...(ctx.hooks.onAsset
      ? {
          onAsset: (event) => {
            ctx.hooks.onAsset?.({
              kind: event.kind,
              filePath: event.filePath,
              ...(event.toolName !== undefined ? { toolName: event.toolName } : {}),
              ...(event.nodeId !== undefined ? { nodeId: event.nodeId } : {}),
            });
          },
        }
      : {}),
  });

  if (result.status === 'failed') {
    throw new Error(result.error ?? 'run_to failed');
  }
  // Cancelled is signaled via abort, runner classifies it.
}

// IMPORTANT: this singleton must be process-wide. tsup builds
// multiple entry bundles (dist/server/manager.js, dist/server/runners,
// dist/agent/pi, dist/index) and each one inlines its own copy of
// this module — so a per-module `let singleton` would create one
// runner instance per bundle. ConversationManager would subscribe
// to instance A; the desktop's IPC cancel handler (which loads
// `kshana-core/runners`) would call .cancel() on instance B and the
// running task would never abort. Pin on `globalThis` so all bundles
// resolve to the same instance.
const SINGLETON_KEY = '__kshana_background_task_runner__';

interface SingletonHolder {
  [SINGLETON_KEY]?: BackgroundTaskRunner;
}

function holder(): SingletonHolder {
  return globalThis as unknown as SingletonHolder;
}

export function getBackgroundTaskRunner(): BackgroundTaskRunner {
  const g = holder();
  let singleton = g[SINGLETON_KEY];
  if (!singleton) {
    singleton = new BackgroundTaskRunner(async (ctx) => {
      switch (ctx.spec.kind) {
        case 'run_to':
          await executeRunTo(ctx);
          return;
        case 'regen':
        case 'render_scene_bundle':
        case 'audit_fidelity':
          throw new Error(
            `Background task kind '${ctx.spec.kind}' is not yet wired to an executor.`,
          );
        default: {
          const _exhaustive: never = ctx.spec.kind;
          throw new Error(`Unknown task kind: ${String(_exhaustive)}`);
        }
      }
    });
    g[SINGLETON_KEY] = singleton;
  }
  return singleton;
}

/** Test-only — drop the singleton so the next get rebuilds. */
export function __resetBackgroundTaskRunnerForTesting(): void {
  delete holder()[SINGLETON_KEY];
}

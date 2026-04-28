#!/usr/bin/env tsx
/**
 * Run the pipeline up to a stage, then pause — CLI counterpart of the
 * `/run-to <stage>` slash command.
 *
 * Same executor, same stage vocabulary, same stage-gate semantics (stops
 * after EVERY node of the gated typeIds is terminal — see
 * `src/core/planner/stages.ts`). Unlike `test-stage.ts` (which uses the
 * legacy stopAfterNodeType "stop after first node" behavior), this runs
 * the full stage to completion before pausing.
 *
 * Usage:
 *   pnpm run-to <project> [stage] [--skip-media]
 *
 * Examples:
 *   # Run until all reference images are generated, then pause
 *   pnpm run-to lazarus_drive character_image
 *
 *   # Regenerate just the scene breakdowns (prompts only, no images/video)
 *   pnpm run-to lazarus_drive scene_video_prompt --skip-media
 *
 *   # Drive to completion — no gate, same as a UI "start_task"
 *   pnpm run-to lazarus_drive
 *
 * Exit codes:
 *   0 — complete or paused_at_stage (state persisted, safe to resume)
 *   1 — failed, cancelled, or argument error
 *
 * Prerequisites:
 *   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL — required for any LLM stages.
 *   ComfyUI tunnel up — only needed when not using --skip-media.
 *   Optional: DISABLE_VLM=true to silence VLM reviews in unattended runs.
 */

import 'dotenv/config';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { ExecutorAgent } from '../src/core/planner/ExecutorAgent.js';
import { LLMClient } from '../src/core/llm/index.js';
import { getVideoTemplate } from '../src/tasks/video/index.js';
import { VALID_STAGES } from '../src/core/planner/stages.js';
import { setActiveProjectDir } from '../src/tasks/video/workflow/activeProject.js';
import type { GenericProjectFile } from '../src/core/templates/types.js';

function usage(exitCode = 1): never {
  console.log(`
Usage: pnpm run-to <project> [stage] [--skip-media]

  <project>     project name (folder: <project>.kshana)
  [stage]       optional — pause after this stage completes. Omit to run to final_video.
  --skip-media  skip ComfyUI calls (LLM prompts only). Useful for iterating on prompts.

Valid stages: ${VALID_STAGES.join(', ')}

Examples:
  pnpm run-to lazarus_drive character_image
  pnpm run-to lazarus_drive scene_video_prompt --skip-media
  pnpm run-to lazarus_drive                         # run to completion (no gate)
`);
  process.exit(exitCode);
}

/**
 * Parse argv into { projectName, target, skipMedia }.
 * `target` is either a stage typeId (`shot_image`), a full node id
 * (`shot_image:scene_1_shot_1`), or null (no gate).
 *
 * Exported so the unit test can exercise the parsing independently of
 * actually spawning the executor.
 */
export function parseArgs(argv: string[]): {
  projectName: string;
  target: string | null;
  skipMedia: boolean;
} {
  // Accept `--skip-media` or `-s` as a flag anywhere after positional args.
  const skipMedia = argv.includes('--skip-media') || argv.includes('-s');
  const positional = argv.filter(a => !a.startsWith('-'));

  if (positional.length < 1 || positional.length > 2) {
    throw new Error(`Expected 1 or 2 positional args (project [stage|node]); got ${positional.length}`);
  }

  const projectName = positional[0]!;
  const target = positional[1] ?? null;

  // Validation deferred to main(): a stage typeId is checked here, but
  // a node-id/alias needs the project's executorState to resolve.
  if (target !== null && !VALID_STAGES.includes(target) && !target.includes(':') && !target.includes('.')) {
    throw new Error(
      `Unknown target: '${target}'. Expected a stage (${VALID_STAGES.join(', ')}) or a node id like 'shot_image:scene_1_shot_1' or alias like 'scene_1_shot_1.image'.`,
    );
  }

  return { projectName, target, skipMedia };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage(0);
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}\n`);
    usage(1);
  }

  const { projectName, target, skipMedia } = parsed;
  const projectDir = resolve(`${projectName}.kshana`);
  if (!existsSync(projectDir)) {
    console.error(`Project not found: ${projectDir}`);
    process.exit(1);
  }

  // Point the shared SessionContext at this project so every helper that reads
  // `getProjectDir()` / `getAssetsDir()` (submitImageGeneration in
  // src/tasks/video/tools.ts, asset registry, etc.) writes into this project's
  // folder. Without this, media downloads leak into `default.kshana` while the
  // graph registers paths under the correct project — causing "Base image not
  // found" failures on the next step. The UI does this in App.tsx; the CLI
  // must do it explicitly.
  setActiveProjectDir(`${projectName}.kshana`);

  const project: GenericProjectFile = JSON.parse(
    readFileSync(join(projectDir, 'project.json'), 'utf-8'),
  );

  // Classify the target: stage typeId vs single node id / alias. Stage
  // typeIds are valid up-front; node ids/aliases need the project's
  // executorState to resolve (e.g. `scene_1_shot_2.image` →
  // `shot_image:scene_1_shot_2`).
  let stopAtStage: string | null = null;
  let stopAfterNode: string | null = null;
  if (target !== null) {
    if (VALID_STAGES.includes(target)) {
      stopAtStage = target;
    } else {
      const { resolveNodeId } = await import('./cli-helpers.js');
      const state = (project as unknown as { executorState?: { nodes: Record<string, unknown> } }).executorState;
      if (!state) {
        console.error(`Cannot resolve node target '${target}' — project has no executorState yet. Run 'pnpm run-to <project>' first to bootstrap, then target a specific node.`);
        process.exit(1);
      }
      const resolved = resolveNodeId(state as never, target);
      if (!resolved) {
        console.error(`Unknown target: '${target}'. Not a stage typeId, and no matching node id/alias in this project's graph.`);
        process.exit(1);
      }
      stopAfterNode = resolved;
    }
  }

  const gateLabel = stopAtStage
    ? `stage=${stopAtStage}`
    : stopAfterNode
      ? `node=${stopAfterNode}`
      : '(none — run to final_video)';
  const banner = [
    `=== run-to ===`,
    `  Project:     ${projectName} (${project.title || project.id})`,
    `  Pause after: ${gateLabel}`,
    `  Skip media:  ${skipMedia}`,
    ``,
  ].join('\n');
  console.log(banner);

  const template = getVideoTemplate(project.templateId || 'narrative');
  const llm = new LLMClient({
    baseUrl: process.env['LLM_BASE_URL'],
    apiKey: process.env['LLM_API_KEY'],
    model: process.env['LLM_MODEL'],
  });

  const agent = new ExecutorAgent(llm, {
    template,
    project,
    projectDir,
    goal: {
      targetArtifacts: ['final_video'],
      preferences: {
        style: project.style || 'cinematic_realism',
        duration: (project as unknown as { duration?: number }).duration ?? 60,
      },
      description: stopAtStage
        ? `Run pipeline up to stage ${stopAtStage}`
        : stopAfterNode
          ? `Run pipeline up to node ${stopAfterNode}`
          : 'Run pipeline to completion',
    },
    name: 'run-to-cli',
    ...(stopAtStage ? { stopAtStage } : {}),
    ...(stopAfterNode ? { stopAfterNode } : {}),
    ...(skipMedia ? { skipMediaGeneration: true } : {}),
  });

  // Stream a lightweight progress log. Verbose streams (LLM token-by-token,
  // image generation dots) are suppressed — tail the project's
  // `logs/executor.log` for the full trace.
  agent.on('tool_call', (event) => {
    const args = (event as { arguments?: Record<string, unknown> }).arguments;
    const nodeId = args?.['shot'] ?? args?.['node'] ?? args?.['itemId'];
    const hint = nodeId ? ` ${nodeId}` : '';
    process.stdout.write(`  [${event.toolName}]${hint}\n`);
  });

  agent.on('tool_result', (event) => {
    const r = (event as { result?: { file_path?: string; status?: string } }).result;
    if (r?.file_path) process.stdout.write(`    → ${r.file_path}\n`);
    else if (r?.status) process.stdout.write(`    → ${r.status}\n`);
  });

  agent.on('notification', (event) => {
    const level = (event as { level: string }).level;
    const msg = (event as { message: string }).message;
    if (level === 'error' || level === 'warning') {
      process.stderr.write(`  [${level}] ${msg}\n`);
    } else {
      process.stdout.write(`  [info] ${msg}\n`);
    }
  });
  // tool_streaming intentionally muted — too noisy for CLI

  try {
    const result = await agent.run(
      stopAtStage
        ? `Run pipeline up to stage ${stopAtStage}`
        : stopAfterNode
          ? `Run pipeline up to node ${stopAfterNode}`
          : 'Run pipeline',
    );
    // Read the stop reason if available (added with /run-to feature).
    // Older agents without getStopReason fall through the normal result path.
    const stopReason = typeof (agent as unknown as { getStopReason?: () => unknown }).getStopReason === 'function'
      ? (agent as unknown as { getStopReason(): string | null }).getStopReason()
      : null;

    console.log(`\n=== Run finished ===`);
    console.log(`  result.status: ${result.status}`);
    console.log(`  stopReason:    ${stopReason ?? '(unknown)'}`);
    if (result.error) console.log(`  error:         ${result.error}`);

    // Success = complete OR paused_at_stage (both leave state in a safe
    // resumable form). Anything else (failed, cancelled, error) is exit 1.
    const ok = result.status === 'completed' || stopReason === 'paused_at_stage';
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(`\nFatal: ${(err as Error).message}`);
    process.exit(1);
  }
}

// Only run main() when invoked directly (not when imported by tests).
// Detection: the script's file path must match process.argv[1].
const invokedDirectly = (() => {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return invoked.endsWith('run-to.ts') || invoked.endsWith('run-to.js');
})();

if (invokedDirectly) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

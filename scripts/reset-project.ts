#!/usr/bin/env tsx
/**
 * Reset a project's executor state to a specific stage.
 *
 * Usage:
 *   pnpm tsx scripts/reset-project.ts <project-name> <stage> [--clean]
 *
 * Stages (in pipeline order):
 *   plot                  - Reset everything, start from scratch
 *   story                 - Keep plot, reset story onwards
 *   characters            - Keep plot+story, reset character/setting/scene extraction onwards
 *   character_image       - Keep through characters/settings/scenes, reset image gen onwards
 *   scene_video_prompt    - Keep through images, reset shot planning onwards
 *   shot_image_prompt     - Keep through scene_video_prompts, reset shot image gen onwards
 *   shot_video            - Keep through shot images, reset video gen onwards
 *   final_video           - Keep through shot videos, reset final assembly
 *
 * The actual reset logic lives in
 * `src/server/runners/resetProjectStage.ts` so the pi-agent / packaged
 * desktop can call it in-process. This script is a thin CLI wrapper.
 */

import {
  resetProjectStage,
  ResetProjectError,
} from '../src/server/runners/resetProjectStage.js';
import { STAGE_ALIASES, TEMPLATE_DEPS } from '../src/core/planner/stages.js';

/**
 * Re-export for backwards-compatible imports. The real implementation
 * is now private inside `src/server/runners/resetProjectStage.ts`; this
 * module-level helper exists so legacy tests (`tests/reset-stages.test.ts`)
 * keep working without touching them.
 */
function computeResetTypes(startType: string): string[] {
  const dependents: Record<string, string[]> = {};
  for (const [type, deps] of Object.entries(TEMPLATE_DEPS)) {
    for (const dep of deps) {
      if (!dependents[dep]) dependents[dep] = [];
      dependents[dep]!.push(type);
    }
  }
  const result = new Set<string>([startType]);
  const queue = [startType];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependents[current] ?? []) {
      if (!result.has(dependent)) {
        result.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return Array.from(result);
}

export { computeResetTypes, TEMPLATE_DEPS, STAGE_ALIASES };

function main(): void {
  const rawArgs = process.argv.slice(2);
  const cleanFlag = rawArgs.includes('--clean');
  const args = rawArgs.filter((a) => a !== '--clean');
  if (args.length < 2) {
    console.error(
      'Usage: pnpm tsx scripts/reset-project.ts <project-name> <stage> [--clean]',
    );
    console.error('');
    console.error('Stages:', Object.keys(STAGE_ALIASES).join(', '));
    console.error('');
    console.error(
      '--clean  wipe executorState entirely so the dependency graph rebuilds on next run.',
    );
    console.error(
      '         Use when prior runs left stale per-item nodes (4→7 scene restructure, etc.)',
    );
    process.exit(1);
  }

  const [projectName, stage] = args;
  try {
    resetProjectStage({
      basePath: process.cwd(),
      projectName: projectName!,
      stage: stage!,
      clean: cleanFlag,
      // Surface progress live; resetProjectStage also returns the full
      // log array, but for the CLI streaming feels more useful.
      onLog: (line) => console.log(line),
    });
  } catch (err) {
    if (err instanceof ResetProjectError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

const isDirectExecution = process.argv[1]?.endsWith('reset-project.ts');
if (isDirectExecution) {
  main();
}

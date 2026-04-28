#!/usr/bin/env tsx
/**
 * Regenerate one specific node and its downstream consumers.
 *
 * Usage:
 *   pnpm regen <project> <node-id-or-alias> [--cascade] [--no-run]
 *
 * Examples:
 *   pnpm regen myproj shot_image_prompt:scene_2_shot_3   # exact id
 *   pnpm regen myproj scene_2_shot_3.prompt              # alias
 *   pnpm regen myproj scene_2.svp                        # regen scene 2's video prompt
 *   pnpm regen myproj scene_2.svp --cascade              # also reset every node downstream
 *
 * Default: marks ONLY the named node as pending. The next `run-to` picks
 * it up; downstream nodes whose deps are still 'completed' may already
 * have valid output and won't auto-rerun.
 *
 * --cascade: marks every transitively-downstream node as pending too,
 * so changes to this node propagate (e.g. regen the SVP and you almost
 * certainly want the per-shot prompts/images/videos to redo).
 *
 * --no-run: just resets the node(s) and exits. Default is to run-to
 * final_video after the reset.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { loadProjectStrict, resolveNodeId, type ExecutionNode } from './cli-helpers.js';

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2 || argv[0] === '--help' || argv[0] === '-h') {
    console.error('Usage: pnpm regen <project> <node-id-or-alias> [--cascade] [--no-run]');
    process.exit(argv[0] === '--help' || argv[0] === '-h' ? 0 : 1);
  }
  const positional: string[] = [];
  let cascade = false;
  let noRun = false;
  for (const a of argv) {
    if (a === '--cascade') cascade = true;
    else if (a === '--no-run') noRun = true;
    else if (!a.startsWith('--')) positional.push(a);
  }
  const [projectName, alias] = positional as [string, string];

  const { project, projectDir } = loadProjectStrict(projectName);
  const state = project.executorState;
  if (!state || !state.nodes) {
    console.error(`No executor state. Run \`pnpm run-to ${projectName}\` first.`);
    process.exit(1);
  }

  const nodeId = resolveNodeId(state, alias);
  if (!nodeId) {
    console.error(`No matching node for alias: "${alias}"`);
    process.exit(1);
  }

  const targets: string[] = [nodeId];
  if (cascade) {
    // BFS through `dependents` to gather every downstream node.
    const seen = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const node = state.nodes[cur]!;
      for (const child of node.dependents ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        queue.push(child);
        targets.push(child);
      }
    }
  }

  console.log(`Regenerating ${targets.length} node(s):`);
  for (const id of targets) {
    const node = state.nodes[id] as ExecutionNode | undefined;
    if (!node) continue;
    console.log(`  · ${id} (was: ${node.status})`);
    node.status = 'pending';
    delete node.outputPath;
    delete node.error;
    delete node.startedAt;
    delete node.completedAt;
  }

  // Persist updated state to project.json.
  const projectJsonPath = join(projectDir, 'project.json');
  const raw = readFileSync(projectJsonPath, 'utf-8');
  const obj = JSON.parse(raw) as Record<string, unknown>;
  (obj['executorState'] as { nodes: Record<string, ExecutionNode> }).nodes = state.nodes;
  writeFileSync(projectJsonPath, JSON.stringify(obj, null, 2));
  console.log(`Wrote updated state to ${projectJsonPath}`);

  if (noRun) {
    console.log('');
    console.log('--no-run was set; exiting without running.');
    return;
  }

  // Hand off to run-to.
  console.log('');
  console.log(`Running pipeline to final_video...`);
  const res = spawnSync('pnpm', ['run-to', projectName], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  process.exit(res.status ?? 0);
}

main();

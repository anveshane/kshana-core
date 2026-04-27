#!/usr/bin/env tsx
/**
 * List nodes in a project, optionally filtered by typeId or status.
 *
 * Usage:
 *   pnpm nodes <project>                          # all nodes, grouped by typeId
 *   pnpm nodes <project> --type shot_image_prompt # one type only
 *   pnpm nodes <project> --status failed          # one status only
 *   pnpm nodes <project> --grep scene_2           # regex match against node id
 */
import { loadProjectStrict, type ExecutionNode } from './cli-helpers.js';

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1 || argv[0] === '--help' || argv[0] === '-h') {
    console.error('Usage: pnpm nodes <project> [--type <typeId>] [--status <status>] [--grep <regex>]');
    process.exit(argv[0] === '--help' || argv[0] === '-h' ? 0 : 1);
  }
  const positional: string[] = [];
  let typeFilter: string | undefined;
  let statusFilter: string | undefined;
  let grep: RegExp | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--type') typeFilter = argv[++i];
    else if (a === '--status') statusFilter = argv[++i];
    else if (a === '--grep') {
      const v = argv[++i];
      if (v) grep = new RegExp(v);
    }
    else if (!a.startsWith('--')) positional.push(a);
  }

  const projectName = positional[0]!;
  const { project } = loadProjectStrict(projectName);
  const state = project.executorState;
  if (!state || !state.nodes) {
    console.error(`No executor state. Try \`pnpm run-to ${projectName}\` first.`);
    process.exit(1);
  }

  let nodes = Object.values(state.nodes) as ExecutionNode[];
  if (typeFilter) nodes = nodes.filter(n => n.typeId === typeFilter);
  if (statusFilter) nodes = nodes.filter(n => n.status === statusFilter);
  if (grep) nodes = nodes.filter(n => grep!.test(n.id));

  if (nodes.length === 0) {
    console.log('(no matching nodes)');
    return;
  }

  // Group by typeId.
  const byType = new Map<string, ExecutionNode[]>();
  for (const n of nodes) {
    let arr = byType.get(n.typeId);
    if (!arr) { arr = []; byType.set(n.typeId, arr); }
    arr.push(n);
  }

  const types = [...byType.keys()].sort();
  for (const typeId of types) {
    const arr = byType.get(typeId)!;
    arr.sort((a, b) => a.id.localeCompare(b.id));
    console.log(`${typeId} (${arr.length}):`);
    for (const n of arr) {
      const marker =
        n.status === 'completed' ? '✓' :
        n.status === 'failed' ? '✗' :
        n.status === 'skipped' ? '⊘' :
        n.status === 'running' ? '→' : '·';
      const item = n.itemId ?? '';
      console.log(`  ${marker} ${item.padEnd(30)} ${n.id}`);
    }
  }
  console.log('');
  console.log(`Total: ${nodes.length}`);
}

main();

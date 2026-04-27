#!/usr/bin/env tsx
/**
 * Print a high-level status summary for a kshana-ink project.
 *
 * Usage:
 *   pnpm status <project-name>
 *
 * Output:
 *   - phase status
 *   - node counts by status (completed/pending/failed/skipped)
 *   - failed nodes with their error messages
 *   - per-typeId rollup so you can see "5/7 scene_video_prompts done"
 */
import { loadProjectStrict, type ExecutionNode } from './cli-helpers.js';

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
    console.error('Usage: pnpm status <project-name>');
    process.exit(args[0] === '--help' || args[0] === '-h' ? 0 : 1);
  }

  const { project, projectDir } = loadProjectStrict(args[0]!);
  const state = project.executorState;

  console.log(`Project: ${project.title}`);
  console.log(`  Path:        ${projectDir}`);
  console.log(`  Style:       ${project.style ?? '(default)'}`);
  console.log(`  Duration:    ${project.targetDuration ?? '(default 60s)'}s`);
  console.log(`  Input type:  ${project.inputType ?? '(unknown)'}`);
  console.log(`  Phase:       ${project.currentPhase ?? '(none)'}`);
  console.log('');

  if (project.phases) {
    console.log('Phases:');
    for (const [name, info] of Object.entries(project.phases)) {
      const marker = info.status === 'completed' ? '✓' : info.status === 'skipped' ? '⊘' : info.status === 'in_progress' ? '→' : ' ';
      console.log(`  ${marker} ${name.padEnd(28)} ${info.status}`);
    }
    console.log('');
  }

  if (!state || !state.nodes || Object.keys(state.nodes).length === 0) {
    console.log('No executor state — project hasn\'t been run yet.');
    console.log(`Try: pnpm run-to ${args[0]}`);
    return;
  }

  const all = Object.values(state.nodes) as ExecutionNode[];
  const byStatus = countBy(all, n => n.status);
  const total = all.length;

  console.log(`Nodes: ${total} total`);
  for (const [status, count] of Object.entries(byStatus)) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    console.log(`  ${status.padEnd(11)} ${count.toString().padStart(4)}  (${pct}%)`);
  }
  console.log('');

  // Per-typeId rollup
  const byType = new Map<string, { total: number; completed: number; failed: number; pending: number }>();
  for (const n of all) {
    let row = byType.get(n.typeId);
    if (!row) {
      row = { total: 0, completed: 0, failed: 0, pending: 0 };
      byType.set(n.typeId, row);
    }
    row.total++;
    if (n.status === 'completed' || n.status === 'skipped') row.completed++;
    else if (n.status === 'failed') row.failed++;
    else row.pending++;
  }

  console.log('By type:');
  const rows = [...byType.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [typeId, row] of rows) {
    const status = row.failed > 0
      ? `${row.completed}/${row.total} ✓  ${row.failed} ✗  ${row.pending} ⏳`
      : `${row.completed}/${row.total} ✓  ${row.pending} ⏳`;
    console.log(`  ${typeId.padEnd(28)} ${status}`);
  }
  console.log('');

  // Failed node details
  const failed = all.filter(n => n.status === 'failed');
  if (failed.length > 0) {
    console.log(`Failed nodes (${failed.length}):`);
    for (const n of failed) {
      console.log(`  ${n.id}`);
      if (n.error) console.log(`    ${n.error.slice(0, 200)}`);
    }
    console.log('');
    console.log(`To retry: pnpm regen <project> <node-id>  (or any failed-node id above)`);
  }

  // Currently-running nodes (rare but useful)
  const running = all.filter(n => n.status === 'running');
  if (running.length > 0) {
    console.log(`Currently running:`);
    for (const n of running) console.log(`  ${n.id}`);
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

main();

#!/usr/bin/env tsx
/**
 * Show details of a node or content artifact.
 *
 * Usage:
 *   pnpm inspect <project> <node-id-or-alias>
 *
 * Examples:
 *   pnpm inspect myproj scene_video_prompt:scene_2     # full node id
 *   pnpm inspect myproj scene_2.svp                    # friendly alias
 *   pnpm inspect myproj scene_2_shot_3.prompt          # → shot_image_prompt:scene_2_shot_3
 *   pnpm inspect myproj elara                          # tries character:elara, then setting:elara, ...
 *
 * Prints the node's status, dependencies, and the content of its
 * outputPath (truncated to 5000 chars unless --full is given).
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import { loadProjectStrict, resolveNodeId } from './cli-helpers.js';

function main() {
  const argv = process.argv.slice(2);
  const full = argv.includes('--full');
  const args = argv.filter(a => !a.startsWith('--'));
  if (args.length < 2) {
    console.error('Usage: pnpm inspect <project> <node-id-or-alias> [--full]');
    process.exit(1);
  }

  const [projectName, alias] = args as [string, string];
  const { project, projectDir } = loadProjectStrict(projectName);
  const state = project.executorState;
  if (!state || !state.nodes) {
    console.error(`Project has no executor state yet. Try \`pnpm run-to ${projectName}\` first.`);
    process.exit(1);
  }

  const nodeId = resolveNodeId(state, alias);
  if (!nodeId) {
    console.error(`No matching node for alias: "${alias}"`);
    console.error(`Try \`pnpm nodes ${projectName}\` to see all nodes.`);
    process.exit(1);
  }
  const node = state.nodes[nodeId]!;

  console.log(`Node: ${node.id}`);
  console.log(`  Type:        ${node.typeId}`);
  console.log(`  Item:        ${node.itemId ?? '(none)'}`);
  console.log(`  Display:     ${node.displayName ?? '(none)'}`);
  console.log(`  Status:      ${node.status}`);
  if (node.outputPath) console.log(`  Output:      ${node.outputPath}`);
  if (node.error) console.log(`  Error:       ${node.error}`);
  if (node.startedAt) console.log(`  Started:     ${new Date(node.startedAt).toISOString()}`);
  if (node.completedAt) console.log(`  Completed:   ${new Date(node.completedAt).toISOString()}`);

  if (node.dependencies && node.dependencies.length > 0) {
    console.log(`  Dependencies (${node.dependencies.length}):`);
    for (const dep of node.dependencies) {
      const depNode = state.nodes[dep];
      const status = depNode ? depNode.status : 'MISSING';
      console.log(`    ${status === 'completed' ? '✓' : status === 'failed' ? '✗' : '·'} ${dep} (${status})`);
    }
  }
  console.log('');

  if (!node.outputPath) {
    console.log('(no outputPath — nothing to read)');
    return;
  }
  const outFile = join(projectDir, node.outputPath);
  if (!existsSync(outFile)) {
    console.log(`(outputPath does not exist on disk: ${outFile})`);
    return;
  }

  const stat = statSync(outFile);
  const ext = extname(outFile).toLowerCase();
  const isBinary = ['.png', '.jpg', '.jpeg', '.mp4', '.mov', '.webm', '.gif'].includes(ext);

  if (isBinary) {
    console.log(`Binary file: ${node.outputPath} (${formatBytes(stat.size)})`);
    return;
  }

  console.log(`---- ${node.outputPath} (${formatBytes(stat.size)}) ----`);
  const text = readFileSync(outFile, 'utf-8');
  if (full || text.length <= 5000) {
    console.log(text);
  } else {
    console.log(text.slice(0, 5000));
    console.log(`\n... [${text.length - 5000} more characters; pass --full to see all]`);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

main();

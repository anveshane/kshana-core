#!/usr/bin/env tsx
/**
 * Inject user-supplied content for a node, marking it completed.
 *
 * Usage:
 *   pnpm override <project> <node-id-or-alias> --from <file>
 *   pnpm override <project> <node-id-or-alias> --content "<inline string>"
 *
 * Examples:
 *   pnpm override myproj scene_2.svp --from my_scene_2.json
 *   pnpm override myproj character:elara --from elara.md
 *   pnpm override myproj scene_2_shot_3.prompt --from custom_prompt.json
 *
 * Behavior:
 *   - Writes the provided content to the node's outputPath (or to a
 *     reasonable default path derived from the node's typeId+itemId).
 *   - Marks the node as 'completed' in executorState so the next
 *     `run-to` doesn't regenerate it.
 *   - Overrides are NOT sticky: a future `pnpm reset <stage>` clears
 *     this just like an LLM-generated artifact would (per user's
 *     2026-04-27 directive — resets may legitimately want to push the
 *     story in a different direction, so user overrides shouldn't
 *     resist that).
 *
 * Limitations:
 *   - The downstream consumers MUST be re-run for your override to take
 *     effect. After `pnpm set`, follow up with `pnpm regen <project>
 *     <node-id> --cascade` (which marks downstream nodes as pending and
 *     runs the pipeline). The set command alone leaves downstream
 *     'completed' state intact.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { loadProjectStrict, resolveNodeId, type ExecutionNode } from './cli-helpers.js';

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2 || argv[0] === '--help' || argv[0] === '-h') {
    console.error('Usage: pnpm override <project> <node-id-or-alias> (--from <file> | --content <str>)');
    process.exit(argv[0] === '--help' || argv[0] === '-h' ? 0 : 1);
  }
  const positional: string[] = [];
  let fromFile: string | undefined;
  let inlineContent: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--from') fromFile = argv[++i];
    else if (a === '--content') inlineContent = argv[++i];
    else if (!a.startsWith('--')) positional.push(a);
  }
  const [projectName, alias] = positional as [string, string];

  if (!fromFile && inlineContent === undefined) {
    console.error('Error: must pass either --from <file> or --content <str>');
    process.exit(1);
  }
  if (fromFile && inlineContent !== undefined) {
    console.error('Error: pass only one of --from or --content, not both');
    process.exit(1);
  }

  const content = fromFile ? readFileSync(fromFile, 'utf-8') : inlineContent!;

  const { project, projectDir } = loadProjectStrict(projectName);
  const state = project.executorState;
  if (!state || !state.nodes) {
    console.error(`No executor state. Run \`pnpm run-to ${projectName}\` at least once first ` +
      'so the node graph exists. (You can stop early — even just `pnpm run-to <project> story` works.)');
    process.exit(1);
  }

  const nodeId = resolveNodeId(state, alias);
  if (!nodeId) {
    console.error(`No matching node for alias: "${alias}"`);
    process.exit(1);
  }
  const node = state.nodes[nodeId] as ExecutionNode;

  // Pick the output file path. If the node already has an outputPath,
  // reuse it. Otherwise derive a sensible one from typeId+itemId.
  let outputPath = node.outputPath;
  if (!outputPath) {
    outputPath = deriveDefaultOutputPath(node);
  }
  const fullOutPath = join(projectDir, outputPath);
  mkdirSync(dirname(fullOutPath), { recursive: true });
  writeFileSync(fullOutPath, content);

  // Update node state.
  node.status = 'completed';
  node.outputPath = outputPath;
  node.completedAt = Date.now();
  delete node.error;

  // Persist.
  const projectJsonPath = join(projectDir, 'project.json');
  const raw = readFileSync(projectJsonPath, 'utf-8');
  const obj = JSON.parse(raw) as Record<string, unknown>;
  (obj['executorState'] as { nodes: Record<string, ExecutionNode> }).nodes = state.nodes;
  writeFileSync(projectJsonPath, JSON.stringify(obj, null, 2));

  console.log(`Set ${nodeId}:`);
  console.log(`  ${content.length} bytes → ${outputPath}`);
  console.log(`  status: ${node.status}`);
  console.log('');
  console.log(`Note: downstream nodes are NOT auto-reset. To propagate this override:`);
  console.log(`  pnpm regen ${projectName} ${alias} --cascade`);
}

function deriveDefaultOutputPath(node: ExecutionNode): string {
  // Best-effort path inference for nodes that don't yet have an outputPath.
  // Mirrors common conventions used elsewhere in the codebase.
  const item = node.itemId ?? 'default';
  switch (node.typeId) {
    case 'character':         return `characters/${item}.md`;
    case 'setting':           return `settings/${item}.md`;
    case 'scene':             return `chapters/chapter_1/scenes/${item}.md`;
    case 'scene_video_prompt':return `prompts/videos/scenes/${item}.json`;
    case 'shot_image_prompt': return `prompts/images/shots/${item.replace(/scene_(\d+)_shot_(\d+)/, 'scene-$1-shot-$2')}.json`;
    case 'shot_motion_directive': return `prompts/motion/${item}.json`;
    case 'plot':              return 'chapters/chapter_1/plans/plot.md';
    case 'story':             return 'chapters/chapter_1/plans/story.md';
    case 'world_style':       return 'plans/world_style.md';
    default:                  return `overrides/${node.id.replace(/[:]/g, '_')}.txt`;
  }
}

main();

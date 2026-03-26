#!/usr/bin/env tsx
/**
 * Reset a project's executor state to a specific stage.
 *
 * Usage:
 *   pnpm tsx scripts/reset-project.ts <project-name> <stage>
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
 * What it does:
 *   1. Resets target stage nodes and ALL downstream nodes to 'pending'
 *   2. Removes expanded per-item nodes below the reset point (they'll be re-expanded)
 *   3. Recreates collection-level placeholder nodes where needed
 *   4. Deletes output files for reset nodes
 *   5. Cleans up orphaned dependency references
 *
 * Examples:
 *   pnpm tsx scripts/reset-project.ts air_already_thick_promise scene_video_prompt
 *   pnpm tsx scripts/reset-project.ts my_project shot_image_prompt
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';

// Pipeline stages in order — each stage includes the types that get reset
const STAGES: Record<string, string[]> = {
  plot: ['plot', 'story', 'character', 'setting', 'scene', 'character_image', 'setting_image', 'scene_video_prompt', 'shot_image_prompt', 'shot_image', 'shot_video', 'final_video'],
  story: ['story', 'character', 'setting', 'scene', 'character_image', 'setting_image', 'scene_video_prompt', 'shot_image_prompt', 'shot_image', 'shot_video', 'final_video'],
  characters: ['character', 'setting', 'scene', 'character_image', 'setting_image', 'scene_video_prompt', 'shot_image_prompt', 'shot_image', 'shot_video', 'final_video'],
  character_image: ['character_image', 'setting_image', 'scene_video_prompt', 'shot_image_prompt', 'shot_image', 'shot_video', 'final_video'],
  scene_video_prompt: ['scene_video_prompt', 'shot_image_prompt', 'shot_image', 'shot_video', 'final_video'],
  shot_image_prompt: ['shot_image_prompt', 'shot_image', 'shot_video', 'final_video'],
  shot_image: ['shot_image', 'shot_video', 'final_video'],
  shot_video: ['shot_video', 'final_video'],
  final_video: ['final_video'],
};

// Template dependency map: typeId → required dependency typeIds
// Used to rewire nodes when recreating collection placeholders
const TEMPLATE_DEPS: Record<string, string[]> = {
  plot: [],
  story: ['plot'],
  character: ['story'],
  setting: ['story'],
  scene: ['story', 'character', 'setting'],
  character_image: ['character'],
  setting_image: ['setting'],
  scene_video_prompt: ['scene', 'character_image', 'setting_image'],
  shot_image_prompt: ['scene_video_prompt'],
  shot_image: ['shot_image_prompt', 'character_image', 'setting_image'],
  shot_video: ['shot_image'],
  final_video: ['shot_video'],
};

// Types that are collections and get expanded into per-item nodes
const COLLECTION_TYPES = new Set([
  'character', 'setting', 'scene',
  'character_image', 'setting_image',
  'scene_video_prompt', 'shot_image_prompt', 'shot_image', 'shot_video',
]);

interface ExecutionNode {
  id: string;
  typeId: string;
  itemId?: string;
  status: string;
  displayName: string;
  isExpensive: boolean;
  isCollection: boolean;
  dependencies: string[];
  dependents: string[];
  error?: string;
  completedAt?: number;
  startedAt?: number;
  outputPath?: string;
  artifactId?: string;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: pnpm tsx scripts/reset-project.ts <project-name> <stage>');
    console.error('');
    console.error('Stages:', Object.keys(STAGES).join(', '));
    process.exit(1);
  }

  const [projectName, stage] = args;
  const resetTypes = STAGES[stage!];
  if (!resetTypes) {
    console.error(`Unknown stage: ${stage}`);
    console.error('Valid stages:', Object.keys(STAGES).join(', '));
    process.exit(1);
  }

  const projectDir = join(process.cwd(), `${projectName}.kshana`);
  const projectPath = join(projectDir, 'project.json');

  if (!existsSync(projectPath)) {
    console.error(`Project not found: ${projectPath}`);
    process.exit(1);
  }

  const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
  const nodes: Record<string, ExecutionNode> = project.executorState?.nodes ?? {};

  if (Object.keys(nodes).length === 0) {
    console.error('No executor state found in project');
    process.exit(1);
  }

  const resetTypeSet = new Set(resetTypes);
  let resetCount = 0;
  let removedCount = 0;
  let filesDeleted = 0;

  // Phase 1: Identify nodes to reset vs remove
  // - Type-level collection nodes that match reset types → reset to pending + mark as collection
  // - Per-item nodes whose typeId matches reset types → remove entirely
  // - Non-collection nodes that match reset types → reset to pending
  const nodesToRemove: string[] = [];
  const nodesToReset: string[] = [];

  for (const [nid, node] of Object.entries(nodes)) {
    if (!resetTypeSet.has(node.typeId)) continue;

    const isPerItem = node.itemId !== undefined;
    if (isPerItem) {
      // Per-item expanded node — remove it (will be re-expanded)
      nodesToRemove.push(nid);
    } else {
      // Type-level or non-collection node — reset to pending
      nodesToReset.push(nid);
    }
  }

  // Phase 2: Delete output files for all affected nodes
  for (const nid of [...nodesToReset, ...nodesToRemove]) {
    const node = nodes[nid]!;
    if (node.outputPath) {
      const fullPath = join(projectDir, node.outputPath);
      if (existsSync(fullPath)) {
        unlinkSync(fullPath);
        filesDeleted++;
        console.log(`  Deleted: ${node.outputPath}`);
      }
    }
  }

  // Phase 3: Remove per-item nodes and clean up references
  for (const nid of nodesToRemove) {
    // Remove this node from other nodes' dependencies/dependents arrays
    for (const otherNode of Object.values(nodes)) {
      otherNode.dependencies = otherNode.dependencies.filter(d => d !== nid);
      otherNode.dependents = otherNode.dependents.filter(d => d !== nid);
    }
    delete nodes[nid];
    removedCount++;
  }

  // Phase 4: Reset type-level nodes to pending
  for (const nid of nodesToReset) {
    const node = nodes[nid]!;
    node.status = 'pending';
    node.outputPath = undefined;
    node.startedAt = undefined;
    node.completedAt = undefined;
    node.error = undefined;
    node.artifactId = undefined;

    // If this is a collection type, ensure isCollection is true
    // (so the executor knows to expand it when its dependencies complete)
    if (COLLECTION_TYPES.has(node.typeId)) {
      node.isCollection = true;
    }
    resetCount++;
  }

  // Phase 5: Recreate missing type-level collection nodes
  // If a type-level node was removed (because it was expanded and then deleted),
  // we need to recreate it as a pending collection placeholder
  for (const typeId of resetTypes) {
    if (!COLLECTION_TYPES.has(typeId)) continue;

    // Check if a type-level node exists (no itemId)
    const exists = Object.values(nodes).some(n => n.typeId === typeId && !n.itemId);
    if (exists) continue;

    console.log(`  Recreating collection node: ${typeId}`);

    // Build dependencies from the template definition
    // Map each template dependency to the actual node ID in the graph
    const typeDeps = TEMPLATE_DEPS[typeId] ?? [];
    const wireDeps: string[] = [];
    for (const dep of typeDeps) {
      // If the dependency type has expanded per-item nodes, depend on the type-level node
      // (which may also be pending/recreated). If it has no per-item nodes, use it directly.
      if (nodes[dep]) {
        wireDeps.push(dep);
      }
      // Also check for expanded per-item nodes of this dependency type
      const perItemNodes = Object.values(nodes).filter(
        n => n.typeId === dep && n.itemId && n.status === 'completed'
      );
      for (const pin of perItemNodes) {
        if (!wireDeps.includes(pin.id)) {
          wireDeps.push(pin.id);
        }
      }
    }

    const newNode: ExecutionNode = {
      id: typeId,
      typeId: typeId,
      status: 'pending',
      displayName: typeId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      isExpensive: false,
      isCollection: true,
      dependencies: wireDeps,
      dependents: [],
    };
    nodes[typeId] = newNode;

    // Wire dependents: any existing node that should depend on this type
    for (const [otherType, otherDeps] of Object.entries(TEMPLATE_DEPS)) {
      if (otherDeps.includes(typeId) && nodes[otherType]) {
        if (!nodes[otherType]!.dependencies.includes(typeId)) {
          nodes[otherType]!.dependencies.push(typeId);
        }
        if (!newNode.dependents.includes(otherType)) {
          newNode.dependents.push(otherType);
        }
      }
    }

    // Also wire to dependents' per-item nodes
    for (const otherNode of Object.values(nodes)) {
      if (otherNode.id === typeId) continue;
      const otherTemplateDeps = TEMPLATE_DEPS[otherNode.typeId] ?? [];
      if (otherTemplateDeps.includes(typeId)) {
        if (!otherNode.dependencies.includes(typeId)) {
          otherNode.dependencies.push(typeId);
        }
        if (!newNode.dependents.includes(otherNode.id)) {
          newNode.dependents.push(otherNode.id);
        }
      }
    }

    resetCount++;
  }

  // Phase 6: Clean up output directories for shot-related files
  const cleanDirs: Array<{ dir: string; extensions: string[] }> = [];
  if (resetTypeSet.has('scene_video_prompt')) {
    cleanDirs.push({ dir: join(projectDir, 'prompts', 'videos', 'scenes'), extensions: ['.json'] });
  }
  if (resetTypeSet.has('shot_image_prompt')) {
    cleanDirs.push({ dir: join(projectDir, 'prompts', 'images', 'shots'), extensions: ['.json'] });
  }

  for (const { dir, extensions } of cleanDirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (extensions.some(ext => f.endsWith(ext))) {
        unlinkSync(join(dir, f));
        filesDeleted++;
        console.log(`  Cleaned: ${dir}/${f}`);
      }
    }
  }

  // Phase 7: Clean up stale references — remove deps/dependents pointing to non-existent nodes
  const nodeIds = new Set(Object.keys(nodes));
  for (const node of Object.values(nodes)) {
    node.dependencies = [...new Set(node.dependencies.filter(d => nodeIds.has(d)))];
    node.dependents = [...new Set(node.dependents.filter(d => nodeIds.has(d)))];
  }

  // Phase 8: Clear completedAt on the executor state
  if (project.executorState) {
    project.executorState.completedAt = undefined;
    project.executorState.updatedAt = Date.now();
  }

  // Save
  writeFileSync(projectPath, JSON.stringify(project, null, 2));

  // Summary
  const remaining = Object.values(nodes);
  const completed = remaining.filter(n => n.status === 'completed').length;
  const pending = remaining.filter(n => n.status === 'pending').length;

  console.log('');
  console.log(`Reset to stage: ${stage}`);
  console.log(`  Nodes reset to pending: ${resetCount}`);
  console.log(`  Per-item nodes removed: ${removedCount}`);
  console.log(`  Output files deleted: ${filesDeleted}`);
  console.log(`  Final state: ${completed} completed, ${pending} pending, ${remaining.length} total`);
}

main();

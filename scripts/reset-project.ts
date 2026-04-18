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
 *   4. Disconnects output files (clears outputPath) but preserves files on disk
 *   5. Cleans up orphaned dependency references
 *
 * Examples:
 *   pnpm tsx scripts/reset-project.ts air_already_thick_promise scene_video_prompt
 *   pnpm tsx scripts/reset-project.ts my_project shot_image_prompt
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Compute the full set of types to reset by traversing the dependency graph downstream.
 * Given a starting type, finds all types that directly or transitively depend on it.
 */
function computeResetTypes(startType: string): string[] {
  // Build inverse graph: type → types that depend on it (dependents)
  const dependents: Record<string, string[]> = {};
  for (const [type, deps] of Object.entries(TEMPLATE_DEPS)) {
    for (const dep of deps) {
      if (!dependents[dep]) dependents[dep] = [];
      dependents[dep]!.push(type);
    }
  }

  // BFS from startType to find all downstream types
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

// Stage aliases for user convenience
// Values can be a single type or multiple (for sibling resets)
const STAGE_ALIASES: Record<string, string | string[]> = {
  plot: 'plot',
  story: 'story',
  characters: ['character', 'setting'],     // resets both character + setting (siblings)
  character: 'character',
  setting: 'setting',
  scene: 'scene',
  world_style: 'world_style',
  character_image: ['character_image', 'setting_image', 'object_image'],  // reset all reference-image siblings
  reference_images: ['character_image', 'setting_image', 'object_image'],  // explicit alias for all three
  setting_image: 'setting_image',
  scene_video_prompt: 'scene_video_prompt',
  shot_image_prompt: 'shot_image_prompt',
  shot_motion_directive: 'shot_motion_directive',
  shot_image: 'shot_image',
  shot_video: 'shot_video',
  final_video: 'final_video',
};

// Template dependency map: typeId → required dependency typeIds
// Used to rewire nodes when recreating collection placeholders
const TEMPLATE_DEPS: Record<string, string[]> = {
  plot: [],
  story: ['plot'],
  character: ['story'],
  setting: ['story'],
  scene: ['story', 'character', 'setting'],
  world_style: ['story', 'scene', 'setting'],
  object: ['story'],
  character_image: ['character', 'world_style'],
  setting_image: ['setting', 'world_style'],
  object_image: ['object', 'world_style'],
  scene_video_prompt: ['scene', 'world_style'],
  shot_image_prompt: ['scene_video_prompt'],
  shot_motion_directive: ['scene_video_prompt', 'shot_image_prompt', 'world_style'],
  shot_image: ['shot_image_prompt', 'character_image', 'setting_image', 'object_image'],
  shot_video: ['shot_image', 'shot_motion_directive'],
  final_video: ['shot_video'],
};

// Types that are collections and get expanded into per-item nodes
const COLLECTION_TYPES = new Set([
  'character', 'setting', 'object', 'scene',
  'character_image', 'setting_image', 'object_image',
  'scene_video_prompt', 'shot_image_prompt', 'shot_motion_directive', 'shot_image', 'shot_video',
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

// Export for testing
export { computeResetTypes, TEMPLATE_DEPS, STAGE_ALIASES };

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: pnpm tsx scripts/reset-project.ts <project-name> <stage>');
    console.error('');
    console.error('Stages:', Object.keys(STAGE_ALIASES).join(', '));
    process.exit(1);
  }

  const [projectName, stage] = args;
  const aliasValue = STAGE_ALIASES[stage!];
  if (!aliasValue) {
    console.error(`Unknown stage: ${stage}`);
    console.error('Valid stages:', Object.keys(STAGE_ALIASES).join(', '));
    process.exit(1);
  }

  // Resolve alias — can be a single type or array of sibling types
  const startTypes = Array.isArray(aliasValue) ? aliasValue : [aliasValue];
  const resetTypes = [...new Set(startTypes.flatMap(t => computeResetTypes(t)))];

  console.log(`Reset types (from ${stage} → ${startTypes.join(', ')}): ${resetTypes.join(', ')}`);

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
  // filesDeleted removed — reset no longer deletes files

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

  // Phase 2: Disconnect output files — clear outputPath but leave files on disk.
  // Generated artifacts are preserved so the user can reference, compare, or reuse them.
  for (const nid of [...nodesToReset, ...nodesToRemove]) {
    const node = nodes[nid]!;
    if (node.outputPath) {
      console.log(`  Disconnected: ${node.outputPath}`);
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

  // Phase 5: Recreate collection nodes — either as per-item nodes (if upstream has items)
  // or as type-level placeholders. Delete any existing type-level node first.
  for (const typeId of resetTypes) {
    if (!COLLECTION_TYPES.has(typeId)) continue;

    // Remove existing type-level node (will be replaced by per-item or fresh placeholder)
    if (nodes[typeId]) {
      delete nodes[typeId];
    }
    // Also remove any existing per-item nodes of this type (already done in Phase 3 but be safe)
    for (const nid of Object.keys(nodes)) {
      if (nodes[nid]!.typeId === typeId) delete nodes[nid];
    }

    const typeDeps = TEMPLATE_DEPS[typeId] ?? [];

    // Only expand into per-item nodes if the PRIMARY matching-scope dependency
    // has completed per-item nodes AND those items are stable (not pending further expansion).
    // Map of which types expand based on which upstream items:
    // Determine which upstream items to match against.
    // For shot_image/shot_video: if upstream has per-shot nodes, use those directly.
    // Otherwise fall back to per-scene.
    const MATCHING_SOURCE: Record<string, string[]> = {
      'scene_video_prompt': ['scene'],
      'character_image': ['character'],
      'setting_image': ['setting'],
      'shot_image_prompt': ['scene'],
      'shot_motion_directive': ['shot_image_prompt', 'scene'],
      'shot_image': ['shot_image_prompt', 'scene'],
      'shot_video': ['shot_image', 'shot_motion_directive', 'shot_image_prompt', 'scene'],
    };

    let matchingItems: Array<{ itemId: string; name: string }> | null = null;
    const sourceTypes = MATCHING_SOURCE[typeId] ?? [];
    for (const sourceType of sourceTypes) {
      const sourceNodes = Object.values(nodes).filter(
        n => n.typeId === sourceType && n.itemId &&
        (n.status === 'completed' || n.status === 'pending')
      );
      if (sourceNodes.length > 0) {
        matchingItems = sourceNodes.map(n => ({
          itemId: n.itemId!,
          name: n.displayName.split(': ').pop() ?? n.itemId!,
        }));
        break; // use the first source that has items
      }
    }

    if (matchingItems && matchingItems.length > 0) {
      // Create per-item nodes matching the upstream items
      console.log(`  Recreating ${matchingItems.length} per-item nodes for: ${typeId}`);
      for (const item of matchingItems) {
        const itemNodeId = `${typeId}:${item.itemId}`;
        const displayName = `${typeId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}: ${item.name}`;

        // Build dependencies: matching-scope deps get the matching item, all-scope deps get all items
        const wireDeps: string[] = [];
        for (const depType of typeDeps) {
          const matchingNode = nodes[`${depType}:${item.itemId}`];
          if (matchingNode) {
            wireDeps.push(matchingNode.id);
          } else {
            // Try all-scope: add all per-item nodes of this dep type
            const allNodes = Object.values(nodes).filter(n => n.typeId === depType && n.itemId);
            for (const n of allNodes) {
              if (!wireDeps.includes(n.id)) wireDeps.push(n.id);
            }
            // Or the type-level node
            if (allNodes.length === 0 && nodes[depType]) {
              wireDeps.push(depType);
            }
          }
        }

        const newNode: ExecutionNode = {
          id: itemNodeId,
          typeId: typeId,
          itemId: item.itemId,
          status: 'pending',
          displayName: displayName,
          isExpensive: false,
          // Per-scene collection nodes can expand further to per-shot at runtime
          // Per-shot nodes (itemId contains 'shot_') are leaf nodes
          isCollection: ['scene_video_prompt', 'shot_image_prompt', 'shot_image', 'shot_video'].includes(typeId)
            && !item.itemId.includes('shot_'),
          dependencies: wireDeps,
          dependents: [],
        };
        nodes[itemNodeId] = newNode;

        // Wire upstream dependents
        for (const depId of wireDeps) {
          if (nodes[depId] && !nodes[depId]!.dependents.includes(itemNodeId)) {
            nodes[depId]!.dependents.push(itemNodeId);
          }
        }

        resetCount++;
      }
    } else {
      // No matching upstream items — create a type-level placeholder
      console.log(`  Recreating collection node: ${typeId}`);
      const wireDeps: string[] = [];
      for (const depType of typeDeps) {
        if (nodes[depType]) wireDeps.push(depType);
        const perItemNodes = Object.values(nodes).filter(
          n => n.typeId === depType && n.itemId
        );
        for (const pin of perItemNodes) {
          if (!wireDeps.includes(pin.id)) wireDeps.push(pin.id);
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
      resetCount++;
    }

    // Wire downstream dependents for all new nodes of this type
    const newNodesOfType = Object.values(nodes).filter(n => n.typeId === typeId);
    for (const newNode of newNodesOfType) {
      for (const otherNode of Object.values(nodes)) {
        if (otherNode.id === newNode.id) continue;
        const otherDeps = TEMPLATE_DEPS[otherNode.typeId] ?? [];
        if (otherDeps.includes(typeId)) {
          if (!otherNode.dependencies.includes(newNode.id)) {
            otherNode.dependencies.push(newNode.id);
          }
          if (!newNode.dependents.includes(otherNode.id)) {
            newNode.dependents.push(otherNode.id);
          }
        }
      }
    }
  }

  // Phase 6: Clean up output directories and intermediate files for reset types
  // Maps artifact types to directories that should be cleaned
  const TYPE_DIRS: Record<string, Array<{ dir: string; extensions: string[] }>> = {
    character_image: [
      { dir: join(projectDir, 'prompts', 'images', 'characters'), extensions: ['.json'] },
    ],
    setting_image: [
      { dir: join(projectDir, 'prompts', 'images', 'settings'), extensions: ['.json'] },
    ],
    scene_video_prompt: [
      { dir: join(projectDir, 'prompts', 'videos', 'scenes'), extensions: ['.json'] },
    ],
    shot_image_prompt: [
      { dir: join(projectDir, 'prompts', 'images', 'shots'), extensions: ['.json'] },
    ],
    shot_motion_directive: [
      { dir: join(projectDir, 'prompts', 'motion'), extensions: ['.txt', '.md'] },
    ],
    shot_image: [
      { dir: join(projectDir, 'assets', 'images'), extensions: ['.png', '.jpg', '.jpeg', '.webp'] },
    ],
    shot_video: [
      { dir: join(projectDir, 'assets', 'videos', 'shots'), extensions: ['.mp4', '.webm'] },
    ],
    final_video: [
      { dir: join(projectDir, 'assets', 'videos', 'final'), extensions: ['.mp4', '.webm'] },
    ],
  };

  // Phase 6: File preservation — files are NOT deleted on reset.
  // Generated artifacts (images, videos, prompts) stay on disk so the user can
  // reference, compare, or reuse them. Reset only disconnects them from the
  // project graph (outputPath cleared in Phase 3/4).
  // The TYPE_DIRS map above is kept for reference but not used for deletion.
  console.log(`  Output files preserved (not deleted)`);

  // Phase 7: Clean up stale references — remove deps/dependents pointing to non-existent nodes
  const nodeIds = new Set(Object.keys(nodes));
  for (const node of Object.values(nodes)) {
    node.dependencies = Array.from(new Set(node.dependencies.filter(d => nodeIds.has(d))));
    node.dependents = Array.from(new Set(node.dependents.filter(d => nodeIds.has(d))));
  }

  // Phase 8: Asset manifest is preserved — entries stay since files stay on disk.

  // Phase 9: Clear completedAt and reset phase
  if (project.executorState) {
    project.executorState.completedAt = undefined;
    project.executorState.updatedAt = Date.now();
  }
  project.currentPhase = undefined;

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
  console.log(`  Output files preserved on disk (disconnected from graph)`);
  console.log(`  Final state: ${completed} completed, ${pending} pending, ${remaining.length} total`);
}

// Only run when executed directly (not when imported for testing)
const isDirectExecution = process.argv[1]?.endsWith('reset-project.ts');
if (isDirectExecution) {
  main();
}

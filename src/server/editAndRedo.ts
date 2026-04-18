/**
 * Edit & Redo utilities.
 *
 * Resolves prompt file paths for any node type and saves edited prompts
 * to disk before redo. Works with the executor state stored in project.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface NodeState {
  id: string;
  typeId: string;
  itemId?: string;
  status: string;
  outputPath?: string;
  promptPath?: string;
}

/**
 * Resolve the prompt file path for a given node.
 *
 * - shot_image → reads from shot_image_prompt:{itemId}.outputPath
 * - shot_video → reads from shot_motion_directive:{itemId}.outputPath
 * - character_image → prompts/images/characters/{itemId}.json (or node.promptPath)
 * - setting_image → prompts/images/settings/{itemId}.json (or node.promptPath)
 * - object_image → prompts/images/objects/{itemId}.json (or node.promptPath)
 */
export function resolveNodePromptPath(
  nodeId: string,
  nodes: Record<string, NodeState>,
): string | null {
  const node = nodes[nodeId];
  if (!node) return null;

  const { typeId, itemId } = node;

  if (typeId === 'shot_image') {
    // Find the matching shot_image_prompt node
    const promptNodeId = `shot_image_prompt:${itemId}`;
    const promptNode = nodes[promptNodeId];
    return promptNode?.outputPath ?? null;
  }

  if (typeId === 'shot_image_prompt') {
    // Prompt node itself — its outputPath IS the prompt file
    return node.outputPath ?? null;
  }

  if (typeId === 'shot_video') {
    // Find the matching shot_motion_directive node
    const motionNodeId = `shot_motion_directive:${itemId}`;
    const motionNode = nodes[motionNodeId];
    return motionNode?.outputPath ?? null;
  }

  if (typeId === 'character_image') {
    if (node.promptPath) return node.promptPath;
    return `prompts/images/characters/${itemId}.json`;
  }

  if (typeId === 'setting_image') {
    if (node.promptPath) return node.promptPath;
    return `prompts/images/settings/${itemId}.json`;
  }

  if (typeId === 'object_image') {
    if (node.promptPath) return node.promptPath;
    return `prompts/images/objects/${itemId}.json`;
  }

  return null;
}

/**
 * Strip markdown code fences from JSON content.
 * LLM outputs often wrap JSON in ```json ... ``` fences.
 */
export function stripMarkdownFences(content: string): string {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return cleaned;
}

/**
 * Save an edited prompt to disk, overwriting the original file.
 *
 * Reads project.json to find executor state, resolves the prompt file path,
 * and writes the edited content.
 */
export async function saveEditedPrompt(
  projectDir: string,
  nodeId: string,
  editedPrompt: Record<string, unknown>,
): Promise<void> {
  const projectPath = join(projectDir, 'project.json');
  if (!existsSync(projectPath)) {
    throw new Error(`Project not found: ${projectPath}`);
  }

  const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
  const nodes = project.executorState?.nodes ?? {};

  const promptPath = resolveNodePromptPath(nodeId, nodes);
  if (!promptPath) {
    throw new Error(`Cannot resolve prompt path for node: ${nodeId}`);
  }

  const absPath = join(projectDir, promptPath);

  // Read existing content and merge (preserve fields not in the edit)
  let existing: Record<string, unknown> = {};
  if (existsSync(absPath)) {
    try {
      existing = JSON.parse(readFileSync(absPath, 'utf-8'));
    } catch { /* start fresh */ }
  }

  const merged = { ...existing, ...editedPrompt };
  writeFileSync(absPath, JSON.stringify(merged, null, 2));
}

/**
 * Get all available reference images (completed character/setting/object images).
 * Used to populate the reference picker in the shot image edit modal.
 */
export function getAvailableReferences(
  nodes: Record<string, NodeState>,
  projectName: string,
): Array<{
  nodeId: string;
  type: string;
  name: string;
  thumbnailUrl: string;
}> {
  const refs: Array<{
    nodeId: string;
    type: string;
    name: string;
    thumbnailUrl: string;
  }> = [];

  const refTypes = ['character_image', 'setting_image', 'object_image'];

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (!refTypes.includes(node.typeId)) continue;
    if (node.status !== 'completed') continue;
    if (!node.outputPath) continue;

    const type = node.typeId.replace('_image', ''); // character_image → character
    refs.push({
      nodeId,
      type,
      name: node.itemId ?? nodeId.split(':')[1] ?? nodeId,
      thumbnailUrl: `/api/v1/assets/${projectName}/${node.outputPath}`,
    });
  }

  return refs;
}

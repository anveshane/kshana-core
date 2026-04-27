/**
 * Shared utilities for the project-CLI scripts (`new`, `show`, `list`,
 * `status`, `regen`, `set`).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ExecutorState {
  nodes: Record<string, ExecutionNode>;
  completedAt?: number;
  updatedAt?: number;
}

export interface ExecutionNode {
  id: string;
  typeId: string;
  itemId?: string;
  displayName?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  outputPath?: string;
  dependencies: string[];
  dependents?: string[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ProjectFile {
  version: string;
  id: string;
  title: string;
  originalInputFile?: string;
  style?: string;
  inputType?: string;
  templateId?: string;
  targetDuration?: number;
  currentPhase?: string;
  phases?: Record<string, { status: string; completedAt: number | null }>;
  executorState?: ExecutorState;
  [key: string]: unknown;
}

export function projectDirFor(name: string, basePath: string = process.cwd()): string {
  // Accept either "myproj" or "myproj.kshana"; both resolve to <basePath>/<name>.kshana
  const folder = name.endsWith('.kshana') ? name : `${name}.kshana`;
  return join(basePath, folder);
}

export function loadProjectStrict(name: string, basePath: string = process.cwd()): {
  project: ProjectFile;
  projectDir: string;
} {
  const projectDir = projectDirFor(name, basePath);
  const projectJson = join(projectDir, 'project.json');
  if (!existsSync(projectJson)) {
    console.error(`Project not found: ${projectJson}`);
    console.error(`(Looked for ${name}.kshana folder under ${basePath})`);
    process.exit(1);
  }
  const raw = readFileSync(projectJson, 'utf-8');
  return { project: JSON.parse(raw) as ProjectFile, projectDir };
}

/**
 * Resolve a friendly node alias to a full executor node id.
 *
 * Accepts:
 *   "shot_image_prompt:scene_2_shot_3"   verbatim node id
 *   "shot_2_shot_3.prompt"               friendly: aliases ".prompt" → shot_image_prompt
 *   "scene_2_shot_3.image"               friendly: aliases ".image" → shot_image
 *   "scene_2_shot_3.video"               friendly: aliases ".video" → shot_video
 *   "scene_2_shot_3.motion"              friendly: aliases ".motion" → shot_motion_directive
 *   "scene_2.svp"                        friendly: aliases ".svp" → scene_video_prompt
 *   "scene_2.scene"                      friendly: aliases ".scene" → scene
 *   "scene_2"                            ambiguous; tries scene_video_prompt:scene_2 first
 *   "elara"                              ambiguous; tries character:elara
 *
 * Returns null if no matching node is found.
 */
const FRIENDLY_SUFFIX_TO_TYPE: Record<string, string> = {
  '.prompt': 'shot_image_prompt',
  '.shot_image_prompt': 'shot_image_prompt',
  '.image': 'shot_image',
  '.shot_image': 'shot_image',
  '.video': 'shot_video',
  '.shot_video': 'shot_video',
  '.motion': 'shot_motion_directive',
  '.motion_directive': 'shot_motion_directive',
  '.svp': 'scene_video_prompt',
  '.scene_video_prompt': 'scene_video_prompt',
  '.scene': 'scene',
};

export function resolveNodeId(state: ExecutorState, alias: string): string | null {
  // Verbatim match first.
  if (state.nodes[alias]) return alias;

  // typeId:itemId form already? Try as-is in case caller missed a node.
  if (alias.includes(':')) return null;

  // Friendly-suffix form: "<itemId>.<typeAlias>"
  for (const [suffix, typeId] of Object.entries(FRIENDLY_SUFFIX_TO_TYPE)) {
    if (alias.endsWith(suffix)) {
      const itemId = alias.slice(0, -suffix.length);
      const candidate = `${typeId}:${itemId}`;
      if (state.nodes[candidate]) return candidate;
      return null;
    }
  }

  // Bare itemId — try common per-item types in priority order.
  const fallbackTypes = [
    'character', 'setting', 'object',
    'scene', 'scene_video_prompt',
    'shot_image_prompt', 'shot_motion_directive', 'shot_image', 'shot_video',
  ];
  for (const typeId of fallbackTypes) {
    const candidate = `${typeId}:${alias}`;
    if (state.nodes[candidate]) return candidate;
  }

  return null;
}

/**
 * Find all node ids matching a regex pattern, sorted by typeId then itemId.
 * Useful for `list` and bulk-regen scenarios.
 */
export function matchNodes(state: ExecutorState, pattern: RegExp): ExecutionNode[] {
  const matches = Object.values(state.nodes).filter(n => pattern.test(n.id));
  return matches.sort((a, b) => a.id.localeCompare(b.id));
}

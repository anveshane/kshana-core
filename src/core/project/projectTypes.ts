/**
 * Shared types and helpers for working with a kshana project's
 * `project.json` and its executor graph. Originally defined in
 * `scripts/cli-helpers.ts`; moved under `src/` so server code can
 * import without violating `rootDir`. The CLI helper module
 * re-exports from here so existing pnpm scripts keep working.
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
  const folder = name.endsWith('.kshana') ? name : `${name}.kshana`;
  return join(basePath, folder);
}

/**
 * Resolve a project name (or full folder name) to its directory and
 * the parsed contents of `project.json`. Returns null when the project
 * doesn't exist; callers decide how to surface that (CLI exits, HTTP
 * returns 404).
 */
export function loadProject(name: string, basePath: string = process.cwd()): {
  project: ProjectFile;
  projectDir: string;
} | null {
  const projectDir = projectDirFor(name, basePath);
  const projectJson = join(projectDir, 'project.json');
  if (!existsSync(projectJson)) return null;
  const raw = readFileSync(projectJson, 'utf-8');
  return { project: JSON.parse(raw) as ProjectFile, projectDir };
}

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

/**
 * Resolve a friendly node alias to a full executor node id.
 *
 * Accepts:
 *   "shot_image_prompt:scene_2_shot_3"   verbatim node id
 *   "scene_2_shot_3.prompt"              friendly: aliases ".prompt" → shot_image_prompt
 *   "scene_2_shot_3.image"               friendly: ".image" → shot_image
 *   "scene_2.svp"                        friendly: ".svp" → scene_video_prompt
 *   "elara"                              ambiguous; tries character:elara first
 *
 * Returns null if no matching node is found.
 */
export function resolveNodeId(state: ExecutorState, alias: string): string | null {
  if (state.nodes[alias]) return alias;
  if (alias.includes(':')) return null;

  for (const [suffix, typeId] of Object.entries(FRIENDLY_SUFFIX_TO_TYPE)) {
    if (alias.endsWith(suffix)) {
      const itemId = alias.slice(0, -suffix.length);
      const candidate = `${typeId}:${itemId}`;
      if (state.nodes[candidate]) return candidate;
      return null;
    }
  }

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
 */
export function matchNodes(state: ExecutorState, pattern: RegExp): ExecutionNode[] {
  const matches = Object.values(state.nodes).filter(n => pattern.test(n.id));
  return matches.sort((a, b) => a.id.localeCompare(b.id));
}

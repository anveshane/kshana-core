/**
 * Pi-era fallback for the /api/v1/projects/:name/node-prompt/:nodeId
 * route. Pulls the shot's prompt + motionDirective + frame paths out of
 * project.scenes and shapes them into the response the Edit & Redo
 * modal expects.
 *
 * Returns null when the node id can't be parsed or the scene/shot
 * doesn't exist — the caller surfaces a 404.
 */
import { findShot, type Shot } from "../core/project/projectSchema.js";

export interface SchemaNodePromptResponse {
  nodeId: string;
  nodeType: string;
  prompt: Record<string, unknown>;
  /** Path relative to <project>.kshana/, for shot_video preview. Caller turns this into a URL. */
  firstFramePath?: string;
}

const SHOT_NODE_RE = /^(shot_image_prompt|shot_motion_directive|shot_image|shot_video):scene_(\d+)_shot_(\d+)$/;

export function resolveSchemaNodePrompt(
  project: Record<string, unknown>,
  nodeId: string,
): SchemaNodePromptResponse | null {
  const m = SHOT_NODE_RE.exec(nodeId);
  if (!m) return null;
  const typeId = m[1]!;
  const sceneNum = parseInt(m[2]!, 10);
  const shotNum = parseInt(m[3]!, 10);

  const shot: Shot | undefined = findShot(project, sceneNum, shotNum);
  if (!shot) return null;

  switch (typeId) {
    case "shot_image_prompt":
    case "shot_image":
      return {
        nodeId,
        nodeType: typeId,
        prompt: { imagePrompt: shot.prompt ?? "" },
      };
    case "shot_motion_directive":
      return {
        nodeId,
        nodeType: typeId,
        prompt: { motionDirective: shot.motionDirective ?? "" },
      };
    case "shot_video":
      return {
        nodeId,
        nodeType: typeId,
        prompt: { motionDirective: shot.motionDirective ?? "" },
        ...(shot.firstFrame?.path ? { firstFramePath: shot.firstFrame.path } : {}),
      };
    default:
      return null;
  }
}

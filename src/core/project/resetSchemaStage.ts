/**
 * Phase 4 surgical reset: clears the slots a stage produces (and the
 * downstream cascade) on project.scenes / project.finalVideo, archiving
 * the cleared values to shot.history with reason 'reset'.
 *
 * Cascade: each stage knows which slots downstream depend on it. The
 * map is intrinsic — frames depend on prompts, videos depend on frames
 * and motion directives, finalVideo depends on shot videos. Resetting
 * a stage clears its own slot AND every slot at or below it in this
 * dependency order.
 */
import { clearShotSlots, getScenes, type Shot } from "./projectSchema.js";
import { STAGE_ALIASES } from "../planner/stages.js";

export interface ResetSchemaResult {
  cleared: number;
  shotsAffected: number;
}

type ClearableShotField =
  | "prompt"
  | "motionDirective"
  | "firstFrame"
  | "lastFrame"
  | "midFrame"
  | "video";

/**
 * Per-stage map: which fields on each Shot the stage produces.
 * Cascade is computed below; this is just the direct effect.
 */
const STAGE_SHOT_FIELDS: Record<string, ClearableShotField[]> = {
  shot_image_prompt: ["prompt"],
  shot_motion_directive: ["motionDirective"],
  shot_image: ["firstFrame", "lastFrame", "midFrame"],
  shot_video: ["video"],
};

/**
 * Stage → "also clears finalVideo" flag. Anything that produces or
 * invalidates a shot's contributing media also invalidates the
 * assembled final video.
 */
const STAGE_CASCADES_FINAL_VIDEO: Record<string, boolean> = {
  scene_video_prompt: true,
  shot_image_prompt: true,
  shot_motion_directive: true,
  shot_image: true,
  shot_video: true,
  final_video: true,
};

/**
 * Cascade order: resetting stage X also clears every stage that
 * depends on X. The order is downstream-first since clearShotSlots
 * is independent per slot.
 */
const STAGE_CASCADE: Record<string, string[]> = {
  // upstream → all downstream stages whose slots are now stale
  scene_video_prompt: ["shot_image_prompt", "shot_motion_directive", "shot_image", "shot_video"],
  shot_image_prompt: ["shot_image", "shot_video"],
  shot_motion_directive: ["shot_video"],
  shot_image: ["shot_video"],
  shot_video: [],
  final_video: [],
};

type ProjectLike = Record<string, unknown>;

export function resetSchemaStage(project: ProjectLike, stage: string): ResetSchemaResult | null {
  if (!STAGE_ALIASES[stage]) return null;

  const stages = new Set<string>();
  stages.add(stage);
  for (const downstream of STAGE_CASCADE[stage] ?? []) stages.add(downstream);

  const fields = new Set<ClearableShotField>();
  for (const s of stages) {
    for (const f of STAGE_SHOT_FIELDS[s] ?? []) fields.add(f);
  }

  let cleared = 0;
  const shotsAffected = new Set<Shot>();
  if (fields.size > 0) {
    const fieldList = [...fields];
    for (const scene of getScenes(project)) {
      for (const shot of scene.shots) {
        const before = countDefined(shot, fieldList);
        if (clearShotSlots(shot, fieldList)) {
          shotsAffected.add(shot);
        }
        cleared += before;
      }
    }
  }

  const finalCascade = [...stages].some((s) => STAGE_CASCADES_FINAL_VIDEO[s]);
  if (finalCascade && project["finalVideo"] !== undefined) {
    delete project["finalVideo"];
    cleared += 1;
  }

  return { cleared, shotsAffected: shotsAffected.size };
}

function countDefined(shot: Shot, fields: ClearableShotField[]): number {
  let n = 0;
  for (const f of fields) if (shot[f] !== undefined) n += 1;
  return n;
}

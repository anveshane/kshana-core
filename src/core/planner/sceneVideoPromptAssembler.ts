/**
 * Pure assembler for the hierarchical scene_video_prompt flow.
 *
 *   Stage A (LLM, scene_shot_plan node) → shot plan JSON
 *   Stage B (LLM, shot_breakdown nodes, one per shot, parallel) → per-shot JSONs
 *   Stage C (this module, deterministic) → assembled sceneVideoPromptSchema
 *
 * The output of `assembleSceneVideoPrompt` is byte-shape-identical to the
 * legacy single-call scene_video_prompt LLM output, so downstream consumers
 * (shot_image_prompt builder, shot_motion_directive, ProjectManager,
 *  SceneBreakdownCard) are untouched.
 *
 * Pure — no LLM, no I/O.
 */

import { z } from 'zod';
import {
  shotPlanSchema,
  singleShotSchema,
  sceneVideoPromptSchema,
} from './schemas.js';
import { computeAnchorsForScene } from './shotAnchorComputer.js';

export type ShotPlan = z.infer<typeof shotPlanSchema>;
export type SingleShot = z.infer<typeof singleShotSchema>;
export type AssembledSceneVideoPrompt = z.infer<typeof sceneVideoPromptSchema>;

/**
 * Assemble a Stage A plan + N Stage B per-shot outputs into the existing
 * sceneVideoPromptSchema shape. Throws on contract violations the executor
 * needs to know about (missing shots, mismatched numbers, schema-fail).
 *
 * Sorts shots by `shotNumber` ascending — Stage B nodes run in parallel
 * and their output ordering on disk is not guaranteed.
 */
export function assembleSceneVideoPrompt(
  plan: ShotPlan,
  shots: SingleShot[],
): AssembledSceneVideoPrompt {
  if (!Array.isArray(shots) || shots.length === 0) {
    throw new Error('assembleSceneVideoPrompt: shots array is empty');
  }

  // Cross-check: every plan entry has a matching shot, and vice versa.
  const planNumbers = new Set(plan.shotPlan.map(p => p.shotNumber));
  const shotNumbers = new Set(shots.map(s => s.shotNumber));

  for (const planNum of planNumbers) {
    if (!shotNumbers.has(planNum)) {
      throw new Error(
        `assembleSceneVideoPrompt: plan lists shotNumber ${planNum} but no matching shot output was provided`,
      );
    }
  }
  for (const shotNum of shotNumbers) {
    if (!planNumbers.has(shotNum)) {
      throw new Error(
        `assembleSceneVideoPrompt: shot output has shotNumber ${shotNum} but the plan does not list it`,
      );
    }
  }

  // Sort by shotNumber so the assembled JSON has a stable order regardless
  // of the parallel Stage B completion order.
  const sortedShots = [...shots].sort((a, b) => a.shotNumber - b.shotNumber);

  // Compute first-frame visual-continuity anchors. The assembler is the
  // right place for this: it sees the full scene-level context (sorted
  // shot list + main/secondary subjects) and is deterministic — no LLM
  // call, just rules over the breakdown metadata. Each shot's anchor
  // tells the shot_image generator downstream WHICH prior frame to
  // edit (continuity / view_reuse) or whether to start fresh.
  const anchors = computeAnchorsForScene(
    sortedShots,
    plan.mainSubject,
    plan.secondarySubject ?? null,
  );
  const anchorByShot = new Map(anchors.map(a => [a.shotNumber, a.anchor]));
  for (const shot of sortedShots) {
    const a = anchorByShot.get(shot.shotNumber);
    if (a) shot.firstFrameAnchor = a;
  }

  const assembled: AssembledSceneVideoPrompt = {
    sceneNumber: plan.sceneNumber,
    sceneTitle: plan.sceneTitle,
    totalDuration: plan.totalDuration,
    mainSubject: plan.mainSubject,
    ...(plan.secondarySubject !== undefined && plan.secondarySubject !== null
      ? { secondarySubject: plan.secondarySubject }
      : {}),
    ...(plan.entry ? { entry: plan.entry } : {}),
    ...(plan.exit ? { exit: plan.exit } : {}),
    shots: sortedShots,
  };

  // Final guard: the assembled object MUST satisfy sceneVideoPromptSchema.
  // If it doesn't, that's an upstream contract bug (a shot_breakdown node
  // produced something the scene-level refinements reject — e.g., a shot
  // with main_subject perspective when the plan's mainSubject is missing).
  // Surface it as a clear error rather than letting downstream consumers
  // see malformed JSON.
  const result = sceneVideoPromptSchema.safeParse(assembled);
  if (!result.success) {
    const errors = result.error.issues.map(i => {
      const path = i.path.join('.');
      return path ? `${path}: ${i.message}` : i.message;
    });
    throw new Error(
      `assembleSceneVideoPrompt: assembled output failed sceneVideoPromptSchema validation: ${errors.join('; ')}`,
    );
  }
  return result.data as AssembledSceneVideoPrompt;
}

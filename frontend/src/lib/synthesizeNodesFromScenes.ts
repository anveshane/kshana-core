/**
 * Phase 3 of the project.json refactor: when project.json carries a
 * scenes/shots tree directly, the frontend bypasses the manifest+executor
 * synthesis entirely and reads the canonical shape.
 *
 * Mirrors the public ExecutorNodeInfo shape so the existing Storyboard
 * (which reads from store.nodes) keeps working unchanged.
 */
import type { ExecutorNodeInfo } from "./store";

export interface FrameRefLike {
  path: string;
  createdAt?: number;
}

export interface ShotLike {
  shotNumber: number;
  firstFrame?: FrameRefLike;
  lastFrame?: FrameRefLike;
  midFrame?: FrameRefLike;
  video?: FrameRefLike;
}

export interface SceneLike {
  sceneNumber: number;
  shots: ShotLike[];
}

export function synthesizeNodesFromScenes(
  scenes: SceneLike[] | undefined,
): Record<string, ExecutorNodeInfo> {
  const out: Record<string, ExecutorNodeInfo> = {};
  if (!scenes) return out;

  for (const scene of scenes) {
    for (const shot of scene.shots) {
      const itemId = `scene_${scene.sceneNumber}_shot_${shot.shotNumber}`;
      const outputPaths: Record<string, string> = {};
      if (shot.firstFrame) outputPaths.first_frame = shot.firstFrame.path;
      if (shot.lastFrame) outputPaths.last_frame = shot.lastFrame.path;
      if (shot.midFrame) outputPaths.mid_frame = shot.midFrame.path;

      if (Object.keys(outputPaths).length > 0) {
        out[`shot_image:${itemId}`] = {
          id: `shot_image:${itemId}`,
          typeId: "shot_image",
          itemId,
          displayName: `Scene ${scene.sceneNumber} · Shot ${shot.shotNumber} image`,
          status: "completed",
          outputPaths,
        };
      }
      if (shot.video) {
        out[`shot_video:${itemId}`] = {
          id: `shot_video:${itemId}`,
          typeId: "shot_video",
          itemId,
          displayName: `Scene ${scene.sceneNumber} · Shot ${shot.shotNumber} video`,
          status: "completed",
          outputPath: shot.video.path,
        };
      }
    }
  }
  return out;
}

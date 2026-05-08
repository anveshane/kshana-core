/**
 * Pure invalidation op for `kshana_invalidate`.
 *
 * Given a list of node ids (typically from `selectInvalidationIds`),
 * mutate `project.executorState`:
 *   - Mark each node pending; clear outputPath / promptPath /
 *     completedAt / startedAt / artifactId / error.
 *   - Set `executorState.lastInvalidatedIds` to the list, so
 *     `kshana_run_to scope='last_invalidated'` can read it later.
 *
 * Pure: mutates the passed-in object, no I/O. Caller persists.
 *
 * Mark-pending (not remove-and-rebuild) is the default because
 * invalidate's contract is "regen existing nodes" — the graph
 * topology stays intact. The remove-and-rebuild semantic of the old
 * `kshana_reset` is reachable later via an explicit `clean: true`
 * opt-in if the user changed something upstream that might alter
 * which per-items exist.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { applyInvalidation } from "../../src/core/planner/applyInvalidation.js";
import type { ExecutorState } from "../../src/core/project/projectTypes.js";

interface ProjectFile {
  executorState: ExecutorState;
}

let project: ProjectFile;

beforeEach(() => {
  project = {
    executorState: {
      nodes: {
        "shot_image_prompt:scene_1_shot_1": {
          id: "shot_image_prompt:scene_1_shot_1",
          typeId: "shot_image_prompt",
          itemId: "scene_1_shot_1",
          displayName: "S1 Shot 1 Prompt",
          status: "completed",
          dependencies: [],
          dependents: ["shot_image:scene_1_shot_1"],
          outputPath: "assets/prompts/shot_image_prompt-scene_1_shot_1.json",
          promptPath: "assets/prompts/shot_image_prompt-scene_1_shot_1.txt",
          startedAt: 1000,
          completedAt: 2000,
          artifactId: "art-1",
        },
        "shot_image:scene_1_shot_1": {
          id: "shot_image:scene_1_shot_1",
          typeId: "shot_image",
          itemId: "scene_1_shot_1",
          displayName: "S1 Shot 1 Image",
          status: "completed",
          dependencies: ["shot_image_prompt:scene_1_shot_1"],
          dependents: [],
          outputPath: "assets/images/foo.png",
          startedAt: 1000,
          completedAt: 3000,
        },
      },
    } as never,
  };
});

describe("applyInvalidation", () => {
  it("marks each targeted node as pending and clears its execution metadata", () => {
    applyInvalidation(project, ["shot_image_prompt:scene_1_shot_1"]);
    const n = project.executorState.nodes["shot_image_prompt:scene_1_shot_1"]!;
    expect(n.status).toBe("pending");
    expect(n.outputPath).toBeUndefined();
    expect(n.promptPath).toBeUndefined();
    expect(n.startedAt).toBeUndefined();
    expect(n.completedAt).toBeUndefined();
    expect(n.artifactId).toBeUndefined();
    expect(n.error).toBeUndefined();
  });

  /**
   * Cascade behavior: invalidating an upstream node should also mark
   * every transitive dependent pending. Without this, a surgical
   * "redo this one shot's prompt" leaves the downstream image stuck
   * in `completed` — the next run skips it, and the new prompt never
   * affects the rendered image. Same shape of bug we hit on
   * Baker-and-the-Bee where final_video stayed completed after a
   * shot_video re-run.
   *
   * Older test in this file pinned the OPPOSITE invariant ("does NOT
   * touch nodes outside the invalidation set"). That contract was
   * wrong — invalidate's user-facing semantic is "this node's output
   * is stale", which by transitivity makes its consumers stale too.
   */
  it("cascades pending status to transitive dependents by default", () => {
    applyInvalidation(project, ["shot_image_prompt:scene_1_shot_1"]);
    const downstream = project.executorState.nodes["shot_image:scene_1_shot_1"]!;
    expect(downstream.status).toBe("pending");
    expect(downstream.outputPath).toBeUndefined();
    expect(downstream.completedAt).toBeUndefined();
  });

  it("with cascade:false, leaves downstream nodes alone (opt-out for surgical regen)", () => {
    applyInvalidation(
      project,
      ["shot_image_prompt:scene_1_shot_1"],
      { cascade: false },
    );
    const downstream = project.executorState.nodes["shot_image:scene_1_shot_1"]!;
    expect(downstream.status).toBe("completed");
    expect(downstream.outputPath).toBe("assets/images/foo.png");
    expect(downstream.completedAt).toBe(3000);
  });

  it("persists the invalidated id list (including cascaded dependents) onto executorState.lastInvalidatedIds", () => {
    applyInvalidation(project, ["shot_image_prompt:scene_1_shot_1"]);
    expect(
      ((project.executorState as unknown as { lastInvalidatedIds: string[] })
        .lastInvalidatedIds).sort(),
    ).toEqual(
      [
        "shot_image_prompt:scene_1_shot_1",
        "shot_image:scene_1_shot_1",
      ].sort(),
    );
  });

  it("returns seeds (caller-named) separately from the full invalidated set", () => {
    const result = applyInvalidation(project, [
      "shot_image_prompt:scene_1_shot_1",
    ]);
    expect(result.seeds).toEqual(["shot_image_prompt:scene_1_shot_1"]);
    expect(result.invalidated.sort()).toEqual(
      [
        "shot_image_prompt:scene_1_shot_1",
        "shot_image:scene_1_shot_1",
      ].sort(),
    );
  });

  it("overwrites a previous lastInvalidatedIds (most recent invalidate wins)", () => {
    (project.executorState as unknown as { lastInvalidatedIds: string[] })
      .lastInvalidatedIds = ["earlier:node"];
    applyInvalidation(project, ["shot_image:scene_1_shot_1"]);
    expect(
      (project.executorState as unknown as { lastInvalidatedIds: string[] })
        .lastInvalidatedIds,
    ).toEqual(["shot_image:scene_1_shot_1"]);
  });

  it("silently skips ids that don't exist in the graph (does not throw)", () => {
    expect(() =>
      applyInvalidation(project, ["nonexistent:node"]),
    ).not.toThrow();
    expect(
      (project.executorState as unknown as { lastInvalidatedIds: string[] })
        .lastInvalidatedIds,
    ).toEqual([]);
  });

  it("returns the list of ids that were actually invalidated (skips missing ones)", () => {
    const result = applyInvalidation(project, [
      "shot_image_prompt:scene_1_shot_1",
      "nonexistent:node",
      "shot_image:scene_1_shot_1",
    ]);
    expect(result.invalidated.sort()).toEqual(
      [
        "shot_image_prompt:scene_1_shot_1",
        "shot_image:scene_1_shot_1",
      ].sort(),
    );
    expect(result.notFound).toEqual(["nonexistent:node"]);
  });

  /**
   * Regression: ExecutorAgent's per-frame "incremental retry" check
   * (ExecutorAgent.ts:5537 + 5579) reuses on-disk first_frame /
   * last_frame / mid_frame images when `node.outputPaths[frame]` is
   * still set AND the file exists. If we only clear `outputPath`
   * (the legacy single path) but leave `outputPaths` (the per-frame
   * dict) intact, invalidation looks like it worked but the next
   * run silently reuses the stale frames — exactly what the user
   * saw when only the video regenerated and the upstream image
   * stayed put.
   */
  /**
   * Regression: live failure on Baker-and-the-Bee where regenerating a
   * single shot_video left final_video in `completed` state, so the
   * runner counted it in the 88/88 without re-running ffmpeg and the
   * existing final_video2.mp4 stayed stale (assembled before the new
   * shot was rendered). Cascade should walk shot_video → final_video.
   *
   * Also verifies the dependents-list dedupe path: real project.json
   * files in the wild had final_video listed multiple times in the
   * shot_video's dependents array (we observed 4× on baker), so
   * naïve cascade would visit it repeatedly. We expect each id to
   * appear exactly once in the result.
   */
  it("cascades from a single shot_video to final_video and dedupes duplicate dependent edges", () => {
    type N = ExecutorState["nodes"][string];
    project.executorState.nodes["shot_video:scene_1_shot_1"] = {
      id: "shot_video:scene_1_shot_1",
      typeId: "shot_video",
      itemId: "scene_1_shot_1",
      displayName: "S1 Shot 1 Video",
      status: "completed",
      dependencies: [],
      // Wild-data shape: same id repeated 4× — see Baker-and-the-Bee
      // project.json. Cascade must dedupe so we don't double-mark.
      dependents: ["final_video", "final_video", "final_video", "final_video"],
      outputPath: "assets/videos/shots/s1shot1_ltx23_xxx.mp4",
      completedAt: 5000,
    } as N;
    project.executorState.nodes["final_video"] = {
      id: "final_video",
      typeId: "final_video",
      displayName: "Final Video",
      status: "completed",
      dependencies: ["shot_video:scene_1_shot_1"],
      dependents: [],
      outputPath: "assets/videos/final/final_video2.mp4",
      completedAt: 9000,
    } as N;

    const result = applyInvalidation(project, ["shot_video:scene_1_shot_1"]);

    const fv = project.executorState.nodes["final_video"]!;
    expect(fv.status).toBe("pending");
    expect(fv.outputPath).toBeUndefined();
    expect(fv.completedAt).toBeUndefined();
    // Dedupe: final_video should appear exactly once in the result.
    const occurrences = result.invalidated.filter(id => id === "final_video").length;
    expect(occurrences).toBe(1);
  });

  it("clears the per-frame outputPaths dict so the executor's incremental-retry path can't reuse stale frames", () => {
    const node = project.executorState.nodes[
      "shot_image:scene_1_shot_1"
    ] as typeof project.executorState.nodes[string] & {
      outputPaths?: Record<string, string>;
    };
    node.outputPaths = {
      first_frame: "assets/images/s1shot1_first_frame_klein_xxx.png",
      last_frame: "assets/images/s1shot1_last_frame_klein_yyy.png",
    };

    applyInvalidation(project, ["shot_image:scene_1_shot_1"]);

    const cleared = project.executorState.nodes[
      "shot_image:scene_1_shot_1"
    ] as typeof project.executorState.nodes[string] & {
      outputPaths?: Record<string, string>;
    };
    expect(cleared.outputPaths).toBeUndefined();
  });
});

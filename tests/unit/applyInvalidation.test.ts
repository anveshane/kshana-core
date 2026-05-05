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

  it("does NOT touch nodes outside the invalidation set (graph topology stays intact)", () => {
    applyInvalidation(project, ["shot_image_prompt:scene_1_shot_1"]);
    const downstream = project.executorState.nodes["shot_image:scene_1_shot_1"]!;
    expect(downstream.status).toBe("completed");
    expect(downstream.outputPath).toBe("assets/images/foo.png");
    expect(downstream.completedAt).toBe(3000);
  });

  it("persists the invalidated id list onto executorState.lastInvalidatedIds", () => {
    applyInvalidation(project, [
      "shot_image_prompt:scene_1_shot_1",
      "shot_image:scene_1_shot_1",
    ]);
    expect(
      (project.executorState as unknown as { lastInvalidatedIds: string[] })
        .lastInvalidatedIds,
    ).toEqual([
      "shot_image_prompt:scene_1_shot_1",
      "shot_image:scene_1_shot_1",
    ]);
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
});

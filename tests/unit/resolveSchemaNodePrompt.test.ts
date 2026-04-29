/**
 * Pi-era projects don't have executorState — but they DO have
 * project.scenes[].shots[] with prompt + motionDirective fields. The
 * Edit & Redo modal needs SOMETHING to load when the user clicks
 * "edit prompt" on a shot in a pi-era project.
 *
 * resolveSchemaNodePrompt synthesizes the same shape the legacy
 * executor route returns, sourced from project.scenes.
 */
import { describe, it, expect } from "vitest";
import { resolveSchemaNodePrompt } from "../../src/server/resolveSchemaNodePrompt.js";

const baseProject = {
  scenes: [
    {
      sceneNumber: 2,
      shots: [
        {
          shotNumber: 3,
          prompt: "A close-up of the detective lighting a cigarette in the rain.",
          motionDirective: "Slow zoom in. Smoke curls up.",
          firstFrame: { path: "assets/images/s2shot3_first.png", createdAt: 1 },
          lastFrame: { path: "assets/images/s2shot3_last.png", createdAt: 2 },
          video: { path: "assets/videos/shots/s2shot3.mp4", createdAt: 3 },
        },
      ],
    },
  ],
};

describe("resolveSchemaNodePrompt", () => {
  it("resolves shot_image_prompt to a flat imagePrompt response", () => {
    const r = resolveSchemaNodePrompt(baseProject, "shot_image_prompt:scene_2_shot_3");
    expect(r).not.toBeNull();
    expect(r!.nodeType).toBe("shot_image_prompt");
    expect((r!.prompt as { imagePrompt: string }).imagePrompt).toBe(
      "A close-up of the detective lighting a cigarette in the rain.",
    );
  });

  it("resolves shot_motion_directive to motionDirective", () => {
    const r = resolveSchemaNodePrompt(baseProject, "shot_motion_directive:scene_2_shot_3");
    expect(r).not.toBeNull();
    expect(r!.nodeType).toBe("shot_motion_directive");
    expect((r!.prompt as { motionDirective: string }).motionDirective).toBe(
      "Slow zoom in. Smoke curls up.",
    );
  });

  it("resolves shot_image (the asset itself) by mirroring shot_image_prompt", () => {
    const r = resolveSchemaNodePrompt(baseProject, "shot_image:scene_2_shot_3");
    expect(r).not.toBeNull();
    expect(r!.nodeType).toBe("shot_image");
    expect((r!.prompt as { imagePrompt: string }).imagePrompt).toBe(
      "A close-up of the detective lighting a cigarette in the rain.",
    );
  });

  it("resolves shot_video by including the first frame URL the modal previews", () => {
    const r = resolveSchemaNodePrompt(baseProject, "shot_video:scene_2_shot_3");
    expect(r).not.toBeNull();
    expect(r!.nodeType).toBe("shot_video");
    expect((r!.prompt as { motionDirective: string }).motionDirective).toBe(
      "Slow zoom in. Smoke curls up.",
    );
    // Caller plugs in the project name; the resolver returns the relative path.
    expect(r!.firstFramePath).toBe("assets/images/s2shot3_first.png");
  });

  it("returns null when the scene/shot doesn't exist", () => {
    expect(resolveSchemaNodePrompt(baseProject, "shot_image_prompt:scene_9_shot_9")).toBeNull();
  });

  it("returns null for unrecognized node id formats", () => {
    expect(resolveSchemaNodePrompt(baseProject, "world_style:default")).toBeNull();
    expect(resolveSchemaNodePrompt(baseProject, "garbage")).toBeNull();
  });

  it("returns empty strings when the shot exists but has no prompt yet", () => {
    const blankProject = {
      scenes: [{ sceneNumber: 1, shots: [{ shotNumber: 1 }] }],
    };
    const r = resolveSchemaNodePrompt(blankProject, "shot_image_prompt:scene_1_shot_1");
    expect(r).not.toBeNull();
    expect((r!.prompt as { imagePrompt: string }).imagePrompt).toBe("");
  });
});

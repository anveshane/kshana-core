/**
 * Phase 4: surgical reset against the new project.scenes tree.
 *
 * Resetting a stage clears the slots that the stage produces AND
 * everything downstream (the cascade is intrinsic — if you reset
 * shot_image, the shot.video that was rendered from those frames
 * is also stale). Cleared slots are archived to shot.history with
 * reason: 'reset', so the user can audit what was retired.
 */
import { describe, it, expect } from "vitest";
import { resetSchemaStage } from "../../src/core/project/resetSchemaStage.js";
import { setShotFrame, setShotVideo, setShotPrompt, setShotMotionDirective, setFinalVideo } from "../../src/core/project/projectSchema.js";

function seed(): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  setShotPrompt(p, 1, 1, "shot 1 prompt");
  setShotMotionDirective(p, 1, 1, "shot 1 motion");
  setShotFrame(p, 1, 1, "firstFrame", { path: "f1.png", createdAt: 1 });
  setShotFrame(p, 1, 1, "lastFrame", { path: "l1.png", createdAt: 2 });
  setShotVideo(p, 1, 1, { path: "v1.mp4", createdAt: 3 });
  setShotPrompt(p, 1, 2, "shot 2 prompt");
  setShotFrame(p, 1, 2, "firstFrame", { path: "f2.png", createdAt: 4 });
  setShotVideo(p, 1, 2, { path: "v2.mp4", createdAt: 5 });
  setFinalVideo(p, { path: "final.mp4", createdAt: 99 });
  return p;
}

type SceneOut = {
  sceneNumber: number;
  shots: Array<{
    shotNumber: number;
    prompt?: string;
    motionDirective?: string;
    firstFrame?: { path: string };
    lastFrame?: { path: string };
    midFrame?: { path: string };
    video?: { path: string };
    history?: Array<{ reason: string; firstFrame?: { path: string }; video?: { path: string } }>;
  }>;
};

describe("resetSchemaStage", () => {
  it("reset 'final_video' clears only project.finalVideo", () => {
    const p = seed();
    const r = resetSchemaStage(p, "final_video");
    expect(p["finalVideo"]).toBeUndefined();
    // Per-shot slots untouched.
    const shots = (p["scenes"] as SceneOut[])[0]!.shots;
    expect(shots[0]!.video?.path).toBe("v1.mp4");
    expect(r!.cleared).toBeGreaterThan(0);
  });

  it("reset 'shot_video' clears every shot.video and project.finalVideo (cascade)", () => {
    const p = seed();
    resetSchemaStage(p, "shot_video");
    const shots = (p["scenes"] as SceneOut[])[0]!.shots;
    expect(shots[0]!.video).toBeUndefined();
    expect(shots[1]!.video).toBeUndefined();
    expect(p["finalVideo"]).toBeUndefined();
    // Frames + prompts upstream of video are preserved.
    expect(shots[0]!.firstFrame?.path).toBe("f1.png");
    expect(shots[0]!.prompt).toBe("shot 1 prompt");
  });

  it("reset 'shot_image' clears frames + cascades to shot.video and finalVideo", () => {
    const p = seed();
    resetSchemaStage(p, "shot_image");
    const shots = (p["scenes"] as SceneOut[])[0]!.shots;
    expect(shots[0]!.firstFrame).toBeUndefined();
    expect(shots[0]!.lastFrame).toBeUndefined();
    expect(shots[0]!.video).toBeUndefined();
    expect(p["finalVideo"]).toBeUndefined();
    // Shot prompts upstream are preserved.
    expect(shots[0]!.prompt).toBe("shot 1 prompt");
  });

  it("reset 'shot_image_prompt' clears the prompt + every downstream slot", () => {
    const p = seed();
    resetSchemaStage(p, "shot_image_prompt");
    const shots = (p["scenes"] as SceneOut[])[0]!.shots;
    expect(shots[0]!.prompt).toBeUndefined();
    expect(shots[0]!.firstFrame).toBeUndefined();
    expect(shots[0]!.lastFrame).toBeUndefined();
    expect(shots[0]!.video).toBeUndefined();
    expect(p["finalVideo"]).toBeUndefined();
    // motionDirective is a sibling, not downstream of shot_image_prompt — preserved.
    expect(shots[0]!.motionDirective).toBe("shot 1 motion");
  });

  it("reset 'shot_motion_directive' clears motionDirective + downstream (video, final)", () => {
    const p = seed();
    resetSchemaStage(p, "shot_motion_directive");
    const shots = (p["scenes"] as SceneOut[])[0]!.shots;
    expect(shots[0]!.motionDirective).toBeUndefined();
    expect(shots[0]!.video).toBeUndefined();
    expect(p["finalVideo"]).toBeUndefined();
    // Frames + prompt are siblings/upstream, preserved.
    expect(shots[0]!.firstFrame?.path).toBe("f1.png");
    expect(shots[0]!.prompt).toBe("shot 1 prompt");
  });

  it("archives cleared values to shot.history with reason 'reset'", () => {
    const p = seed();
    resetSchemaStage(p, "shot_video");
    const shot = (p["scenes"] as SceneOut[])[0]!.shots[0]!;
    const resetEntries = (shot.history ?? []).filter((h) => h.reason === "reset");
    expect(resetEntries.length).toBeGreaterThan(0);
    expect(resetEntries[0]?.video?.path).toBe("v1.mp4");
  });

  it("returns counts so the CLI can report what was cleared", () => {
    const p = seed();
    const r = resetSchemaStage(p, "shot_video");
    // 2 shot.video slots + 1 finalVideo = 3 cleared.
    expect(r!.cleared).toBe(3);
    expect(r!.shotsAffected).toBe(2);
  });

  it("is idempotent — resetting twice doesn't re-archive empty slots", () => {
    const p = seed();
    resetSchemaStage(p, "shot_video");
    const historyBefore = ((p["scenes"] as SceneOut[])[0]!.shots[0]!.history ?? []).length;
    const r = resetSchemaStage(p, "shot_video");
    const historyAfter = ((p["scenes"] as SceneOut[])[0]!.shots[0]!.history ?? []).length;
    expect(historyAfter).toBe(historyBefore);
    expect(r!.cleared).toBe(0);
  });

  it("returns null for unknown stage names so callers can error cleanly", () => {
    const p = seed();
    const r = resetSchemaStage(p, "made_up_stage" as never);
    expect(r).toBeNull();
  });
});

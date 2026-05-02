import { describe, it, expect } from "vitest";
import {
  getScenes,
  findScene,
  findShot,
  ensureScene,
  ensureShot,
  retireShotSlots,
  setShotFrame,
  setShotVideo,
  setShotPrompt,
  setShotMotionDirective,
  clearShotSlots,
  setFinalVideo,
  ensureSchemaVersion,
  type ImageRef,
  type VideoRef,
} from "../../src/core/project/projectSchema.js";

const img = (path: string, createdAt: number): ImageRef => ({ path, createdAt });
const vid = (path: string, createdAt: number): VideoRef => ({ path, createdAt });

describe("getScenes / findScene / findShot", () => {
  it("returns empty array when project has no scenes field", () => {
    const p = {} as Record<string, unknown>;
    expect(getScenes(p)).toEqual([]);
  });

  it("returns the existing scenes array", () => {
    const p = { scenes: [{ sceneNumber: 1, shots: [] }] } as Record<string, unknown>;
    expect(getScenes(p)).toHaveLength(1);
  });

  it("findScene / findShot return undefined for missing entries", () => {
    const p = { scenes: [{ sceneNumber: 1, shots: [{ shotNumber: 1 }] }] } as Record<string, unknown>;
    expect(findScene(p, 2)).toBeUndefined();
    expect(findShot(p, 1, 2)).toBeUndefined();
    expect(findShot(p, 99, 1)).toBeUndefined();
  });

  it("findShot returns the shot when present", () => {
    const p = {
      scenes: [{ sceneNumber: 1, shots: [{ shotNumber: 1 }, { shotNumber: 2 }] }],
    } as Record<string, unknown>;
    expect(findShot(p, 1, 2)?.shotNumber).toBe(2);
  });
});

describe("ensureScene / ensureShot", () => {
  it("creates a scene if missing and inserts in sorted position", () => {
    const p = {} as Record<string, unknown>;
    ensureScene(p, 3);
    ensureScene(p, 1);
    ensureScene(p, 2);
    const scenes = getScenes(p);
    expect(scenes.map((s) => s.sceneNumber)).toEqual([1, 2, 3]);
  });

  it("returns the existing scene without duplicating", () => {
    const p = {} as Record<string, unknown>;
    const a = ensureScene(p, 1);
    const b = ensureScene(p, 1);
    expect(a).toBe(b);
    expect(getScenes(p)).toHaveLength(1);
  });

  it("ensureShot creates the parent scene if absent", () => {
    const p = {} as Record<string, unknown>;
    const shot = ensureShot(p, 1, 1);
    expect(shot.shotNumber).toBe(1);
    expect(getScenes(p)).toHaveLength(1);
    expect(getScenes(p)[0]!.shots).toHaveLength(1);
  });

  it("ensureShot inserts shots in sorted order", () => {
    const p = {} as Record<string, unknown>;
    ensureShot(p, 1, 3);
    ensureShot(p, 1, 1);
    ensureShot(p, 1, 2);
    expect(getScenes(p)[0]!.shots.map((s) => s.shotNumber)).toEqual([1, 2, 3]);
  });
});

describe("retireShotSlots", () => {
  it("returns false and does nothing when there's nothing to retire", () => {
    const p = {} as Record<string, unknown>;
    const shot = ensureShot(p, 1, 1);
    expect(retireShotSlots(shot, ["firstFrame"], "regenerated")).toBe(false);
    expect(shot.history).toBeUndefined();
  });

  it("pushes the current values into history with the given reason", () => {
    const p = {} as Record<string, unknown>;
    const shot = ensureShot(p, 1, 1);
    shot.firstFrame = img("a.png", 100);
    shot.prompt = "old prompt";
    expect(retireShotSlots(shot, ["firstFrame", "prompt"], "regenerated", 999)).toBe(true);
    expect(shot.history).toHaveLength(1);
    expect(shot.history![0]).toMatchObject({
      retiredAt: 999,
      reason: "regenerated",
      firstFrame: { path: "a.png" },
      prompt: "old prompt",
    });
  });

  it("only retires the requested fields, leaving others untouched", () => {
    const p = {} as Record<string, unknown>;
    const shot = ensureShot(p, 1, 1);
    shot.firstFrame = img("a.png", 100);
    shot.lastFrame = img("b.png", 200);
    retireShotSlots(shot, ["firstFrame"], "regenerated");
    expect(shot.history![0]?.firstFrame?.path).toBe("a.png");
    expect(shot.history![0]?.lastFrame).toBeUndefined();
    expect(shot.lastFrame?.path).toBe("b.png"); // untouched on the shot
  });
});

describe("setShotFrame / setShotVideo / setShotPrompt / setShotMotionDirective", () => {
  it("sets the first generation without writing history", () => {
    const p = {} as Record<string, unknown>;
    setShotFrame(p, 1, 1, "firstFrame", img("a.png", 1));
    const shot = findShot(p, 1, 1)!;
    expect(shot.firstFrame?.path).toBe("a.png");
    expect(shot.history).toBeUndefined();
  });

  it("archives the previous value on regeneration", () => {
    const p = {} as Record<string, unknown>;
    setShotFrame(p, 1, 1, "firstFrame", img("a.png", 1));
    setShotFrame(p, 1, 1, "firstFrame", img("b.png", 2));
    const shot = findShot(p, 1, 1)!;
    expect(shot.firstFrame?.path).toBe("b.png");
    expect(shot.history).toHaveLength(1);
    expect(shot.history![0]).toMatchObject({ reason: "regenerated", firstFrame: { path: "a.png" } });
  });

  it("setShotVideo archives the previous video", () => {
    const p = {} as Record<string, unknown>;
    setShotVideo(p, 1, 1, vid("x.mp4", 1));
    setShotVideo(p, 1, 1, vid("y.mp4", 2));
    const shot = findShot(p, 1, 1)!;
    expect(shot.video?.path).toBe("y.mp4");
    expect(shot.history).toHaveLength(1);
    expect(shot.history![0]?.video?.path).toBe("x.mp4");
  });

  it("setShotPrompt and setShotMotionDirective archive their fields", () => {
    const p = {} as Record<string, unknown>;
    setShotPrompt(p, 1, 1, "v1");
    setShotPrompt(p, 1, 1, "v2");
    setShotMotionDirective(p, 1, 1, "m1");
    setShotMotionDirective(p, 1, 1, "m2");
    const shot = findShot(p, 1, 1)!;
    expect(shot.prompt).toBe("v2");
    expect(shot.motionDirective).toBe("m2");
    expect(shot.history).toHaveLength(2);
    expect(shot.history![0]?.prompt).toBe("v1");
    expect(shot.history![1]?.motionDirective).toBe("m1");
  });
});

describe("clearShotSlots", () => {
  it("archives current values as 'reset' and removes them from the shot", () => {
    const p = {} as Record<string, unknown>;
    setShotFrame(p, 1, 1, "firstFrame", img("a.png", 1));
    setShotVideo(p, 1, 1, vid("x.mp4", 1));
    const shot = findShot(p, 1, 1)!;
    clearShotSlots(shot, ["firstFrame", "video"]);
    expect(shot.firstFrame).toBeUndefined();
    expect(shot.video).toBeUndefined();
    expect(shot.history).toHaveLength(1);
    expect(shot.history![0]).toMatchObject({
      reason: "reset",
      firstFrame: { path: "a.png" },
      video: { path: "x.mp4" },
    });
  });

  it("returns false when there was nothing to clear", () => {
    const p = {} as Record<string, unknown>;
    const shot = ensureShot(p, 1, 1);
    expect(clearShotSlots(shot, ["firstFrame", "lastFrame"])).toBe(false);
  });
});

describe("setFinalVideo / ensureSchemaVersion", () => {
  it("sets and clears project.finalVideo", () => {
    const p = {} as Record<string, unknown>;
    setFinalVideo(p, vid("final.mp4", 1));
    expect(p["finalVideo"]).toEqual({ path: "final.mp4", createdAt: 1 });
    setFinalVideo(p, undefined);
    expect(p["finalVideo"]).toBeUndefined();
  });

  it("ensureSchemaVersion sets schemaVersion: 3 only when absent", () => {
    const p = {} as Record<string, unknown>;
    ensureSchemaVersion(p);
    expect(p["schemaVersion"]).toBe(3);
    p["schemaVersion"] = 99;
    ensureSchemaVersion(p);
    expect(p["schemaVersion"]).toBe(99);
  });
});

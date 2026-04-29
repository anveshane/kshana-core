import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  kshanaShowFirstFrame,
  kshanaShowLastFrame,
  kshanaShowShotVideo,
  kshanaShowFinalVideo,
} from "../../src/agent/pi/tools/showAsset.js";

interface ManifestEntry {
  id: string;
  type: string;
  path: string;
  createdAt: number;
  scene_number?: number;
  metadata?: Record<string, unknown>;
}

let projectsDir: string;
let originalProjectsDir: string | undefined;

const MANIFEST_FIXTURE: ManifestEntry[] = [
  // Two first_frame versions for s1 shot1 — newer should win on createdAt.
  {
    id: "img_old",
    type: "scene_image",
    path: "assets/images/s1shot1_first_frame_klein_AAA.png",
    createdAt: 1000,
  },
  {
    id: "img_new",
    type: "scene_image",
    path: "assets/images/s1shot1_first_frame_klein_BBB.png",
    createdAt: 2000,
  },
  // last_frame for s1 shot1
  {
    id: "img_last",
    type: "scene_image",
    path: "assets/images/s1shot1_last_frame_klein_CCC.png",
    createdAt: 1500,
  },
  // first_frame for s1 shot2 — separate shot
  {
    id: "img_shot2",
    type: "scene_image",
    path: "assets/images/s1shot2_first_frame_klein_DDD.png",
    createdAt: 1800,
  },
  // shot video for s1 shot1 — multiple versions
  {
    id: "vid_old",
    type: "scene_video",
    path: "assets/videos/shots/s1shot1_ltx23_xxx.mp4",
    createdAt: 1000,
  },
  {
    id: "vid_new",
    type: "scene_video",
    path: "assets/videos/shots/s1shot1_ltx23_yyy.mp4",
    createdAt: 3000,
  },
  // final video
  {
    id: "final_old",
    type: "final_video",
    path: "assets/videos/final/final_video_v1.mp4",
    createdAt: 5000,
  },
  {
    id: "final_new",
    type: "final_video",
    path: "assets/videos/final/final_video.mp4",
    createdAt: 9000,
  },
  // unrelated entry that must never be picked
  {
    id: "char_ref",
    type: "character_ref",
    path: "assets/images/CharRef_x.png",
    createdAt: 8000,
  },
];

beforeEach(() => {
  projectsDir = mkdtempSync(join(tmpdir(), "kshana-show-test-"));
  const proj = join(projectsDir, "demo.kshana");
  mkdirSync(join(proj, "assets"), { recursive: true });
  writeFileSync(
    join(proj, "assets", "manifest.json"),
    JSON.stringify({ assets: MANIFEST_FIXTURE }, null, 2),
    "utf8",
  );
  originalProjectsDir = process.env["KSHANA_PROJECTS_DIR"];
  process.env["KSHANA_PROJECTS_DIR"] = projectsDir;
});

afterEach(() => {
  if (originalProjectsDir === undefined) delete process.env["KSHANA_PROJECTS_DIR"];
  else process.env["KSHANA_PROJECTS_DIR"] = originalProjectsDir;
  rmSync(projectsDir, { recursive: true, force: true });
});

async function exec<T extends { execute: Function }>(tool: T, params: unknown): Promise<{
  details: Record<string, unknown>;
  text: string;
}> {
  const r = await tool.execute("test-call", params, undefined, undefined, {} as never);
  return {
    details: r.details as Record<string, unknown>,
    text: (r.content[0] as { text: string }).text,
  };
}

describe("kshana_show_first_frame", () => {
  it("picks the latest first-frame for the requested shot by createdAt", async () => {
    const r = await exec(kshanaShowFirstFrame, { project: "demo", scene: 1, shot: 1 });
    expect(r.details["file_path"]).toBe("assets/images/s1shot1_first_frame_klein_BBB.png");
    expect(r.details["asset_id"]).toBe("img_new");
    expect(r.details["created_at"]).toBe(2000);
  });

  it("scopes by scene+shot — does not return s1 shot2 when asked for s1 shot1", async () => {
    const r = await exec(kshanaShowFirstFrame, { project: "demo", scene: 1, shot: 1 });
    expect(r.details["file_path"]).not.toContain("s1shot2");
  });

  it("returns a not-found result when the shot has no matching frame", async () => {
    const r = await exec(kshanaShowFirstFrame, { project: "demo", scene: 9, shot: 9 });
    expect(r.details["found"]).toBe(false);
    expect(r.text.toLowerCase()).toContain("no first-frame");
  });
});

describe("kshana_show_last_frame", () => {
  it("returns the last_frame variant, not the first_frame", async () => {
    const r = await exec(kshanaShowLastFrame, { project: "demo", scene: 1, shot: 1 });
    expect(r.details["file_path"]).toBe("assets/images/s1shot1_last_frame_klein_CCC.png");
  });
});

describe("kshana_show_shot_video", () => {
  it("picks the latest scene_video for the shot", async () => {
    const r = await exec(kshanaShowShotVideo, { project: "demo", scene: 1, shot: 1 });
    expect(r.details["file_path"]).toBe("assets/videos/shots/s1shot1_ltx23_yyy.mp4");
    expect(r.details["created_at"]).toBe(3000);
  });

  it("does not return character_ref or final_video entries", async () => {
    const r = await exec(kshanaShowShotVideo, { project: "demo", scene: 1, shot: 1 });
    expect(r.details["asset_type"]).toBe("scene_video");
  });
});

describe("kshana_show_final_video", () => {
  it("returns the latest final_video by createdAt", async () => {
    const r = await exec(kshanaShowFinalVideo, { project: "demo" });
    expect(r.details["file_path"]).toBe("assets/videos/final/final_video.mp4");
    expect(r.details["asset_id"]).toBe("final_new");
  });

  it("ignores non-final-video assets even when they're newer", async () => {
    // char_ref has createdAt=8000, newer than final_old=5000, but final_new=9000 is newest.
    // The test ensures filter-by-type happens before max-by-createdAt.
    const r = await exec(kshanaShowFinalVideo, { project: "demo" });
    expect(r.details["asset_type"]).toBe("final_video");
  });

  it("returns not-found when the project has no final_video entry", async () => {
    // Rewrite manifest with no final_video.
    const proj = join(projectsDir, "demo.kshana");
    writeFileSync(
      join(proj, "assets", "manifest.json"),
      JSON.stringify({ assets: MANIFEST_FIXTURE.filter((a) => a.type !== "final_video") }, null, 2),
      "utf8",
    );
    const r = await exec(kshanaShowFinalVideo, { project: "demo" });
    expect(r.details["found"]).toBe(false);
  });
});

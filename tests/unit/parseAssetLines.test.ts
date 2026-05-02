import { describe, it, expect } from "vitest";
import {
  parseAssetLine,
  createAssetParser,
  feedChunk,
} from "../../src/agent/pi/tools/parseAssetLines.js";

describe("parseAssetLine", () => {
  it("extracts an image asset path with arrow prefix", () => {
    const ev = parseAssetLine("    → assets/images/s1shot1_first_frame_klein_xxx.png");
    expect(ev).toEqual({ kind: "image", path: "assets/images/s1shot1_first_frame_klein_xxx.png" });
  });

  it("extracts a video asset path", () => {
    const ev = parseAssetLine("    → assets/videos/shots/s1shot2_ltx23_yyy.mp4");
    expect(ev).toEqual({ kind: "video", path: "assets/videos/shots/s1shot2_ltx23_yyy.mp4" });
  });

  it("recognizes the ASCII -> as well as the unicode arrow", () => {
    const ev = parseAssetLine("  -> assets/images/foo.jpg");
    expect(ev).toEqual({ kind: "image", path: "assets/images/foo.jpg" });
  });

  it("classifies common video extensions", () => {
    expect(parseAssetLine("→ assets/x.webm")?.kind).toBe("video");
    expect(parseAssetLine("→ assets/x.mov")?.kind).toBe("video");
  });

  it("returns null for non-asset lines", () => {
    expect(parseAssetLine("=== run-to ===")).toBeNull();
    expect(parseAssetLine("  [generate_shot_image] scene_1_shot_1")).toBeNull();
    expect(parseAssetLine("    → status: completed")).toBeNull();
    expect(parseAssetLine("")).toBeNull();
  });

  it("ignores asset paths that don't match the supported extensions", () => {
    expect(parseAssetLine("    → assets/images/manifest.json")).toBeNull();
    expect(parseAssetLine("    → assets/garbage.txt")).toBeNull();
  });
});

describe("feedChunk", () => {
  it("emits assets one per matching line in chunk order", () => {
    const state = createAssetParser();
    const events = feedChunk(
      state,
      [
        "  [generate_shot_image] scene_1_shot_1",
        "    → assets/images/s1shot1_first_frame.png",
        "  [generate_shot_image] scene_1_shot_2",
        "    → assets/images/s1shot2_first_frame.png",
        "",
      ].join("\n"),
    );
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.path)).toEqual([
      "assets/images/s1shot1_first_frame.png",
      "assets/images/s1shot2_first_frame.png",
    ]);
  });

  it("buffers a partial line across chunks and emits it once complete", () => {
    const state = createAssetParser();
    const a = feedChunk(state, "    → assets/images/s1shot1_");
    expect(a).toEqual([]);
    const b = feedChunk(state, "first_frame.png\n");
    expect(b).toEqual([{ kind: "image", path: "assets/images/s1shot1_first_frame.png" }]);
  });

  it("does not emit the same asset twice across chunks", () => {
    const state = createAssetParser();
    const a = feedChunk(state, "    → assets/images/s1.png\n");
    const b = feedChunk(state, "    → assets/images/s1.png\n");
    expect(a).toHaveLength(1);
    expect(b).toEqual([]);
  });

  it("handles a final line without trailing newline by buffering it", () => {
    const state = createAssetParser();
    const a = feedChunk(state, "    → assets/images/s1.png\n    → assets/images/s2.png");
    expect(a).toEqual([{ kind: "image", path: "assets/images/s1.png" }]);
    expect(state.buffer).toContain("s2.png");
    const b = feedChunk(state, "\n");
    expect(b).toEqual([{ kind: "image", path: "assets/images/s2.png" }]);
  });

  it("handles CRLF line endings", () => {
    const state = createAssetParser();
    const events = feedChunk(state, "    → assets/images/x.png\r\n    → assets/videos/y.mp4\r\n");
    expect(events).toEqual([
      { kind: "image", path: "assets/images/x.png" },
      { kind: "video", path: "assets/videos/y.mp4" },
    ]);
  });
});

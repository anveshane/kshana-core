/**
 * Regression: when kshana-core is bundled (e.g. for the embedded
 * desktop integration), `paths.ts` ends up at `dist/server/manager.js`
 * instead of `src/agent/pi/paths.ts`. The hardcoded `../../..` in
 * paths.ts then points one directory too high — outside the
 * kshana-core package — and prompt loading fails with
 *   ENOENT: ... '/Users/foo/Projects/prompts/system/pi-orchestrator.md'
 *
 * Fix: walk up from `import.meta.url` looking for the package.json
 * whose `name` field is `kshana-core`. Works equally well from a
 * source file (vitest, tsx) or from the bundled CJS/ESM output.
 *
 * Bug surfaced 2026-05-01 in the embedded desktop chat panel after
 * the user typed a redo task — runTask reached the orchestrator
 * prompt loader and ENOENT'd.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { findKshanaCoreRoot } from "../../src/agent/pi/paths.js";

describe("findKshanaCoreRoot", () => {
  it("walks up from a bundled file (dist/server/manager.js) to the kshana-core root", () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), "kshana-core-root-"));
    writeFileSync(
      join(fakeRoot, "package.json"),
      JSON.stringify({ name: "kshana-core", version: "0.0.0" }),
    );
    mkdirSync(join(fakeRoot, "dist/server"), { recursive: true });
    const bundlePath = join(fakeRoot, "dist/server/manager.js");
    writeFileSync(bundlePath, "// fake bundle");

    expect(findKshanaCoreRoot(pathToFileURL(bundlePath).href)).toBe(
      resolve(fakeRoot),
    );
  });

  it("walks up from a source file (src/agent/pi/paths.ts) to the kshana-core root", () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), "kshana-core-root-"));
    writeFileSync(
      join(fakeRoot, "package.json"),
      JSON.stringify({ name: "kshana-core", version: "0.0.0" }),
    );
    mkdirSync(join(fakeRoot, "src/agent/pi"), { recursive: true });
    const srcPath = join(fakeRoot, "src/agent/pi/paths.ts");
    writeFileSync(srcPath, "// fake source");

    expect(findKshanaCoreRoot(pathToFileURL(srcPath).href)).toBe(
      resolve(fakeRoot),
    );
  });

  it("ignores intermediate package.json files that aren't kshana-core", () => {
    // The desktop's release/app/node_modules/kshana-core case: walking
    // up from the bundle hits node_modules' own package.jsons (other
    // packages) before reaching kshana-core's. The walker must keep
    // going past those instead of stopping at the first match.
    const fakeRoot = mkdtempSync(join(tmpdir(), "kshana-core-root-"));
    writeFileSync(
      join(fakeRoot, "package.json"),
      JSON.stringify({ name: "kshana-core", version: "0.0.0" }),
    );
    mkdirSync(join(fakeRoot, "node_modules/some-dep"), { recursive: true });
    writeFileSync(
      join(fakeRoot, "node_modules/some-dep/package.json"),
      JSON.stringify({ name: "some-dep", version: "1.0.0" }),
    );
    mkdirSync(join(fakeRoot, "node_modules/some-dep/dist"), { recursive: true });
    const fakeFileInDep = join(fakeRoot, "node_modules/some-dep/dist/file.js");
    writeFileSync(fakeFileInDep, "// fake");

    expect(findKshanaCoreRoot(pathToFileURL(fakeFileInDep).href)).toBe(
      resolve(fakeRoot),
    );
  });

  it("returns a path that has prompts/system/pi-orchestrator.md when called from the real package", () => {
    // Smoke-check the real implementation against the actual repo —
    // ensures the orchestrator prompt is reachable from REPO_ROOT.
    const root = findKshanaCoreRoot(import.meta.url);
    expect(() =>
      readFileSync(join(root, "prompts/system/pi-orchestrator.md"), "utf8"),
    ).not.toThrow();
  });
});

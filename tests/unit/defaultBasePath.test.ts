/**
 * Regression: kshana-ink's filesystem helpers (loadProject,
 * projectExists, projectPath, …) default `basePath` to
 * `process.cwd()`. When kshana-ink is embedded inside Electron's
 * main process, cwd points at the host's launch dir — typically
 * NOT where projects live.
 *
 * Workaround: read the `KSHANA_PROJECTS_DIR` env var first; fall
 * back to `process.cwd()`. The embedded host (kshana-desktop) sets
 * this env in `KshanaCoreManager.start()` so projectFileIO sees the
 * right base in both dev (REPO_ROOT) and packaged (~/Kshana) modes.
 *
 * Bug surfaced 2026-05-01: focusSessionProject → loadProject('foo.kshana')
 * resolved to `kshana-desktop/foo.kshana/...` and ENOENT'd.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultBasePath } from "../../src/tasks/video/workflow/projectFileIO.js";

const ENV_KEY = "KSHANA_PROJECTS_DIR";

describe("defaultBasePath", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("returns KSHANA_PROJECTS_DIR when set", () => {
    process.env[ENV_KEY] = "/some/projects/dir";
    expect(defaultBasePath()).toBe("/some/projects/dir");
  });

  it("falls back to process.cwd() when KSHANA_PROJECTS_DIR is unset", () => {
    delete process.env[ENV_KEY];
    expect(defaultBasePath()).toBe(process.cwd());
  });

  it("falls back to process.cwd() when KSHANA_PROJECTS_DIR is empty", () => {
    process.env[ENV_KEY] = "";
    expect(defaultBasePath()).toBe(process.cwd());
  });
});

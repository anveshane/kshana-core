/**
 * Regression: ConversationManager.focusSessionProject must read
 * `project.json` reliably regardless of the host's process.cwd().
 *
 * The original code did `loadProject(projectDirName)`, which passes
 * the project DIR NAME (e.g. "chhaya_60s_anime.kshana") into
 * loadProject's `basePath` argument — semantically wrong. It only
 * happened to work in the standalone CLI when cwd was already
 * /Users/.../kshana-ink AND a session context was set up with
 * matching projectDir. Embedded in the desktop, neither held, and
 * focusSessionProject failed with
 *   "project.json not found or empty for 'chhaya_60s_anime'".
 *
 * Fix: read project.json directly from
 *   `<defaultBasePath>/<projectName>.kshana/project.json`
 * where defaultBasePath honours `KSHANA_PROJECTS_DIR` (set by the
 * embedded host) and falls back to process.cwd() (CLI).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationManager } from "../../src/server/ConversationManager.js";

describe("ConversationManager.focusSessionProject reads project.json from KSHANA_PROJECTS_DIR", () => {
  let projectsDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "kshana-focus-"));
    mkdirSync(join(projectsDir, "demo.kshana"), { recursive: true });
    writeFileSync(
      join(projectsDir, "demo.kshana", "project.json"),
      JSON.stringify({
        version: "3.0",
        name: "demo",
        templateId: "narrative",
        style: "noir",
        targetDuration: 30,
      }),
    );
    originalEnv = process.env["KSHANA_PROJECTS_DIR"];
    process.env["KSHANA_PROJECTS_DIR"] = projectsDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env["KSHANA_PROJECTS_DIR"];
    else process.env["KSHANA_PROJECTS_DIR"] = originalEnv;
    rmSync(projectsDir, { recursive: true, force: true });
  });

  it("loads the project even when process.cwd() is unrelated to KSHANA_PROJECTS_DIR", async () => {
    const cm = new ConversationManager({
      llmConfig: { baseUrl: "x", apiKey: "x", model: "x" } as never,
    });
    const session = cm.createSession();

    const result = await cm.focusSessionProject(session.id, "demo");
    expect(result.projectName).toBe("demo");
    expect(result.templateId).toBe("narrative");
    expect(result.style).toBe("noir");
  });

  it("throws a clear error when the project does not exist", async () => {
    const cm = new ConversationManager({
      llmConfig: { baseUrl: "x", apiKey: "x", model: "x" } as never,
    });
    const session = cm.createSession();

    await expect(cm.focusSessionProject(session.id, "nonexistent-project")).rejects.toThrow(
      /not found|unreadable/i,
    );
  });
});

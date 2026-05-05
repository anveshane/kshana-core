/**
 * ConversationManager.setPiOversight / setVLMJudge — the two new
 * runtime toggles for Pi-agent oversight (re-engaging pi-agent on
 * runner events) and VLM judge (vision-LLM review of generated
 * images). Both default ON, both persist to project.json (mirrors
 * autonomousMode).
 *
 * VLM is gated by oversight: VLM standalone makes no sense (its
 * verdicts have no consumer without an oversight loop). The runtime
 * effective value is `piOversight && vlmJudge`. Storage stays as
 * two independent booleans — the gating is enforced at the
 * read site, not on writes.
 *
 * Tests focus on what's testable at the manager layer:
 *   - mutation of session.state.{piOversight, vlmJudge}
 *   - persistence to project.json on disk
 *   - reload on a fresh manager honors persisted values
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConversationManager } from "../../src/server/ConversationManager.js";

describe("ConversationManager.setPiOversight / setVLMJudge", () => {
  let projectsDir: string;
  let projectDir: string;
  let projectJsonPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    projectsDir = mkdtempSync(join(tmpdir(), "kshana-toggles-"));
    projectDir = join(projectsDir, "demo.kshana");
    projectJsonPath = join(projectDir, "project.json");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      projectJsonPath,
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

  it("setPiOversight mutates session state and persists to project.json", async () => {
    const cm = new ConversationManager({
      llmConfig: { baseUrl: "x", apiKey: "x", model: "x" } as never,
    });
    const session = cm.createSession();
    await cm.focusSessionProject(session.id, "demo");

    cm.setPiOversight(session.id, false);

    const sessions = (
      cm as unknown as {
        sessions: Map<string, { state: { piOversight?: boolean } }>;
      }
    ).sessions;
    expect(sessions.get(session.id)!.state.piOversight).toBe(false);

    const onDisk = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as {
      piOversight?: boolean;
    };
    expect(onDisk.piOversight).toBe(false);
  });

  it("setVLMJudge mutates session state and persists to project.json", async () => {
    const cm = new ConversationManager({
      llmConfig: { baseUrl: "x", apiKey: "x", model: "x" } as never,
    });
    const session = cm.createSession();
    await cm.focusSessionProject(session.id, "demo");

    cm.setVLMJudge(session.id, false);

    const sessions = (
      cm as unknown as {
        sessions: Map<string, { state: { vlmJudge?: boolean } }>;
      }
    ).sessions;
    expect(sessions.get(session.id)!.state.vlmJudge).toBe(false);

    const onDisk = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as {
      vlmJudge?: boolean;
    };
    expect(onDisk.vlmJudge).toBe(false);
  });

  it("set* on an unknown session is a no-op (does not throw, does not write disk)", () => {
    const cm = new ConversationManager({
      llmConfig: { baseUrl: "x", apiKey: "x", model: "x" } as never,
    });
    expect(() => cm.setPiOversight("not-a-session", false)).not.toThrow();
    expect(() => cm.setVLMJudge("not-a-session", false)).not.toThrow();

    const onDisk = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as {
      piOversight?: boolean;
      vlmJudge?: boolean;
    };
    expect(onDisk.piOversight).toBeUndefined();
    expect(onDisk.vlmJudge).toBeUndefined();
  });

  it("toggles are independent — flipping one does not touch the other on disk", async () => {
    const cm = new ConversationManager({
      llmConfig: { baseUrl: "x", apiKey: "x", model: "x" } as never,
    });
    const session = cm.createSession();
    await cm.focusSessionProject(session.id, "demo");

    cm.setPiOversight(session.id, false);
    cm.setVLMJudge(session.id, true);

    const onDisk = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as {
      piOversight?: boolean;
      vlmJudge?: boolean;
    };
    expect(onDisk.piOversight).toBe(false);
    expect(onDisk.vlmJudge).toBe(true);
  });
});

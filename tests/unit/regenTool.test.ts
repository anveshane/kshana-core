/**
 * kshana_regen wraps scripts/regen-node.ts so the agent can close the
 * edit-prompt → invalidate → run-to loop in one shot.
 *
 * The factory mirrors kshana_run_to: takes an onMedia callback so newly
 * generated assets surface as standalone media chat events while the
 * regen runs.
 */
import { describe, it, expect } from "vitest";
import { createRegenTool } from "../../src/agent/pi/tools/regen.js";

describe("createRegenTool", () => {
  it("registers as kshana_regen with the right description", () => {
    const tool = createRegenTool();
    expect(tool.name).toBe("kshana_regen");
    expect(tool.description.toLowerCase()).toContain("regen");
    expect(tool.description.toLowerCase()).toContain("node");
  });

  it("accepts project + node + cascade + no_run params", () => {
    const tool = createRegenTool();
    // TypeBox parameters expose `properties` for keys.
    const params = (tool.parameters as { properties: Record<string, unknown> }).properties;
    expect(params).toHaveProperty("project");
    expect(params).toHaveProperty("node");
    expect(params).toHaveProperty("cascade");
    expect(params).toHaveProperty("no_run");
  });

  it("is sequential (long-running tool — must not run in parallel)", () => {
    const tool = createRegenTool();
    expect(tool.executionMode).toBe("sequential");
  });
});

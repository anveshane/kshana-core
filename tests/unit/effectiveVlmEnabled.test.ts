/**
 * Pin: the SINGLE place that computes the VLM master-switch from
 * persisted per-project toggles. The rule is `piOversight && vlmJudge`,
 * with both defaulting to true when absent.
 *
 * The "VLM standalone makes no sense" constraint shows up here: when
 * supervisor is off, VLM is forced off regardless of vlmJudge's
 * stored value. (Storage stays as two independent booleans; the
 * gating is enforced at this read site.)
 */
import { describe, it, expect } from "vitest";
import { effectiveVlmEnabled } from "../../src/server/runners/effectiveVlmEnabled.js";

describe("effectiveVlmEnabled", () => {
  it("both toggles ON → VLM enabled", () => {
    expect(effectiveVlmEnabled({ piOversight: true, vlmJudge: true })).toBe(true);
  });

  it("supervisor OFF → VLM disabled regardless of vlmJudge", () => {
    expect(effectiveVlmEnabled({ piOversight: false, vlmJudge: true })).toBe(false);
    expect(effectiveVlmEnabled({ piOversight: false, vlmJudge: false })).toBe(false);
  });

  it("supervisor ON, VLM toggle OFF → VLM disabled", () => {
    expect(effectiveVlmEnabled({ piOversight: true, vlmJudge: false })).toBe(false);
  });

  it("absent fields default to ON (matches the default-ON rule)", () => {
    expect(effectiveVlmEnabled({})).toBe(true);
    expect(effectiveVlmEnabled({ piOversight: undefined, vlmJudge: undefined })).toBe(true);
    expect(effectiveVlmEnabled({ piOversight: null, vlmJudge: null })).toBe(true);
  });

  it("partially present fields → only the explicit one matters", () => {
    expect(effectiveVlmEnabled({ piOversight: true })).toBe(true);
    expect(effectiveVlmEnabled({ vlmJudge: false })).toBe(false);
    expect(effectiveVlmEnabled({ piOversight: false })).toBe(false);
  });
});

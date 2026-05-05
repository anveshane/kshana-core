/**
 * Process-wide oversight state — replaces per-project storage.
 *
 * Two booleans, pinned on globalThis (mirrors the
 * BackgroundTaskRunner singleton pattern) so every code path
 * (ConversationManager setters, the runner singleton, the executor)
 * sees the same source of truth across multiple bundle copies of
 * this module.
 *
 * Defaults to both ON — matches the desktop's AppSettings default,
 * so tests / CLI / unconfigured callers behave like the UI.
 *
 * Tests use the exported reset helper to keep cases independent —
 * the global lives across the whole process otherwise.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getOversight,
  setPiOversight,
  setVLMJudge,
  __resetOversightForTesting,
} from "../../src/server/oversightState.js";

describe("oversightState — process-wide global", () => {
  beforeEach(() => {
    __resetOversightForTesting();
  });

  it("defaults both toggles to ON", () => {
    const s = getOversight();
    expect(s.piOversight).toBe(true);
    expect(s.vlmJudge).toBe(true);
  });

  it("setPiOversight mutates only piOversight", () => {
    setPiOversight(false);
    const s = getOversight();
    expect(s.piOversight).toBe(false);
    expect(s.vlmJudge).toBe(true);
  });

  it("setVLMJudge mutates only vlmJudge", () => {
    setVLMJudge(false);
    const s = getOversight();
    expect(s.piOversight).toBe(true);
    expect(s.vlmJudge).toBe(false);
  });

  it("returned snapshot is a copy — mutating it does not affect global state", () => {
    const s = getOversight();
    s.piOversight = false;
    s.vlmJudge = false;
    const fresh = getOversight();
    expect(fresh.piOversight).toBe(true);
    expect(fresh.vlmJudge).toBe(true);
  });

  it("__resetOversightForTesting brings both back to default-true", () => {
    setPiOversight(false);
    setVLMJudge(false);
    __resetOversightForTesting();
    const s = getOversight();
    expect(s.piOversight).toBe(true);
    expect(s.vlmJudge).toBe(true);
  });
});

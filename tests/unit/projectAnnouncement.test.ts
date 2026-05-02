import { describe, it, expect } from "vitest";
import { applyProjectAnnouncement } from "../../src/server/projectAnnouncement.js";

describe("applyProjectAnnouncement", () => {
  it("does not prepend when no project is focused", () => {
    const r = applyProjectAnnouncement("show me s1 shot 3", undefined, undefined);
    expect(r.task).toBe("show me s1 shot 3");
    expect(r.announcedProject).toBeUndefined();
  });

  it("prepends the announcement on first turn after a project is focused", () => {
    const r = applyProjectAnnouncement("show me s1 shot 3", "noir_detective", undefined);
    expect(r.task.startsWith("(Active project: noir_detective.")).toBe(true);
    expect(r.task).toContain("show me s1 shot 3");
    expect(r.announcedProject).toBe("noir_detective");
  });

  it("does not re-prepend on subsequent turns with the same focused project", () => {
    const r = applyProjectAnnouncement("next question", "noir_detective", "noir_detective");
    expect(r.task).toBe("next question");
    expect(r.announcedProject).toBe("noir_detective");
  });

  it("re-prepends when the focused project changes mid-conversation", () => {
    const r = applyProjectAnnouncement("compare last frame", "chhaya_60s_anime", "noir_detective");
    expect(r.task.startsWith("(Active project: chhaya_60s_anime.")).toBe(true);
    expect(r.task).toContain("compare last frame");
    expect(r.announcedProject).toBe("chhaya_60s_anime");
  });

  it("preserves the user's task body verbatim after the announcement", () => {
    const userText = "what about scene 2?\nI want a brighter look.";
    const r = applyProjectAnnouncement(userText, "noir_detective", undefined);
    expect(r.task.endsWith(userText)).toBe(true);
  });
});

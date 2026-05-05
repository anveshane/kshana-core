/**
 * VLM describer used by the supervisor loop. Pi-agent is always
 * the judge — VLM just turns pixels into a description sentence.
 *
 * Two cases under test:
 *   1. Config missing (VLM_PROVIDER / VLM_API_KEY / VLM_MODEL absent)
 *      → return null AND log a warning ONCE per process.
 *   2. Config present → invoke the injected describer (factory-pattern
 *      so we don't ship a real LLM call into the unit suite) and
 *      return its result.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  describeImageWithVLM,
  __resetVLMWarningForTesting,
} from "../../src/core/llm/describeImageWithVLM.js";

const ENV_KEYS = [
  "VLM_PROVIDER",
  "VLM_API_KEY",
  "VLM_MODEL",
  "VLM_BASE_URL",
] as const;

describe("describeImageWithVLM", () => {
  let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    __resetVLMWarningForTesting();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k]!;
    }
    warnSpy.mockRestore();
  });

  it("returns null when VLM_* env vars are missing AND warns once per process", async () => {
    const result = await describeImageWithVLM("/tmp/foo.png", "a cat");
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT warn a second time on subsequent skips (one-time warning per process)", async () => {
    await describeImageWithVLM("/tmp/foo.png", "a cat");
    await describeImageWithVLM("/tmp/bar.png", "a dog");
    await describeImageWithVLM("/tmp/baz.png", "a hat");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("when config is set, invokes the injected describer and returns its output", async () => {
    process.env["VLM_PROVIDER"] = "openrouter";
    process.env["VLM_API_KEY"] = "sk-test";
    process.env["VLM_MODEL"] = "anthropic/claude-haiku-4.5";

    const fakeDescriber = vi.fn(async (path: string, prompt: string) => {
      expect(path).toBe("/tmp/foo.png");
      expect(prompt).toBe("a cat");
      return "An orange tabby on a windowsill.";
    });

    const result = await describeImageWithVLM(
      "/tmp/foo.png",
      "a cat",
      fakeDescriber,
    );
    expect(result).toBe("An orange tabby on a windowsill.");
    expect(fakeDescriber).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns null and does NOT warn when the describer throws (call failure is not config-missing)", async () => {
    process.env["VLM_PROVIDER"] = "openrouter";
    process.env["VLM_API_KEY"] = "sk-test";
    process.env["VLM_MODEL"] = "anthropic/claude-haiku-4.5";

    const failingDescriber = async () => {
      throw new Error("network blip");
    };
    const result = await describeImageWithVLM(
      "/tmp/foo.png",
      "a cat",
      failingDescriber,
    );
    expect(result).toBeNull();
    // Network failure is operational, not a config issue — don't
    // burn the once-per-process warning slot on it.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

/**
 * VLM endpoint config — pulled from a dedicated env block (VLM_PROVIDER
 * / VLM_API_KEY / VLM_MODEL) instead of piggybacking on the
 * `utility.image_review` LLM-router purpose. Decouples vision-model
 * selection from the rest of the routing system: the user can point
 * VLM at a real vision model (e.g. claude-haiku-4.5, gemini-vision)
 * while keeping the LIGHT tier on a text-only fast model.
 *
 * Returns null when ANY of the three required fields is missing — the
 * caller (ConversationManager / executor) treats null as "skip VLM",
 * not as "fail loudly". One startup-time warning explains why VLM is
 * being skipped.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getVLMConfig } from "../../src/core/llm/getVLMConfig.js";

const ENV_KEYS = [
  "VLM_PROVIDER",
  "VLM_API_KEY",
  "VLM_MODEL",
  "VLM_BASE_URL",
] as const;

describe("getVLMConfig", () => {
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  it("returns null when all VLM_* env vars are absent", () => {
    expect(getVLMConfig()).toBeNull();
  });

  it("returns null when VLM_PROVIDER is missing (provider is required)", () => {
    process.env["VLM_API_KEY"] = "k";
    process.env["VLM_MODEL"] = "m";
    expect(getVLMConfig()).toBeNull();
  });

  it("returns null when VLM_API_KEY is missing", () => {
    process.env["VLM_PROVIDER"] = "openrouter";
    process.env["VLM_MODEL"] = "anthropic/claude-haiku-4.5";
    expect(getVLMConfig()).toBeNull();
  });

  it("returns null when VLM_MODEL is missing", () => {
    process.env["VLM_PROVIDER"] = "openrouter";
    process.env["VLM_API_KEY"] = "k";
    expect(getVLMConfig()).toBeNull();
  });

  it("returns config when all three required fields are set", () => {
    process.env["VLM_PROVIDER"] = "openrouter";
    process.env["VLM_API_KEY"] = "sk-test";
    process.env["VLM_MODEL"] = "anthropic/claude-haiku-4.5";
    const cfg = getVLMConfig();
    expect(cfg).not.toBeNull();
    expect(cfg?.provider).toBe("openrouter");
    expect(cfg?.apiKey).toBe("sk-test");
    expect(cfg?.model).toBe("anthropic/claude-haiku-4.5");
  });

  it("derives baseUrl from provider when VLM_BASE_URL is absent (openrouter case)", () => {
    process.env["VLM_PROVIDER"] = "openrouter";
    process.env["VLM_API_KEY"] = "k";
    process.env["VLM_MODEL"] = "m";
    expect(getVLMConfig()?.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("uses VLM_BASE_URL when provided (overrides the provider default)", () => {
    process.env["VLM_PROVIDER"] = "openai";
    process.env["VLM_API_KEY"] = "k";
    process.env["VLM_MODEL"] = "m";
    process.env["VLM_BASE_URL"] = "https://my.proxy/v1";
    expect(getVLMConfig()?.baseUrl).toBe("https://my.proxy/v1");
  });
});

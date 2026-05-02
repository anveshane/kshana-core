import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./paths.js";

/**
 * In dev/repo, the orchestrator prompt is read from prompts/system/.
 * The packaged desktop build will inline this string at build time and
 * skip the filesystem read; this loader exists only for the dev path.
 */
const PROMPT_PATH = resolve(REPO_ROOT, "prompts/system/pi-orchestrator.md");

export function loadOrchestratorPrompt(): string {
  return readFileSync(PROMPT_PATH, "utf8");
}

export { PROMPT_PATH };

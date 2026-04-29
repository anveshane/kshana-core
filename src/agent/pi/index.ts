import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { kshanaTools } from "./tools/index.js";
import { loadOrchestratorPrompt } from "./prompt.js";
import { ensureDir, getKshanaConfigDir, getProjectsDir } from "./paths.js";

export const kshanaExtension: ExtensionFactory = (pi) => {
  for (const tool of kshanaTools) {
    pi.registerTool(tool);
  }
};

function applyHeavyTierDefaults(argv: string[]): string[] {
  const tierProvider = process.env["LLM_TIER_HEAVY_PROVIDER"];
  const tierModel = process.env["LLM_TIER_HEAVY_MODEL"];
  const tierKey = process.env["LLM_TIER_HEAVY_API_KEY"];

  if (tierProvider === "openrouter" && tierKey && !process.env["OPENROUTER_API_KEY"]) {
    process.env["OPENROUTER_API_KEY"] = tierKey;
  }

  const userPickedProvider = argv.some((a) => a === "--provider");
  const userPickedModel = argv.some((a) => a === "--model" || a.startsWith("--model="));

  const defaults: string[] = [];
  if (!userPickedProvider && tierProvider) {
    defaults.push("--provider", tierProvider);
  }
  if (!userPickedModel && tierModel) {
    defaults.push("--model", tierModel);
  }
  return defaults;
}

function ensureKshanaAgentDir(): string {
  const agentDir = ensureDir(join(getKshanaConfigDir(), "pi-agent"));
  const settingsPath = join(agentDir, "settings.json");
  if (!existsSync(settingsPath)) {
    writeFileSync(
      settingsPath,
      JSON.stringify({ quietStartup: true }, null, 2) + "\n",
      "utf8",
    );
  } else {
    try {
      const current = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
      if (current["quietStartup"] === undefined) {
        current["quietStartup"] = true;
        writeFileSync(settingsPath, JSON.stringify(current, null, 2) + "\n", "utf8");
      }
    } catch {
      // Malformed settings — leave alone so the user can fix.
    }
  }
  return agentDir;
}

export async function bootKshanaTUI(argv: string[] = []): Promise<void> {
  const { main } = await import("@mariozechner/pi-coding-agent");
  const agentDir = ensureKshanaAgentDir();
  if (!process.env["PI_CODING_AGENT_DIR"]) {
    process.env["PI_CODING_AGENT_DIR"] = agentDir;
  }
  const projectsDir = ensureDir(getProjectsDir());
  process.chdir(projectsDir);
  const tierDefaults = applyHeavyTierDefaults(argv);
  const baseArgs = [
    "--system-prompt",
    loadOrchestratorPrompt(),
    ...tierDefaults,
    ...argv,
  ];
  await main(baseArgs, { extensionFactories: [kshanaExtension] });
}

export { kshanaTools };

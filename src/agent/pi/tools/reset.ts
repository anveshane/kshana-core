import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { runScript } from "./runScript.js";

const Params = Type.Object({
  project: Type.String({ description: "Project name" }),
  stage: Type.String({
    description:
      "Stage to reset from. Everything at and after this stage is cleared so the user can re-run with edited inputs.",
  }),
});

export const kshanaReset = defineTool({
  name: "kshana_reset",
  label: "kshana reset",
  description: "Reset a project from a given stage onward. Use before re-running a stage with edited prompts. Does NOT run the pipeline — call kshana_run_to after.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
    return await runScript({
      script: "scripts/reset-project.ts",
      args: [params.project, params.stage],
      signal,
      onUpdate,
    });
  },
});

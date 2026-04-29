import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { runScript } from "./runScript.js";

const Params = Type.Object({
  project: Type.String({ description: "Project name (folder is <project>.kshana)" }),
});

export const kshanaStatus = defineTool({
  name: "kshana_status",
  label: "kshana status",
  description: "Quick snapshot of a kshana project: which stages are done, in progress, or failed. Use this when the user asks 'where is project X at?' — do NOT run the pipeline.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
    return await runScript({
      script: "scripts/project-status.ts",
      args: [params.project],
      signal,
      onUpdate,
    });
  },
});

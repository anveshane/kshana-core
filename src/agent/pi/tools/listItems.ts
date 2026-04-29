import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { runScript } from "./runScript.js";

const Params = Type.Object({
  project: Type.String({ description: "Project name" }),
  type: Type.Optional(
    Type.String({ description: "Filter by node typeId, e.g. shot_image, shot_video_prompt" }),
  ),
  status: Type.Optional(
    Type.String({ description: "Filter by status: pending, running, terminal, failed" }),
  ),
  grep: Type.Optional(
    Type.String({ description: "Regex match against node id" }),
  ),
});

export const kshanaListItems = defineTool({
  name: "kshana_list_items",
  label: "kshana list-items",
  description: "List nodes in a kshana project's dependency graph. Optionally filter by typeId, status, or a regex over node ids.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
    const args = [params.project];
    if (params.type) args.push("--type", params.type);
    if (params.status) args.push("--status", params.status);
    if (params.grep) args.push("--grep", params.grep);
    return await runScript({
      script: "scripts/list-items.ts",
      args,
      signal,
      onUpdate,
    });
  },
});

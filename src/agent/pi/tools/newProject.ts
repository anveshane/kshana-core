import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { runScript } from "./runScript.js";

const Params = Type.Object({
  name: Type.String({ description: "Project name (folder will be <name>.kshana)" }),
  style: Type.Optional(
    Type.String({ description: "Visual style, e.g. cinematic_realism, anime, noir" }),
  ),
  duration: Type.Optional(
    Type.Number({ description: "Target duration in seconds" }),
  ),
  input: Type.Optional(
    Type.String({ description: "Story idea or prompt to seed the project" }),
  ),
  template: Type.Optional(
    Type.String({ description: "Template id, e.g. narrative, infographic" }),
  ),
});

export const kshanaNew = defineTool({
  name: "kshana_new",
  label: "kshana new",
  description: "Create a new kshana project from a story or idea. Sets up the project folder and seeds the dependency graph; does not run the pipeline.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
    const args = [params.name];
    if (params.style) args.push("--style", params.style);
    if (params.duration !== undefined) args.push("--duration", String(params.duration));
    if (params.template) args.push("--template", params.template);
    if (params.input) args.push("--input", params.input);
    return await runScript({
      script: "scripts/new-project.ts",
      args,
      signal,
      onUpdate,
    });
  },
});

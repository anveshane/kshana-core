import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { runScript } from "./runScript.js";

const Params = Type.Object({
  project: Type.String({ description: "Project name" }),
  stage: Type.Optional(
    Type.String({
      description:
        "Stage to pause at, e.g. character_image, shot_image, shot_video. Or a node id like shot_image:scene_1_shot_2. Omit to run to completion.",
    }),
  ),
  skip_media: Type.Optional(
    Type.Boolean({ description: "Skip ComfyUI image/video generation; only run LLM prompt stages." }),
  ),
});

export const kshanaRunTo = defineTool({
  name: "kshana_run_to",
  label: "kshana run-to",
  description: "Drive the kshana pipeline on a project up to a stage (or to completion). Long-running. Streams progress as each node completes.",
  parameters: Params,
  executionMode: "sequential",
  async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
    const args = [params.project];
    if (params.stage) args.push(params.stage);
    if (params.skip_media) args.push("--skip-media");
    return await runScript({
      script: "scripts/run-to.ts",
      args,
      signal,
      onUpdate,
    });
  },
});

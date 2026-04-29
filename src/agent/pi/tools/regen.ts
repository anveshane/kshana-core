import { Type, type Static } from "typebox";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { runScript } from "./runScript.js";
import type { MediaCallback } from "./runTo.js";

const Params = Type.Object({
  project: Type.String({ description: "Project name" }),
  node: Type.String({
    description:
      "Node id (e.g. 'shot_image:scene_2_shot_3') or friendly alias ('scene_2_shot_3.image', 'scene_2.svp'). The .prompt / .image / .video / .motion / .svp suffixes map to the corresponding pipeline stage.",
  }),
  cascade: Type.Optional(
    Type.Boolean({
      description:
        "When true, every transitively downstream node is also invalidated. Use when the change is upstream and downstream artifacts must propagate.",
    }),
  ),
  no_run: Type.Optional(
    Type.Boolean({
      description:
        "When true, just invalidates and exits without re-running. Default false: invalidate + run-to final_video so the user sees the regenerated artifact.",
    }),
  ),
});

export function createRegenTool(opts?: { onMedia?: MediaCallback }): ToolDefinition {
  return defineTool({
    name: "kshana_regen",
    label: "kshana regen",
    description:
      "Regenerate a specific node and its downstream artifacts. Use after editing a prompt file (e.g. 'I edited s1 shot 3's last-frame imagePrompt — now regen kshana_regen project=X node=shot_image:scene_1_shot_3'). Long-running; streams progress as nodes complete.",
    parameters: Params,
    executionMode: "sequential",
    async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
      const args = [params.project, params.node];
      if (params.cascade) args.push("--cascade");
      if (params.no_run) args.push("--no-run");
      return await runScript({
        script: "scripts/regen-node.ts",
        args,
        signal,
        onUpdate,
        ...(opts?.onMedia
          ? {
              onAsset: (e) =>
                opts.onMedia!({ ...e, project: params.project, source: "kshana_regen" }),
            }
          : {}),
      });
    },
  });
}

export const kshanaRegen: ToolDefinition = createRegenTool();

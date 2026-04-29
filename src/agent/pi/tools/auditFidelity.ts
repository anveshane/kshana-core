import { Type, type Static } from "typebox";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { runScript } from "./runScript.js";
import type { MediaCallback } from "./runTo.js";

const Params = Type.Object({
  project: Type.String({ description: "Project name" }),
});

export function createAuditFidelityTool(opts?: { onMedia?: MediaCallback }): ToolDefinition {
  return defineTool({
    name: "kshana_audit_fidelity",
    label: "kshana audit-fidelity",
    description:
      "Run the VLM judge over a project's generated images and score each against the prompt that produced it. Long-running. Use to spot regressions after a re-run.",
    parameters: Params,
    executionMode: "sequential",
    async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
      return await runScript({
        script: "scripts/audit-fidelity.ts",
        args: [params.project],
        signal,
        onUpdate,
        ...(opts?.onMedia
          ? {
              onAsset: (e) =>
                opts.onMedia!({ ...e, project: params.project, source: "kshana_audit_fidelity" }),
            }
          : {}),
      });
    },
  });
}

export const kshanaAuditFidelity: ToolDefinition = createAuditFidelityTool();

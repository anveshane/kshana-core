import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  resetProjectStage,
  ResetProjectError,
} from "../../../server/runners/resetProjectStage.js";
import { getProjectsDir } from "../paths.js";

const Params = Type.Object({
  project: Type.String({ description: "Project name" }),
  stage: Type.String({
    description:
      "Stage to reset from. Everything at and after this stage is cleared so the user can re-run with edited inputs.",
  }),
  clean: Type.Optional(
    Type.Boolean({
      description:
        "Wipe executorState entirely before applying the reset (graph rebuilds from scratch on next run). Use when prior runs left stale per-item nodes.",
    }),
  ),
});

export interface ResetDetails {
  status: "completed" | "failed";
  log: string;
  resetCount?: number;
  removedCount?: number;
  schemaCleared?: number;
  schemaShotsAffected?: number;
  remainingNodes?: number;
  completedNodes?: number;
  pendingNodes?: number;
  resetTypes?: string[];
}

function failure(message: string): AgentToolResult<ResetDetails> {
  return {
    content: [{ type: "text", text: message }],
    details: { status: "failed", log: message },
  };
}

export const kshanaReset = defineTool({
  name: "kshana_reset",
  label: "kshana reset",
  description:
    "Reset a project from a given stage onward. Use before re-running a stage with edited prompts. Does NOT run the pipeline — call kshana_run_to after.",
  parameters: Params,
  async execute(
    _id,
    params: Static<typeof Params>,
    _signal,
    onUpdate,
  ): Promise<AgentToolResult<ResetDetails>> {
    const logLines: string[] = [];
    const pushLog = (line: string): void => {
      logLines.push(line);
      onUpdate?.({
        content: [{ type: "text", text: line }],
        details: { status: "completed", log: logLines.join("\n") },
      });
    };

    try {
      const result = resetProjectStage({
        basePath: getProjectsDir(),
        projectName: params.project,
        stage: params.stage,
        ...(params.clean ? { clean: true } : {}),
        onLog: pushLog,
      });

      const text = result.log.join("\n");
      return {
        content: [{ type: "text", text }],
        details: {
          status: "completed",
          log: text,
          resetCount: result.resetCount,
          removedCount: result.removedCount,
          schemaCleared: result.schemaCleared,
          schemaShotsAffected: result.schemaShotsAffected,
          remainingNodes: result.remainingNodes,
          completedNodes: result.completedNodes,
          pendingNodes: result.pendingNodes,
          resetTypes: result.resetTypes,
        },
      };
    } catch (err) {
      const message =
        err instanceof ResetProjectError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return failure(`Reset failed: ${message}`);
    }
  },
});

import { Type, type Static } from "typebox";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { regenNodes, persistProject, type ProjectFile } from "../../../server/agentOps.js";
import { runExecutor } from "../../../server/runners/runExecutor.js";
import { getProjectsDir } from "../paths.js";
import type { GenericProjectFile } from "../../../core/templates/types.js";
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

interface RegenDetails {
  status: string;
  log: string;
  changed: string[];
  notFound: string[];
}

function failure(message: string): { content: { type: "text"; text: string }[]; details: RegenDetails } {
  return {
    content: [{ type: "text", text: message }],
    details: { status: "failed", log: message, changed: [], notFound: [] },
  };
}

export function createRegenTool(opts?: { onMedia?: MediaCallback }): ToolDefinition {
  return defineTool({
    name: "kshana_regen",
    label: "kshana regen",
    description:
      "Regenerate a specific node and its downstream artifacts. Use after editing a prompt file (e.g. 'I edited s1 shot 3's last-frame imagePrompt — now regen kshana_regen project=X node=shot_image:scene_1_shot_3'). Long-running; streams progress as nodes complete.",
    parameters: Params,
    executionMode: "sequential",
    async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
      const projectDir = resolve(getProjectsDir(), `${params.project}.kshana`);
      if (!existsSync(projectDir)) return failure(`Project not found: ${projectDir}`);
      const projectJsonPath = join(projectDir, "project.json");
      if (!existsSync(projectJsonPath)) return failure(`project.json not found in ${projectDir}`);
      const project = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as ProjectFile;

      // 1. Invalidate the node (and optionally its downstream).
      const regen = regenNodes(project, [params.node], {
        ...(params.cascade ? { cascade: true } : {}),
      });
      if (regen.changed.length === 0 && regen.notFound.length > 0) {
        return failure(`Could not resolve node: ${regen.notFound.join(", ")}`);
      }
      persistProject(projectDir, project);

      const invalidationLog = `Invalidated ${regen.changed.length} node(s): ${regen.changed.join(", ")}${
        regen.notFound.length > 0 ? ` (not found: ${regen.notFound.join(", ")})` : ""
      }`;

      if (params.no_run) {
        return {
          content: [{ type: "text", text: invalidationLog }],
          details: { status: "completed", log: invalidationLog, changed: regen.changed, notFound: regen.notFound },
        };
      }

      // 2. Re-run the executor to regenerate downstream.
      const logLines = [invalidationLog];
      const pushLog = (line: string) => {
        logLines.push(line);
        onUpdate?.({
          content: [{ type: "text", text: line }],
          details: { status: "running", log: logLines.join("\n"), changed: regen.changed, notFound: regen.notFound },
        });
      };

      const result = await runExecutor({
        project: project as unknown as GenericProjectFile,
        projectDir,
        target: {},
        ...(signal ? { signal } : {}),
        name: "pi-agent-regen",
        onTool: (info) => {
          const hint = info.nodeId ? ` ${info.nodeId}` : "";
          pushLog(`  [${info.toolName}]${hint}`);
        },
        onResult: (info) => {
          if (info.filePath) pushLog(`    → ${info.filePath}`);
          else if (info.status) pushLog(`    → ${info.status}`);
        },
        onNotification: (info) => {
          pushLog(`  [${info.level}] ${info.message}`);
        },
        ...(opts?.onMedia
          ? {
              onAsset: (event) => {
                opts.onMedia!({
                  kind: event.kind,
                  path: event.filePath,
                  project: params.project,
                  source: "kshana_regen",
                });
              },
            }
          : {}),
      });

      const summary =
        result.status === "completed"
          ? `Regen finished. status=${result.status} stopReason=${result.stopReason ?? "(none)"}`
          : result.status === "cancelled"
            ? `Regen cancelled by user.`
            : `Regen failed. status=${result.status} stopReason=${result.stopReason ?? "(none)"}${result.error ? ` error=${result.error}` : ""}`;
      logLines.push(summary);
      return {
        content: [{ type: "text", text: summary }],
        details: { status: result.status, log: logLines.join("\n"), changed: regen.changed, notFound: regen.notFound },
      };
    },
  });
}

export const kshanaRegen: ToolDefinition = createRegenTool();

import { Type, type Static } from "typebox";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runExecutor } from "../../../server/runners/runExecutor.js";
import { classifyRunTarget } from "../../../server/runners/classifyRunTarget.js";
import { resolveNodeId, type ExecutorState } from "../../../core/project/projectTypes.js";
import { getProjectsDir } from "../paths.js";
import type { GenericProjectFile } from "../../../core/templates/types.js";
import type { AssetEvent } from "./parseAssetLines.js";

export interface MediaEvent extends AssetEvent {
  /** Project name (no .kshana suffix) — captured from the tool params. */
  project: string;
  /** Tool that produced this asset, for downstream display. */
  source: string;
}

export type MediaCallback = (event: MediaEvent) => void;

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

interface RunToDetails {
  status: string;
  stopReason: string | null;
  log: string;
}

function failure(message: string): { content: { type: "text"; text: string }[]; details: RunToDetails } {
  return {
    content: [{ type: "text", text: message }],
    details: { status: "failed", stopReason: null, log: message },
  };
}

export function createRunToTool(opts?: { onMedia?: MediaCallback }): ToolDefinition {
  return defineTool({
    name: "kshana_run_to",
    label: "kshana run-to",
    description:
      "Drive the kshana pipeline on a project up to a stage (or to completion). Long-running. Streams progress as each node completes; generated images and videos are surfaced as standalone events in chat as they appear.",
    parameters: Params,
    executionMode: "sequential",
    async execute(_id, params: Static<typeof Params>, signal, onUpdate) {
      const projectDir = resolve(getProjectsDir(), `${params.project}.kshana`);
      if (!existsSync(projectDir)) return failure(`Project not found: ${projectDir}`);
      const projectJsonPath = join(projectDir, "project.json");
      if (!existsSync(projectJsonPath)) return failure(`project.json not found in ${projectDir}`);
      const project = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as GenericProjectFile;

      // Resolve target. Aliases (`scene_1_shot_2.image`) need the
      // project's executorState; bare stages and full node ids don't.
      let resolvedTarget: { stage?: string; nodeId?: string };
      try {
        const classified = classifyRunTarget(params.stage ?? null);
        if (classified.alias) {
          const state = (project as unknown as { executorState?: ExecutorState }).executorState;
          if (!state) {
            return failure(
              `Cannot resolve alias '${classified.alias}' — project has no executorState yet. Run kshana_run_to without a target first to bootstrap.`,
            );
          }
          const resolved = resolveNodeId(state, classified.alias);
          if (!resolved) {
            return failure(
              `Unknown alias: '${classified.alias}'. No matching node in this project's graph.`,
            );
          }
          resolvedTarget = { nodeId: resolved };
        } else {
          resolvedTarget = {
            ...(classified.stage ? { stage: classified.stage } : {}),
            ...(classified.nodeId ? { nodeId: classified.nodeId } : {}),
          };
        }
      } catch (err) {
        return failure((err as Error).message);
      }

      // Stream progress text via onUpdate so chat shows live status.
      const logLines: string[] = [];
      const pushLog = (line: string) => {
        logLines.push(line);
        onUpdate?.({
          content: [{ type: "text", text: line }],
          details: { status: "running", stopReason: null, log: logLines.join("\n") },
        });
      };

      const result = await runExecutor({
        project,
        projectDir,
        target: { ...resolvedTarget, ...(params.skip_media ? { skipMedia: true } : {}) },
        ...(signal ? { signal } : {}),
        name: "pi-agent-run-to",
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
                  source: "kshana_run_to",
                });
              },
            }
          : {}),
      });

      const summary =
        result.status === "completed"
          ? `Run finished. status=${result.status} stopReason=${result.stopReason ?? "(none)"}`
          : result.status === "cancelled"
            ? `Run cancelled by user.`
            : `Run failed. status=${result.status} stopReason=${result.stopReason ?? "(none)"}${result.error ? ` error=${result.error}` : ""}`;
      logLines.push(summary);

      return {
        content: [{ type: "text", text: summary }],
        details: {
          status: result.status,
          stopReason: result.stopReason,
          log: logLines.join("\n"),
        },
      };
    },
  });
}

/** Backwards-compatible export used by the TUI / smoke paths (no media bridge). */
export const kshanaRunTo: ToolDefinition = createRunToTool();

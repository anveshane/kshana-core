import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeStatus, type ProjectFile, type StatusSummary } from "../../../server/agentOps.js";
import { getProjectsDir } from "../paths.js";

const Params = Type.Object({
  project: Type.String({ description: "Project name (folder is <project>.kshana)" }),
});

export interface StatusDetails {
  status: string;
  summary?: StatusSummary;
  log: string;
}

function failure(message: string): { content: { type: "text"; text: string }[]; details: StatusDetails } {
  return {
    content: [{ type: "text", text: message }],
    details: { status: "failed", log: message },
  };
}

function formatSummary(s: StatusSummary): string {
  const lines: string[] = [];
  lines.push(`Project: ${s.title}`);
  if (s.style) lines.push(`Style: ${s.style}`);
  if (s.targetDuration !== undefined) lines.push(`Target duration: ${s.targetDuration}s`);
  if (s.inputType) lines.push(`Input type: ${s.inputType}`);
  if (s.templateId) lines.push(`Template: ${s.templateId}`);
  if (s.currentPhase) lines.push(`Current phase: ${s.currentPhase}`);
  lines.push(`Total nodes: ${s.totalNodes}`);
  lines.push(
    `Counts: completed=${s.counts.completed} pending=${s.counts.pending} failed=${s.counts.failed} running=${s.counts.running} skipped=${s.counts.skipped}`,
  );
  if (s.failedNodes.length > 0) {
    lines.push(`Failed nodes:`);
    for (const f of s.failedNodes.slice(0, 10)) lines.push(`  ${f.id}: ${f.error}`);
    if (s.failedNodes.length > 10) lines.push(`  …and ${s.failedNodes.length - 10} more`);
  }
  return lines.join("\n");
}

export const kshanaStatus = defineTool({
  name: "kshana_status",
  label: "kshana status",
  description:
    "Quick snapshot of a kshana project: which stages are done, in progress, or failed. Use this when the user asks 'where is project X at?' — do NOT run the pipeline.",
  parameters: Params,
  async execute(_id, params: Static<typeof Params>) {
    const projectDir = resolve(getProjectsDir(), `${params.project}.kshana`);
    if (!existsSync(projectDir)) return failure(`Project not found: ${projectDir}`);
    const projectJsonPath = join(projectDir, "project.json");
    if (!existsSync(projectJsonPath)) return failure(`project.json not found in ${projectDir}`);
    const project = JSON.parse(readFileSync(projectJsonPath, "utf-8")) as ProjectFile;
    const summary = computeStatus(project);
    const text = formatSummary(summary);
    return {
      content: [{ type: "text", text }],
      details: { status: "completed", summary, log: text },
    };
  },
});

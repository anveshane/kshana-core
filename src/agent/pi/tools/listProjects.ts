import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { getProjectsDir } from "../paths.js";

const Params = Type.Object({});

export interface ProjectSummary {
  name: string;
  title?: string;
  style?: string;
  phase?: string;
  templateId?: string;
  hasProjectJson: boolean;
}

export interface ListProjectsDetails {
  count: number;
  projects: ProjectSummary[];
}

export const kshanaListProjects = defineTool({
  name: "kshana_list_projects",
  label: "kshana list-projects",
  description: "List all kshana projects in the repo (folders matching *.kshana). Returns each project's name, current phase, style, and title where available.",
  parameters: Params,
  async execute(_id, _params: Static<typeof Params>): Promise<AgentToolResult<ListProjectsDetails>> {
    const entries = await readdir(getProjectsDir(), { withFileTypes: true });
    const projectDirs = entries
      .filter((e) => e.isDirectory() && e.name.endsWith(".kshana"))
      .map((e) => e.name)
      .sort();

    const summaries: ProjectSummary[] = [];
    for (const dirname of projectDirs) {
      const name = dirname.replace(/\.kshana$/, "");
      const projectJson = join(getProjectsDir(), dirname, "project.json");
      let summary: ProjectSummary = { name, hasProjectJson: false };
      try {
        await stat(projectJson);
        const raw = await readFile(projectJson, "utf8");
        const parsed = JSON.parse(raw) as {
          title?: string;
          style?: string;
          currentPhase?: string;
          templateId?: string;
        };
        summary = {
          name,
          title: parsed.title,
          style: parsed.style,
          phase: parsed.currentPhase,
          templateId: parsed.templateId,
          hasProjectJson: true,
        };
      } catch {
        // No project.json or unparseable — keep minimal summary.
      }
      summaries.push(summary);
    }

    const text = formatSummaries(summaries);
    return {
      content: [{ type: "text", text }],
      details: { count: summaries.length, projects: summaries },
    };
  },
});

function formatSummaries(projects: ProjectSummary[]): string {
  if (projects.length === 0) {
    return "No kshana projects found in the repo root.";
  }
  const lines = [`Found ${projects.length} project(s):`, ""];
  for (const p of projects) {
    const tag = p.hasProjectJson ? "" : " (no project.json — bare folder)";
    const meta = [
      p.title ? `title: ${p.title}` : null,
      p.style ? `style: ${p.style}` : null,
      p.templateId ? `template: ${p.templateId}` : null,
      p.phase ? `phase: ${p.phase}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`  ${p.name}${tag}${meta ? `\n      ${meta}` : ""}`);
  }
  return lines.join("\n");
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { getProjectsDir } from "../paths.js";

interface ManifestEntry {
  id: string;
  type: string;
  path: string;
  scene_number?: number;
  version?: number;
  createdAt: number;
  nodeId?: string;
  metadata?: Record<string, unknown>;
}

export interface ShowDetails {
  /** Path relative to <project>.kshana/. The frontend renders inline when this matches an image/video extension. */
  file_path: string;
  asset_id: string;
  asset_type: string;
  created_at: number;
}

async function loadManifest(projectName: string): Promise<ManifestEntry[]> {
  const path = join(getProjectsDir(), `${projectName}.kshana`, "assets", "manifest.json");
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as { assets?: ManifestEntry[] };
  return parsed.assets ?? [];
}

function pickLatest(entries: ManifestEntry[]): ManifestEntry | undefined {
  return [...entries].sort((a, b) => b.createdAt - a.createdAt)[0];
}

function shotFilenamePrefix(scene: number, shot: number): string {
  return `s${scene}shot${shot}_`;
}

function buildShowResult(
  entry: ManifestEntry | undefined,
  notFoundMessage: string,
): AgentToolResult<ShowDetails | { found: false }> {
  if (!entry) {
    return {
      content: [{ type: "text", text: notFoundMessage }],
      details: { found: false },
    };
  }
  return {
    content: [{ type: "text", text: `${entry.path} (created ${new Date(entry.createdAt).toISOString()})` }],
    details: {
      file_path: entry.path,
      asset_id: entry.id,
      asset_type: entry.type,
      created_at: entry.createdAt,
    },
  };
}

const ShotFrameParams = Type.Object({
  project: Type.String({ description: "Project name" }),
  scene: Type.Number({ description: "Scene number, e.g. 1" }),
  shot: Type.Number({ description: "Shot number within the scene, e.g. 2" }),
});

export const kshanaShowFirstFrame = defineTool({
  name: "kshana_show_first_frame",
  label: "kshana show first-frame",
  description: "Show the latest generated first-frame image for a specific shot. Returns the path under the project's assets/ folder so the chat renders the image inline.",
  parameters: ShotFrameParams,
  async execute(_id, params: Static<typeof ShotFrameParams>) {
    const entries = await loadManifest(params.project);
    const prefix = shotFilenamePrefix(params.scene, params.shot);
    const matches = entries.filter(
      (e) => e.type === "scene_image" && e.path.includes(`${prefix}first_frame`),
    );
    return buildShowResult(
      pickLatest(matches),
      `No first-frame image found for scene ${params.scene} shot ${params.shot} in '${params.project}'. The shot may not have been generated yet — try kshana_status to see which stage the project is at.`,
    );
  },
});

export const kshanaShowLastFrame = defineTool({
  name: "kshana_show_last_frame",
  label: "kshana show last-frame",
  description: "Show the latest generated last-frame image for a specific shot. Returns the path so the chat renders the image inline.",
  parameters: ShotFrameParams,
  async execute(_id, params: Static<typeof ShotFrameParams>) {
    const entries = await loadManifest(params.project);
    const prefix = shotFilenamePrefix(params.scene, params.shot);
    const matches = entries.filter(
      (e) => e.type === "scene_image" && e.path.includes(`${prefix}last_frame`),
    );
    return buildShowResult(
      pickLatest(matches),
      `No last-frame image found for scene ${params.scene} shot ${params.shot} in '${params.project}'.`,
    );
  },
});

export const kshanaShowShotVideo = defineTool({
  name: "kshana_show_shot_video",
  label: "kshana show shot-video",
  description: "Show the latest rendered shot video clip for a specific shot. Returns the path so the chat renders the <video> inline.",
  parameters: ShotFrameParams,
  async execute(_id, params: Static<typeof ShotFrameParams>) {
    const entries = await loadManifest(params.project);
    const prefix = shotFilenamePrefix(params.scene, params.shot);
    const matches = entries.filter(
      (e) => e.type === "scene_video" && e.path.includes(prefix),
    );
    return buildShowResult(
      pickLatest(matches),
      `No video clip found for scene ${params.scene} shot ${params.shot} in '${params.project}'. The shot's video may not have been generated yet.`,
    );
  },
});

const FinalVideoParams = Type.Object({
  project: Type.String({ description: "Project name" }),
});

export const kshanaShowFinalVideo = defineTool({
  name: "kshana_show_final_video",
  label: "kshana show final-video",
  description: "Show the assembled final video for a project. Returns the path so the chat renders the <video> inline.",
  parameters: FinalVideoParams,
  async execute(_id, params: Static<typeof FinalVideoParams>) {
    const entries = await loadManifest(params.project);
    const matches = entries.filter((e) => e.type === "final_video");
    return buildShowResult(
      pickLatest(matches),
      `No final video found for '${params.project}'. The pipeline may not have reached final assembly — try kshana_status.`,
    );
  },
});

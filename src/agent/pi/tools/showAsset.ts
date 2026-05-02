import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { defineTool } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { getProjectsDir } from "../paths.js";
import { findShot } from "../../../core/project/projectSchema.js";

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

async function loadProject(projectName: string): Promise<Record<string, unknown> | null> {
  try {
    const path = join(getProjectsDir(), `${projectName}.kshana`, "project.json");
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadManifest(projectName: string): Promise<ManifestEntry[]> {
  try {
    const path = join(getProjectsDir(), `${projectName}.kshana`, "assets", "manifest.json");
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { assets?: ManifestEntry[] };
    return parsed.assets ?? [];
  } catch {
    return [];
  }
}

function pickLatest(entries: ManifestEntry[]): ManifestEntry | undefined {
  return [...entries].sort((a, b) => b.createdAt - a.createdAt)[0];
}

function shotFilenamePrefix(scene: number, shot: number): string {
  return `s${scene}shot${shot}_`;
}

function frameResult(
  ref: { path: string; createdAt: number } | undefined,
  notFound: string,
): AgentToolResult<ShowDetails | { found: false }> {
  if (!ref) return { content: [{ type: "text", text: notFound }], details: { found: false } };
  return {
    content: [{ type: "text", text: `${ref.path} (created ${new Date(ref.createdAt).toISOString()})` }],
    details: {
      file_path: ref.path,
      asset_id: ref.path,
      asset_type: "scene_image",
      created_at: ref.createdAt,
    },
  };
}

function manifestResult(
  entry: ManifestEntry | undefined,
  notFound: string,
): AgentToolResult<ShowDetails | { found: false }> {
  if (!entry) return { content: [{ type: "text", text: notFound }], details: { found: false } };
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
  description:
    "Show the latest generated first-frame image for a specific shot. Reads from project.json's scenes tree first, falls back to the manifest for legacy projects.",
  parameters: ShotFrameParams,
  async execute(_id, params: Static<typeof ShotFrameParams>) {
    const project = await loadProject(params.project);
    const shot = project ? findShot(project, params.scene, params.shot) : undefined;
    if (shot?.firstFrame) {
      return frameResult(shot.firstFrame, "");
    }
    // Fallback to manifest filename heuristic.
    const entries = await loadManifest(params.project);
    const prefix = shotFilenamePrefix(params.scene, params.shot);
    const matches = entries.filter(
      (e) => e.type === "scene_image" && e.path.includes(`${prefix}first_frame`),
    );
    return manifestResult(
      pickLatest(matches),
      `No first-frame image found for scene ${params.scene} shot ${params.shot} in '${params.project}'.`,
    );
  },
});

export const kshanaShowLastFrame = defineTool({
  name: "kshana_show_last_frame",
  label: "kshana show last-frame",
  description:
    "Show the latest generated last-frame image for a specific shot. Reads from project.json's scenes tree first, falls back to the manifest.",
  parameters: ShotFrameParams,
  async execute(_id, params: Static<typeof ShotFrameParams>) {
    const project = await loadProject(params.project);
    const shot = project ? findShot(project, params.scene, params.shot) : undefined;
    if (shot?.lastFrame) {
      return frameResult(shot.lastFrame, "");
    }
    const entries = await loadManifest(params.project);
    const prefix = shotFilenamePrefix(params.scene, params.shot);
    const matches = entries.filter(
      (e) => e.type === "scene_image" && e.path.includes(`${prefix}last_frame`),
    );
    return manifestResult(
      pickLatest(matches),
      `No last-frame image found for scene ${params.scene} shot ${params.shot} in '${params.project}'.`,
    );
  },
});

export const kshanaShowShotVideo = defineTool({
  name: "kshana_show_shot_video",
  label: "kshana show shot-video",
  description:
    "Show the latest rendered shot video clip. Reads from project.json's scenes tree first, falls back to the manifest.",
  parameters: ShotFrameParams,
  async execute(_id, params: Static<typeof ShotFrameParams>) {
    const project = await loadProject(params.project);
    const shot = project ? findShot(project, params.scene, params.shot) : undefined;
    if (shot?.video) {
      return {
        content: [{ type: "text", text: `${shot.video.path} (created ${new Date(shot.video.createdAt).toISOString()})` }],
        details: {
          file_path: shot.video.path,
          asset_id: shot.video.path,
          asset_type: "scene_video",
          created_at: shot.video.createdAt,
        },
      };
    }
    const entries = await loadManifest(params.project);
    const prefix = shotFilenamePrefix(params.scene, params.shot);
    const matches = entries.filter(
      (e) => e.type === "scene_video" && e.path.includes(prefix),
    );
    return manifestResult(
      pickLatest(matches),
      `No video clip found for scene ${params.scene} shot ${params.shot} in '${params.project}'.`,
    );
  },
});

const FinalVideoParams = Type.Object({
  project: Type.String({ description: "Project name" }),
});

export const kshanaShowFinalVideo = defineTool({
  name: "kshana_show_final_video",
  label: "kshana show final-video",
  description:
    "Show the assembled final video for a project. Reads project.finalVideo first, falls back to manifest.",
  parameters: FinalVideoParams,
  async execute(_id, params: Static<typeof FinalVideoParams>) {
    const project = await loadProject(params.project);
    const finalVideo = project?.["finalVideo"] as { path: string; createdAt: number } | undefined;
    if (finalVideo) {
      return {
        content: [{ type: "text", text: `${finalVideo.path} (created ${new Date(finalVideo.createdAt).toISOString()})` }],
        details: {
          file_path: finalVideo.path,
          asset_id: finalVideo.path,
          asset_type: "final_video",
          created_at: finalVideo.createdAt,
        },
      };
    }
    const entries = await loadManifest(params.project);
    const matches = entries.filter((e) => e.type === "final_video");
    return manifestResult(
      pickLatest(matches),
      `No final video found for '${params.project}'.`,
    );
  },
});

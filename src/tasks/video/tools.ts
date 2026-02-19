/**
 * Video generation tools for the video creation task.
 * These tools integrate with ComfyUI for actual image/video generation.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getProjectFileOps } from '../../server/ProjectFileOps.js';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { bundle } from '@remotion/bundler';
import { createTool } from '../../core/tools/index.js';
import type { ToolDefinition, ToolContext } from '../../core/llm/index.js';
import {
  ComfyUIClient,
  loadWorkflowTemplate,
  parameterizeWorkflowByName,
  parameterizeLtxT2VWorkflow,
  getRegistry,
} from '../../services/comfyui/index.js';
import {
  PROJECT_DIR,
  AGENT_DIR,
  addAsset,
  loadProject,
  saveProject,
  updatePhaseStatus,
  transitionToNextPhase,
  updateCharacter,
  updateSetting,
  updateScene,
  getProjectStyleConfig,
  STYLE_CONFIGS,
  WorkflowPhase,
  type ProjectFile,
  type BackgroundGenerationState,
  type BackgroundGenerationBatch,
  type BackgroundGenerationBatchStatus,
  type BackgroundGenerationItem,
  type BackgroundGenerationKind,
  getAgentDir,
  getAssets,
  readProjectFile,
  writeProjectFile,
  getCurrentProjectBasePath,
  getManifestFilePath,
} from './workflow/index.js';
import { parseImagePlacementsWithErrors, type ParsedImagePlacement } from './workflow/imagePlacementsParser.js';
import { parseVideoPlacementsWithErrors, type ParsedVideoPlacement } from './workflow/videoPlacementsParser.js';
import { parseInfographicPlacementsWithErrors, type ParsedInfographicPlacement } from './workflow/infographicPlacementsParser.js';
import { validatePlacementSets } from './workflow/PlacementValidator.js';
import { getTranscriptSegmentForTimeRange } from './workflow/transcriptSegment.js';
import { expandImagePlacementPrompt, expandVideoPlacementPrompt } from './workflow/placementPromptExpander.js';
import { expandInfographicPlacementPrompt } from './workflow/infographicPromptExpander.js';
import {
  deriveVideoMetadata,
  formatVideoMetadataMarkdown,
  normalizeVideoMetadata,
  parseVideoMetadataJson,
  parseVideoMetadataMarkdown,
  type VideoMetadata,
} from './workflow/videoMetadataParser.js';
import {
  applyPromptContextGuard,
  appendMetadataConstraintsToNegativePrompt,
} from './workflow/promptContextGuard.js';
import { loadRemotionSkillsForInfographicType } from '../../core/prompts/loader.js';
import { buildVideoMetadataPrompt } from '../../core/prompts/index.js';
import { getLLMConfig, LLMClient, validateLLMConfig } from '../../core/llm/index.js';
import { assetEventEmitter } from '../../server/assetEventEmitter.js';
import type { ComponentCode } from './remotionAgent.js';

/** Callback to run the Remotion sub-agent (placements + skills -> component code). Injected when creating the tool. */
export type RunRemotionAgentCallback = (
  placements: ParsedInfographicPlacement[],
  skillsContent: string,
  options?: {
    userMessageSuffix?: string;
    failedPlacementNumber?: number;
    failedComponentName?: string;
    retryAttempt?: number;
  }
) => Promise<ComponentCode>;

/**
 * Context for linking artifacts to project entities.
 */
export interface ArtifactContext {
  /** Type of entity this artifact belongs to */
  entityType: 'scene' | 'character' | 'setting';
  /** Scene number (for scene images/videos) */
  sceneNumber?: number;
  /** Character name (for character reference images) */
  characterName?: string;
  /** Setting name (for setting reference images) */
  settingName?: string;
  /** Whether this is an image or video artifact */
  artifactType: 'image' | 'video';
}

/**
 * Job status for async generation tasks.
 */
export interface GenerationJob {
  id: string;
  type: 'image' | 'video';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: {
    artifactId: string;
    url?: string;
    path?: string;
  };
  error?: string;
  createdAt: number;
  updatedAt: number;
  promptId?: string; // ComfyUI prompt ID
  /** Context for linking artifact to project */
  context?: ArtifactContext;
}

/**
 * Reference image for consistency in scene generation.
 */
export interface ReferenceImage {
  /** Artifact ID or path to the reference image */
  image_id: string;
  /** Type of reference: character or setting */
  type: 'character' | 'setting';
  /** Name of the character or setting this references */
  name: string;
}

/**
 * Image generation parameters.
 */
export interface ImageGenerationParams {
  scene_number: number;
  prompt: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  seed?: number;
  image_type?: 'scene' | 'character_ref' | 'setting_ref';
  character_name?: string;
  setting_name?: string;
  /** Reference images for consistency (used for scene generation) */
  reference_images?: ReferenceImage[];
  /** Generation mode: text-to-image or image+text-to-image */
  generation_mode?: 'text_to_image' | 'image_text_to_image';
}

const AUTO_GAP_PREFIX = 'AUTO GAP:';
const GAP_MIN_SECONDS = 1;
const GAP_ADJACENT_EPSILON = 0.01;
const VIDEO_METADATA_JSON_PATH = 'agent/metadata/video-context.json';
const VIDEO_METADATA_MARKDOWN_PATH = 'agent/metadata/video-context.md';

function timeStringToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0] ?? '0', 10) || 0;
    const minutes = parseInt(parts[1] ?? '0', 10) || 0;
    const seconds = parseInt(parts[2] ?? '0', 10) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (parts.length === 2) {
    const minutes = parseInt(parts[0] ?? '0', 10) || 0;
    const seconds = parseInt(parts[1] ?? '0', 10) || 0;
    return minutes * 60 + seconds;
  }
  return parseInt(timeStr, 10) || 0;
}

function formatTimeSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function parseTranscriptDurationSeconds(transcriptContent: string | null): number {
  if (!transcriptContent || !transcriptContent.trim()) return 0;
  const lines = transcriptContent.split(/\r?\n/);
  let maxEnd = 0;
  for (const line of lines) {
    const match = line.match(/\[(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\]/);
    if (!match || !match[2]) continue;
    const timeMatch = match[2].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
    if (!timeMatch) continue;
    const [, hh, mm, ss, ms] = timeMatch;
    const endSeconds =
      Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000;
    if (endSeconds > maxEnd) maxEnd = endSeconds;
  }
  return maxEnd;
}

interface TimeInterval {
  start: number;
  end: number;
}

function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: TimeInterval[] = [];
  let current = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (next.start <= current.end + GAP_ADJACENT_EPSILON) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

function collectIntervalsFromPlacements(
  placements: Array<{ startTime: string; endTime: string }>,
): TimeInterval[] {
  const intervals: TimeInterval[] = [];
  for (const placement of placements) {
    const start = timeStringToSeconds(placement.startTime);
    const end = timeStringToSeconds(placement.endTime);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      intervals.push({ start, end });
    }
  }
  return intervals;
}

function isAutoGapPrompt(prompt: string): boolean {
  return prompt.trim().startsWith(AUTO_GAP_PREFIX);
}

function buildVideoPlacementsMarkdown(
  manual: ParsedVideoPlacement[],
  auto: ParsedVideoPlacement[],
): string {
  const lines: string[] = [];
  lines.push('VIDEO_PLACER:');
  lines.push('');
  lines.push('# Video Placements');
  lines.push('');
  lines.push('## Manual Placements');
  lines.push('');
  if (manual.length === 0) {
    lines.push('- (none)');
  } else {
    for (const placement of manual) {
      lines.push(
        `- Placement ${placement.placementNumber}: ${placement.startTime}-${placement.endTime} | type=${placement.videoType} | ${placement.prompt}`,
      );
    }
  }
  lines.push('');
  lines.push('## Auto Gap Placements');
  lines.push('');
  if (auto.length === 0) {
    lines.push('- (none)');
  } else {
    for (const placement of auto) {
      lines.push(
        `- Placement ${placement.placementNumber}: ${placement.startTime}-${placement.endTime} | type=${placement.videoType} | ${placement.prompt}`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildImagePlacementsMarkdown(placements: ParsedImagePlacement[]): string {
  const lines: string[] = ['IMAGE_PLACER:'];
  for (const placement of placements) {
    lines.push(
      `- Placement ${placement.placementNumber}: ${placement.startTime}-${placement.endTime} | ${placement.prompt}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function buildInfographicPlacementsMarkdown(placements: ParsedInfographicPlacement[]): string {
  const lines: string[] = ['INFOGRAPHIC_PLACER:'];
  for (const placement of placements) {
    const dataSegment =
      placement.data && Object.keys(placement.data).length > 0
        ? ` | data=${JSON.stringify(placement.data)}`
        : '';
    lines.push(
      `- Placement ${placement.placementNumber}: ${placement.startTime}-${placement.endTime} | type=${placement.infographicType} | ${placement.prompt}${dataSegment}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

async function autoFillVideoPlacementGaps(
  videoPlacementsPath: string,
): Promise<{ updated: boolean; autoCount: number; gapCount: number }> {
  const imageContent = readProjectFile('agent/content/image-placements.md');
  const infographicContent = readProjectFile(
    'agent/content/infographic-placements.md',
  );
  const videoContent = readProjectFile(videoPlacementsPath);
  const transcriptContent = readProjectFile('agent/content/transcript.md');

  const imageParse = imageContent
    ? parseImagePlacementsWithErrors(imageContent, false, { validateOverlaps: false })
    : { placements: [], errors: [], warnings: [] };
  const infographicParse = infographicContent
    ? parseInfographicPlacementsWithErrors(infographicContent, false, { validateOverlaps: false })
    : { placements: [], errors: [], warnings: [] };

  if (imageParse.errors.length > 0) {
    console.warn(
      `[autoFillVideoPlacementGaps] Image placement parse errors: ${imageParse.errors.length}`,
    );
  }
  if (infographicParse.errors.length > 0) {
    console.warn(
      `[autoFillVideoPlacementGaps] Infographic placement parse errors: ${infographicParse.errors.length}`,
    );
  }

  const videoParseResult = videoContent
    ? parseVideoPlacementsWithErrors(videoContent, false, { validateOverlaps: false })
    : { placements: [], errors: [], warnings: [] };
  const parsedVideoPlacements = videoParseResult.placements;
  const manualVideoPlacements = parsedVideoPlacements.filter(
    (placement) => !isAutoGapPrompt(placement.prompt),
  );

  const validated = validatePlacementSets(
    {
      imagePlacements: imageParse.placements,
      videoPlacements: manualVideoPlacements,
      infographicPlacements: infographicParse.placements,
    },
    {
      allowImageInfographicOverlap: true,
      requireInfographicWithinImage: true,
    },
  );

  if (validated.warnings.length > 0) {
    console.warn('[autoFillVideoPlacementGaps] Overlap adjustments:', validated.warnings);
  }

  if (imageContent) {
    writeProjectFile(
      'agent/content/image-placements.md',
      buildImagePlacementsMarkdown(validated.imagePlacements),
    );
  }
  if (infographicContent) {
    writeProjectFile(
      'agent/content/infographic-placements.md',
      buildInfographicPlacementsMarkdown(validated.infographicPlacements),
    );
  }

  const manualIntervals = collectIntervalsFromPlacements(
    validated.videoPlacements,
  );
  const imageIntervals = collectIntervalsFromPlacements(
    validated.imagePlacements,
  );
  const allIntervals = [...manualIntervals, ...imageIntervals];
  const merged = mergeIntervals(allIntervals);

  const transcriptDuration = parseTranscriptDurationSeconds(transcriptContent);
  const placementsMaxEnd =
    allIntervals.length > 0
      ? Math.max(...allIntervals.map((i) => i.end))
      : 0;
  const totalDuration =
    transcriptDuration > 0 ? transcriptDuration : placementsMaxEnd;

  if (transcriptDuration === 0 && placementsMaxEnd > 0) {
    console.warn(
      '[autoFillVideoPlacementGaps] Transcript duration missing; using placements max end time',
      { placementsMaxEnd },
    );
  }

  if (totalDuration <= 0) {
    console.warn(
      '[autoFillVideoPlacementGaps] No transcript or placements duration available; skipping gap fill',
    );
    return { updated: false, autoCount: 0, gapCount: 0 };
  }

  const gaps: TimeInterval[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start - cursor >= GAP_MIN_SECONDS) {
      gaps.push({ start: cursor, end: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (totalDuration - cursor >= GAP_MIN_SECONDS) {
    gaps.push({ start: cursor, end: totalDuration });
  }

  const maxManualPlacementNumber = validated.videoPlacements.reduce(
    (max, placement) => Math.max(max, placement.placementNumber),
    0,
  );

  const autoPlacements: ParsedVideoPlacement[] = gaps.map((gap, index) => {
    const startSeconds = Math.floor(gap.start);
    const endSeconds = Math.max(startSeconds + 1, Math.ceil(gap.end));
    const startTime = formatTimeSeconds(startSeconds);
    const endTime = formatTimeSeconds(endSeconds);
    const transcriptSegment = getTranscriptSegmentForTimeRange(
      transcriptContent,
      startTime,
      endTime,
    );
    const prompt = transcriptSegment
      ? `${AUTO_GAP_PREFIX} ${transcriptSegment}`
      : `${AUTO_GAP_PREFIX} contextual b-roll matching narration`;
    return {
      placementNumber: maxManualPlacementNumber + index + 1,
      startTime,
      endTime,
      videoType: 'cinematic_realism',
      prompt,
      duration: Math.min(10, Math.max(4, Math.round(endSeconds - startSeconds))),
    };
  });

  const markdown = buildVideoPlacementsMarkdown(
    validated.videoPlacements,
    autoPlacements,
  );
  writeProjectFile(videoPlacementsPath, markdown);

  console.log('[autoFillVideoPlacementGaps] Summary', {
    imagePlacements: imageParse.placements.length,
    infographicPlacements: infographicParse.placements.length,
    manualVideoPlacements: validated.videoPlacements.length,
    mergedIntervals: merged.length,
    gapCount: gaps.length,
    autoPlacements: autoPlacements.length,
  });

  return {
    updated: true,
    autoCount: autoPlacements.length,
    gapCount: gaps.length,
  };
}

/**
 * Video generation parameters.
 */
export interface VideoGenerationParams {
  scene_artifacts: string[];
  duration?: number;
  fps?: number;
  transition?: string;
}

/**
 * Image edit parameters.
 */
export interface ImageEditParams {
  scene_number: number;
  edit_prompt: string;
  base_image_path: string;
  negative_prompt?: string;
  aspect_ratio?: string;
  seed?: number;
}

// Job storage (in-memory for now, could be Redis/DB in production)
const jobs = new Map<string, GenerationJob>();
const activeBatchRunners = new Map<string, Promise<void>>();
const MAX_BACKGROUND_BATCH_HISTORY = 30;

/**
 * Module-level AbortController used to cancel all in-flight polling loops
 * (waitForComfyUIJob → ComfyUIClient.waitForCompletion) on server shutdown.
 * Calling shutdownVideoTools() aborts this signal and replaces it with a fresh one.
 */
let shutdownController = new AbortController();

/**
 * Gracefully shut down all video generation activity.
 * - Aborts every in-flight waitForCompletion polling loop via the shared AbortSignal
 * - Sends /interrupt and /queue clear to ComfyUI so GPU work stops
 * - Marks all processing jobs as failed
 * - Clears the jobs Map and batch runner tracking
 *
 * Called from the server's graceful-shutdown handler.
 */
export async function shutdownVideoTools(): Promise<void> {
  console.log('[shutdownVideoTools] Shutting down video generation...');

  // 1. Abort all polling loops
  shutdownController.abort('server_shutdown');

  // 2. Interrupt current ComfyUI job and clear the queue
  try {
    await Promise.all([
      ComfyUIClient.interruptCurrentJob(),
      ComfyUIClient.clearQueue(),
    ]);
  } catch (e) {
    console.warn('[shutdownVideoTools] Error communicating with ComfyUI during shutdown:', e);
  }

  // 3. Mark all in-progress jobs as failed
  for (const [id, job] of jobs) {
    if (job.status === 'pending' || job.status === 'processing') {
      job.status = 'failed';
      job.error = 'Server shutdown';
      job.updatedAt = Date.now();
      console.log(`[shutdownVideoTools] Marked job ${id} as failed (server shutdown)`);
    }
  }

  // 4. Clear state
  jobs.clear();
  activeBatchRunners.clear();

  // 5. Replace the controller so a future server start gets a fresh signal
  shutdownController = new AbortController();

  console.log('[shutdownVideoTools] Video generation shutdown complete');
}

interface PreparedImageGenerationPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  prompt: string;
  negativePrompt: string;
}

interface PreparedVideoGenerationPlacement {
  placementNumber: number;
  startTime: string;
  endTime: string;
  prompt: string;
  duration: number;
  videoType: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
}

function getBatchRunnerKey(projectId: string, batchId: string): string {
  return `${projectId}:${batchId}`;
}

function ensureBackgroundGenerationState(project: ProjectFile): BackgroundGenerationState {
  if (!project.backgroundGeneration) {
    project.backgroundGeneration = {
      batches: [],
      activeBatchIds: [],
    };
  }
  if (!Array.isArray(project.backgroundGeneration.batches)) {
    project.backgroundGeneration.batches = [];
  }
  if (!Array.isArray(project.backgroundGeneration.activeBatchIds)) {
    project.backgroundGeneration.activeBatchIds = [];
  }
  return project.backgroundGeneration;
}

function trimBackgroundBatchHistory(state: BackgroundGenerationState): void {
  if (state.batches.length <= MAX_BACKGROUND_BATCH_HISTORY) {
    return;
  }
  state.batches = state.batches
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_BACKGROUND_BATCH_HISTORY);
  const existing = new Set(state.batches.map((batch) => batch.id));
  state.activeBatchIds = state.activeBatchIds.filter((id) => existing.has(id));
}

function persistBatchUpdate(
  basePath: string,
  batchId: string,
  updater: (batch: BackgroundGenerationBatch, state: BackgroundGenerationState, project: ProjectFile) => void,
): BackgroundGenerationBatch | null {
  const project = loadProject(basePath);
  if (!project) return null;
  const state = ensureBackgroundGenerationState(project);
  const batch = state.batches.find((entry) => entry.id === batchId);
  if (!batch) return null;

  updater(batch, state, project);
  batch.updatedAt = Date.now();

  if (batch.status === 'queued' || batch.status === 'running') {
    if (!state.activeBatchIds.includes(batch.id)) {
      state.activeBatchIds.push(batch.id);
    }
  } else {
    state.activeBatchIds = state.activeBatchIds.filter((id) => id !== batch.id);
  }

  trimBackgroundBatchHistory(state);
  saveProject(project, basePath);
  return batch;
}

function createBackgroundBatch(
  basePath: string,
  params: {
    kind: BackgroundGenerationKind;
    sourceFile: string;
    expandPrompts: boolean;
    autoFillGaps?: boolean;
    retryOfBatchId?: string;
    items: BackgroundGenerationItem[];
  },
): { projectId: string; batch: BackgroundGenerationBatch } | null {
  const project = loadProject(basePath);
  if (!project) return null;

  const state = ensureBackgroundGenerationState(project);
  const now = Date.now();
  const batch: BackgroundGenerationBatch = {
    id: `${params.kind}-batch-${now}-${nanoid(6)}`,
    kind: params.kind,
    phase: params.kind === 'image' ? WorkflowPhase.IMAGE_GENERATION : WorkflowPhase.VIDEO_GENERATION,
    sourceFile: params.sourceFile,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    expandPrompts: params.expandPrompts,
    autoFillGaps: params.autoFillGaps,
    retryOfBatchId: params.retryOfBatchId,
    totalItems: params.items.length,
    completedItems: 0,
    failedItems: 0,
    items: params.items,
  };

  state.batches.unshift(batch);
  if (!state.activeBatchIds.includes(batch.id)) {
    state.activeBatchIds.push(batch.id);
  }
  trimBackgroundBatchHistory(state);
  saveProject(project, basePath);

  return { projectId: project.id, batch };
}

// Get the project assets directory for images (legacy - still used for non-placement images)
function getAssetsDir(): string {
  const basePath = getCurrentProjectBasePath();
  const assetsDir = path.join(basePath, PROJECT_DIR, AGENT_DIR, 'assets', 'images');
  if (!getProjectFileOps().existsSync(assetsDir)) {
    getProjectFileOps().mkdirSync(assetsDir, { recursive: true });
  }
  return assetsDir;
}

// Get the image-placements directory for placement images
function getImagePlacementsDir(): string {
  const basePath = getCurrentProjectBasePath();
  const imagePlacementsDir = path.join(basePath, PROJECT_DIR, AGENT_DIR, 'image-placements');
  if (!getProjectFileOps().existsSync(imagePlacementsDir)) {
    getProjectFileOps().mkdirSync(imagePlacementsDir, { recursive: true });
  }
  return imagePlacementsDir;
}

// Get the video-placements directory for placement videos
function getVideoPlacementsDir(): string {
  const basePath = getCurrentProjectBasePath();
  const videoPlacementsDir = path.join(basePath, PROJECT_DIR, AGENT_DIR, 'video-placements');
  if (!getProjectFileOps().existsSync(videoPlacementsDir)) {
    getProjectFileOps().mkdirSync(videoPlacementsDir, { recursive: true });
  }
  return videoPlacementsDir;
}

/**
 * Get the video generation timeout from environment variable or use default.
 * Uses the existing COMFYUI_TIMEOUT environment variable (same as ComfyUIClient).
 * Default: 1800 seconds (30 minutes)
 */
function getVideoGenerationTimeout(): number {
  const envTimeout = process.env['COMFYUI_TIMEOUT'];
  if (envTimeout) {
    const parsed = parseInt(envTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 1800; // Default 30 minutes
}

/**
 * Generate a filename for placement images.
 * Format: image{number}_{nanoid(8)}.png
 * Example: image1_aB3cD4eF.png, image2_xY9zW2vU.png
 */
function generatePlacementFilename(placementNumber: number): string {
  const id = nanoid(8);
  return `image${placementNumber}_${id}.png`;
}

/**
 * Check if an image already exists for a placement.
 * Checks both the image-placements folder and the manifest.json.
 */
function checkImageExists(
  placementIdentifier: string,
  placementIndex?: number
): { exists: boolean; artifactId?: string; filePath?: string } {
  // Try to find by filename pattern
  const imagePlacementsDir = getImagePlacementsDir();
  const possibleFilenames = [
    `placement-${placementIndex ?? 1}.png`,
    `placement-${placementIndex ?? 1}.jpg`,
    `${placementIdentifier}.png`,
    `${placementIdentifier}.jpg`,
  ];

  for (const filename of possibleFilenames) {
    const filePath = path.join(imagePlacementsDir, filename);
    if (getProjectFileOps().existsSync(filePath)) {
      // Check manifest for artifact ID
      const assets = getAssets();
      const relativePath = `agent/image-placements/${filename}`;
      const asset = assets.find((a) => a.path === relativePath);
      if (asset) {
        return { exists: true, artifactId: asset.id, filePath: relativePath };
      }
      return { exists: true, filePath: relativePath };
    }
  }

  // Check manifest for any asset with matching path pattern
  const assets = getAssets();
  const matchingAsset = assets.find((a) => 
    a.path?.includes('image-placements') && 
    (a.path.includes(placementIdentifier) || (placementIndex !== undefined && a.path.includes(`placement-${placementIndex}`)))
  );

  if (matchingAsset) {
    return { exists: true, artifactId: matchingAsset.id, filePath: matchingAsset.path };
  }

  return { exists: false };
}

/**
 * Submit an image generation job to ComfyUI.
 */
async function submitImageGeneration(params: ImageGenerationParams): Promise<{
  jobId: string;
  status: string;
  error?: string;
}> {
  const {
    scene_number,
    prompt,
    negative_prompt = '',
    aspect_ratio = '16:9',
    seed,
    image_type = 'scene',
    character_name,
    setting_name,
    generation_mode = 'text_to_image',
    reference_images = [],
  } = params;

  // Determine filename prefix based on image type
  let filenamePrefix: string;
  let logDesc: string;

  if (image_type === 'character_ref' && character_name) {
    const cleanName = character_name.replace(/[^a-zA-Z0-9]/g, '');
    filenamePrefix = `CharRef_${cleanName}`;
    logDesc = `character reference for ${character_name}`;
  } else if (image_type === 'setting_ref' && setting_name) {
    const cleanName = setting_name.replace(/[^a-zA-Z0-9]/g, '');
    filenamePrefix = `SettingRef_${cleanName}`;
    logDesc = `setting reference for ${setting_name}`;
  } else {
    filenamePrefix = `Scene${scene_number}`;
    logDesc = `scene ${scene_number}`;
  }

  // Determine context for linking artifact to project
  let context: ArtifactContext;
  if (image_type === 'character_ref' && character_name) {
    context = { entityType: 'character', characterName: character_name, artifactType: 'image' };
  } else if (image_type === 'setting_ref' && setting_name) {
    context = { entityType: 'setting', settingName: setting_name, artifactType: 'image' };
  } else {
    context = { entityType: 'scene', sceneNumber: scene_number, artifactType: 'image' };
  }

  // Create job for tracking
  const jobId = `img-${Date.now()}-${nanoid(6)}`;
  const job: GenerationJob = {
    id: jobId,
    type: 'image',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    context,
  };
  jobs.set(jobId, job);

  try {
    const registry = getRegistry();
    // Use image-placements directory for scene images (placement images), assets/images for reference images
    const outputDir = image_type === 'scene' ? getImagePlacementsDir() : getAssetsDir();
    const client = new ComfyUIClient({
      outputDir,
    });

    // Determine which workflow to use based on generation mode and reference images
    const useQwenEdit = generation_mode === 'image_text_to_image' && reference_images.length > 0;
    const workflowName = useQwenEdit ? 'qwen_edit' : 'zimage';
    const workflowMetadata = registry.get(workflowName);

    if (!workflowMetadata) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    let inputImageFilename: string | undefined;
    const referenceImageFilenames: string[] = [];

    // If using qwen_edit, upload reference images (up to 3 total)
    if (useQwenEdit && reference_images.length > 0) {
      // Limit to 3 images total for qwen_edit workflow
      const imagesToUpload = reference_images.slice(0, 3);

      for (let i = 0; i < imagesToUpload.length; i++) {
        const refImage = imagesToUpload[i];
        if (!refImage) continue;
        const refImagePath = findImagePathFromArtifactId(refImage.image_id);

        if (!refImagePath || !getProjectFileOps().existsSync(refImagePath)) {
          continue;
        }

        const uploadResult = await client.uploadImage(refImagePath);

        if (i === 0) {
          // First image is the primary input (base image to edit)
          inputImageFilename = uploadResult.name;
        } else {
          // Additional images are stored separately
          referenceImageFilenames.push(uploadResult.name);
        }
      }
    }

    // Get the project style configuration and enhance the prompt
    const styleConfig = getProjectStyleConfig();
    const enhancedPrompt = `${prompt}, ${styleConfig.promptModifier}`;
    const enhancedNegativePrompt = negative_prompt
      ? `${negative_prompt}, ${styleConfig.negativePromptModifier}`
      : styleConfig.negativePromptModifier;

    const template = loadWorkflowTemplate(workflowMetadata.filename);
    const workflow = parameterizeWorkflowByName(workflowName, template, {
      sceneNumber: scene_number,
      prompt: enhancedPrompt,
      negativePrompt: enhancedNegativePrompt,
      aspectRatio: aspect_ratio,
      style: styleConfig.displayName.toLowerCase().replace(/\s+/g, '_'),
      seed,
      filenamePrefix,
      inputImageFilename,
      referenceImageFilenames: referenceImageFilenames.length > 0 ? referenceImageFilenames : undefined,
    });

    const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

    // Update job with prompt ID
    job.promptId = promptId;
    job.status = 'processing';
    job.updatedAt = Date.now();

    return {
      jobId,
      status: 'submitted',
    };
  } catch (error) {
    job.status = 'failed';
    job.error = String(error);
    job.updatedAt = Date.now();

    return {
      jobId,
      status: 'error',
      error: String(error),
    };
  }
}

/**
 * Wait for a ComfyUI job to complete and download the result.
 */
async function waitForComfyUIJob(jobId: string, timeout: number | undefined = undefined): Promise<{
  status: string;
  artifactId?: string;
  filePath?: string;
  error?: string;
}> {
  const job = jobs.get(jobId);
  if (!job) {
    return { status: 'error', error: `Job not found: ${jobId}` };
  }

  if (!job.promptId) {
    return { status: 'error', error: 'Job has no ComfyUI prompt ID' };
  }

  try {
    // Determine output directory based on job type and context
    let outputDir: string;
    if (job.type === 'video' && job.context?.artifactType === 'video') {
      // Video jobs use video-placements directory
      outputDir = getVideoPlacementsDir();
    } else if (job.context?.entityType === 'scene') {
      // Scene images use image-placements directory
      outputDir = getImagePlacementsDir();
    } else {
      // Reference images use assets directory
      outputDir = getAssetsDir();
    }
    
    // Use provided timeout, or get from environment variable, or default to 300
    const actualTimeout = timeout ?? (job.type === 'video' ? getVideoGenerationTimeout() : 300);
    
    const client = new ComfyUIClient({
      outputDir,
      timeout: actualTimeout,
    });

    // Wait for completion (pass shutdownController.signal so shutdown aborts polling)
    const completionResult = await client.waitForCompletion(
      job.promptId,
      (pct, msg) => {
        job.progress = pct;
        job.updatedAt = Date.now();
      },
      undefined,
      shutdownController.signal
    );

    if (completionResult.status !== 'completed' && completionResult.status !== 'completed_with_timeout') {
      job.status = 'failed';
      job.error = 'Job did not complete';
      job.updatedAt = Date.now();
      return { status: 'failed', error: 'Job did not complete' };
    }

    // Get output files (images or videos)
    const outputs = await client.getOutputImages(job.promptId);
    if (!outputs.length) {
      job.status = 'failed';
      const errorMsg = job.type === 'video' ? 'No output videos found' : 'No output images found';
      job.error = errorMsg;
      job.updatedAt = Date.now();
      return { status: 'failed', error: errorMsg };
    }

    // Download first output file (image or video)
    const firstOutput = outputs[0]!;
    
    // Generate descriptive filename
    let outputFilename: string;
    if (job.type === 'video' && job.context?.entityType === 'scene' && job.context.sceneNumber) {
      // Video naming: video{number}_{nanoid(8)}.mp4
      const ext = firstOutput.filename.split('.').pop() || 'mp4';
      outputFilename = `video${job.context.sceneNumber}_${nanoid(8)}.${ext}`;
    } else if (job.context?.entityType === 'scene' && job.context.sceneNumber) {
      // Image naming: image{number}_{nanoid(8)}.png
      outputFilename = generatePlacementFilename(job.context.sceneNumber);
    } else {
      // For non-placement files, use original naming with nanoid prefix
      outputFilename = `${nanoid(8)}_${firstOutput.filename}`;
    }
    
    const savedPath = await client.downloadImage(
      firstOutput.filename,
      firstOutput.subfolder,
      firstOutput.type,
      outputFilename
    );

    // Create artifact ID (use vid_ for videos, img_ for images)
    const artifactId = job.type === 'video' ? `vid_${nanoid(8)}` : `img_${nanoid(8)}`;

    // Get relative path for storage (relative to .kshana/)
    const basePath = getCurrentProjectBasePath();
    const projectDir = path.join(basePath, PROJECT_DIR);
    let relativePath: string;
    try {
      relativePath = path.relative(projectDir, savedPath);
    } catch {
      relativePath = savedPath;
    }
    
    // Ensure path uses forward slashes and starts with agent/ if it's an agent asset
    if (!relativePath.startsWith('agent/') && !relativePath.startsWith('context/') && !relativePath.startsWith('index/')) {
      relativePath = `agent/${relativePath}`;
    }

    // Determine asset type based on context
    let assetType: 'character_ref' | 'setting_ref' | 'scene_image' | 'scene_video' = 'scene_image';
    if (job.context) {
      if (job.context.entityType === 'character') {
        assetType = 'character_ref';
      } else if (job.context.entityType === 'setting') {
        assetType = 'setting_ref';
      } else if (job.context.artifactType === 'video') {
        assetType = 'scene_video';
      }
    } else if (job.type === 'video') {
      assetType = 'scene_video';
    }

    // Store artifact in project manifest
    try {
      // Determine scene_number and placementNumber from job context
      const sceneNumber = job.context?.sceneNumber;
      const placementNumber = sceneNumber; // For placements, sceneNumber is actually placementNumber
      
      console.log(`[waitForComfyUIJob] Registering asset for job ${jobId}:`, {
        artifactId,
        assetType,
        relativePath,
        sceneNumber,
        placementNumber,
        savedPath,
      });
      
      // Build metadata with placementNumber if available
      const metadata: Record<string, unknown> = {
        jobId: job.id,
        promptId: job.promptId,
        originalFilename: path.basename(savedPath),
      };
      
      if (placementNumber !== undefined) {
        metadata['placementNumber'] = placementNumber;
      }
      
      // Calculate version number by finding existing assets for the same placement
      let version = 1;
      if (placementNumber !== undefined) {
        const manifestPath = getManifestFilePath();
        if (getProjectFileOps().existsSync(manifestPath)) {
          try {
            const manifestContent = getProjectFileOps().readFileSync(manifestPath, 'utf-8');
            const manifest = JSON.parse(manifestContent) as { assets: Array<{ type?: string; scene_number?: number; metadata?: Record<string, unknown>; version?: number }> };
            const existingAssets = manifest.assets?.filter((a) => 
              a.type === assetType && (
                a.metadata?.['placementNumber'] === placementNumber ||
                a['scene_number'] === placementNumber
              )
            ) || [];
            if (existingAssets.length > 0) {
              const maxVersion = Math.max(...existingAssets.map(a => a.version || 1));
              version = maxVersion + 1;
            }
          } catch (error) {
            // If manifest read fails, default to version 1
            console.warn(`[waitForComfyUIJob] Failed to read manifest for version calculation:`, error);
          }
        }
      }
      
      // Add asset with scene_number and metadata
      // Note: scene_number is set for backward compatibility, placementNumber is in metadata
      const assetData: any = {
        id: artifactId,
        type: assetType,
        path: relativePath,
        createdAt: Date.now(),
        version,
        metadata,
      };
      
      // Add scene_number if available (for backward compatibility)
      if (sceneNumber !== undefined) {
        assetData.scene_number = sceneNumber;
      }
      
      console.log(`[waitForComfyUIJob] Calling addAsset with:`, {
        id: assetData.id,
        type: assetData.type,
        path: assetData.path,
        scene_number: assetData.scene_number,
        placementNumber: assetData.metadata?.placementNumber,
        version: assetData.version,
      });
      
      await addAsset(assetData);
      
      console.log(`[waitForComfyUIJob] Successfully registered asset ${artifactId} with placementNumber ${placementNumber}`);
    } catch (error) {
      // Log the error instead of silently swallowing it
      console.error(`[waitForComfyUIJob] CRITICAL: Failed to register asset in manifest:`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        jobId,
        artifactId,
        relativePath,
        placementNumber: job.context?.sceneNumber,
        assetType,
      });
      // Don't throw - image was generated successfully, just not registered
      // This allows the function to return success even if registration fails
    }

    // Link artifact to project entity (character, setting, or scene)
    if (job.context) {
      try {
        if (job.context.entityType === 'character' && job.context.characterName) {
          updateCharacter(job.context.characterName, {
            referenceImageId: artifactId,
            referenceImagePath: relativePath,
          });
        } else if (job.context.entityType === 'setting' && job.context.settingName) {
          updateSetting(job.context.settingName, {
            referenceImageId: artifactId,
            referenceImagePath: relativePath,
          });
        } else if (job.context.entityType === 'scene' && job.context.sceneNumber !== undefined) {
          if (job.context.artifactType === 'video') {
            updateScene(job.context.sceneNumber, {
              videoArtifactId: artifactId,
            });
          } else {
            updateScene(job.context.sceneNumber, {
              imageArtifactId: artifactId,
            });
          }
        }
      } catch (e) {
        console.warn(`Failed to link artifact to project entity: ${e}`);
      }
    }

    // Update job
    job.status = 'completed';
    job.progress = 100;
    job.result = {
      artifactId,
      path: relativePath,
    };
    job.updatedAt = Date.now();

    // Return full absolute path for immediate use
    // savedPath should already be absolute from downloadImage, but ensure it is
    const absolutePath = path.isAbsolute(savedPath) ? savedPath : path.resolve(savedPath);

    return {
      status: 'completed',
      artifactId,
      filePath: absolutePath, // Return full absolute path for immediate use
    };
  } catch (error) {
    job.status = 'failed';
    job.error = String(error);
    job.updatedAt = Date.now();

    return {
      status: 'error',
      error: String(error),
    };
  }
}

/**
 * Generate image tool.
 * This is a COMPLEX tool - requires user confirmation.
 *
 * Supports two modes:
 * 1. text_to_image: Pure text-to-image generation (for reference images)
 * 2. image_text_to_image: Image+text-to-image with reference images for consistency (for scenes)
 */
export const generateImageTool: ToolDefinition = createTool(
  'generate_image',
  `Generate an image using ComfyUI. Supports two modes:

1. **Text-to-Image** (generation_mode: "text_to_image"):
   - For character reference images
   - For setting reference images
   - No reference_images needed

2. **Image+Text-to-Image** (generation_mode: "image_text_to_image"):
   - For scene images that need character/setting consistency
   - Requires reference_images array with character and setting refs
   - Uses reference images to maintain visual consistency

The tool will return a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      scene_number: {
        type: 'number',
        description: 'Scene number (for scene images) or sequence number for reference images',
      },
      prompt: {
        type: 'string',
        description: 'Detailed image generation prompt describing the visual',
      },
      negative_prompt: {
        type: 'string',
        description: 'What to avoid in the image (optional)',
      },
      aspect_ratio: {
        type: 'string',
        description: 'Image aspect ratio (default: 16:9 for video scenes)',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
      image_type: {
        type: 'string',
        description: 'Type of image being generated',
        enum: ['scene', 'character_ref', 'setting_ref'],
      },
      character_name: {
        type: 'string',
        description: 'Character name (required for character_ref type)',
      },
      setting_name: {
        type: 'string',
        description: 'Setting name (required for setting_ref type)',
      },
      generation_mode: {
        type: 'string',
        description: 'Generation mode: text_to_image for refs, image_text_to_image for scenes with refs',
        enum: ['text_to_image', 'image_text_to_image'],
      },
      reference_images: {
        type: 'array',
        description: 'Reference images for consistency (required for image_text_to_image mode)',
        items: {
          type: 'object',
          properties: {
            image_id: {
              type: 'string',
              description: 'Artifact ID or path to the reference image',
            },
            type: {
              type: 'string',
              enum: ['character', 'setting'],
              description: 'Type of reference',
            },
            name: {
              type: 'string',
              description: 'Name of the character or setting',
            },
          },
          required: ['image_id', 'type', 'name'],
        },
      },
    },
    required: ['scene_number', 'prompt'],
  },
  async (args) => {
    const params = args as unknown as ImageGenerationParams;

    const comfyUIAvailable = await ComfyUIClient.isAvailable();
    if (!comfyUIAvailable) {
      console.warn('[generate_image] ComfyUI unavailable - skipping image generation');
      return {
        status: 'error',
        error: 'ComfyUI is unavailable (health check failed).',
        suggestion: 'Retry after ComfyUI is back online, or skip this phase and continue the workflow.',
      };
    }

    // Check for duplicates if this is a scene image (placement image)
    if (params.image_type === 'scene' || !params.image_type) {
      const duplicateCheck = checkImageExists(`scene-${params.scene_number}`, params.scene_number);
      if (duplicateCheck.exists) {
        return {
          status: 'skipped',
          message: 'Image already exists for this placement',
          artifact_id: duplicateCheck.artifactId,
          file_path: duplicateCheck.filePath,
          duplicate: true,
        };
      }
    }

    // Determine generation mode based on image_type and reference_images
    const generationMode = params.generation_mode ??
      (params.image_type === 'scene' && params.reference_images?.length
        ? 'image_text_to_image'
        : 'text_to_image');

    // Validate reference images for image_text_to_image mode
    if (generationMode === 'image_text_to_image' && (!params.reference_images || params.reference_images.length === 0)) {
      return {
        status: 'error',
        error: 'Reference images are required for image_text_to_image mode. Please generate character and setting reference images first.',
        suggestion: 'Use dispatch_image_agent with image_type "character_ref" or "setting_ref" to create reference images first.',
      };
    }

    // Submit to ComfyUI
    const result = await submitImageGeneration(params);

    if (result.status === 'error') {
      return {
        status: 'error',
        error: result.error,
        job_id: result.jobId,
      };
    }

    return {
      status: 'submitted',
      job_id: result.jobId,
      generation_mode: generationMode,
      message: generationMode === 'text_to_image'
        ? `Text-to-image generation job submitted. Use wait_for_job("${result.jobId}") to check status.`
        : `Image+text-to-image generation job submitted with ${params.reference_images?.length ?? 0} reference images. Use wait_for_job("${result.jobId}") to check status.`,
      params: {
        scene_number: params.scene_number,
        image_type: params.image_type ?? 'scene',
        prompt: params.prompt,
        generation_mode: generationMode,
        reference_count: params.reference_images?.length ?? 0,
        references: params.reference_images?.map(r => `${r.type}:${r.name}`) ?? [],
      },
    };
  }
);

/**
 * Video generation parameters for placement videos.
 */
export interface VideoPlacementGenerationParams {
  scene_number: number;
  prompt: string;
  duration: number; // Duration in seconds (4-10 seconds maximum)
  video_type: 'cinematic_realism' | 'stock_footage' | 'motion_graphics';
}

/**
 * Calculate frame count for LTX-2 workflow from duration.
 * LTX-2 requires frame count to be divisible by 8 + 1.
 * Formula: Math.ceil((duration * 25) / 8) * 8 + 1
 * 
 * NOTE: LTX-2 workflows output at 25 fps. Using Math.ceil ensures we
 * always get at least the requested duration (videos may be slightly
 * longer but never shorter than expected).
 * 
 * @param duration Duration in seconds
 * @returns Frame count ensuring at least the requested duration
 */
function calculateFrameCount(duration: number): number {
  // 25 fps (LTX-2 output rate), frame count must be of the form 8k + 1
  // Use Math.ceil to round up so videos are never shorter than requested
  return Math.ceil((duration * 25) / 8) * 8 + 1;
}

/**
 * Submit a video generation job for placement videos using LTX-2 text-to-video.
 * Generates videos directly from text prompts without requiring an intermediate image.
 */
async function submitVideoPlacementGeneration(params: VideoPlacementGenerationParams): Promise<{
  jobId: string;
  status: string;
  error?: string;
}> {
  const {
    scene_number,
    prompt,
    duration,
    video_type,
  } = params;

  // Create job for tracking
  const jobId = `vid-${Date.now()}-${nanoid(6)}`;
  const job: GenerationJob = {
    id: jobId,
    type: 'video',
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    context: {
      entityType: 'scene',
      sceneNumber: scene_number,
      artifactType: 'video',
    },
  };
  jobs.set(jobId, job);

  try {
    console.log(`[submitVideoPlacementGeneration] Generating video from text prompt for placement ${scene_number}...`);

    const registry = getRegistry();
    const workflowMetadata = registry.get('ltx_t2v');

    if (!workflowMetadata) {
      throw new Error("Workflow 'ltx_t2v' not found");
    }

    // Use video-placements directory for placement videos
    const videoPlacementsDir = getVideoPlacementsDir();

    const client = new ComfyUIClient({
      outputDir: videoPlacementsDir,
    });

    // Calculate frame count from duration (LTX-2 requires divisible by 8 + 1)
    const frameCount = calculateFrameCount(duration);

    // Get the project style configuration and enhance the prompt
    const styleConfig = getProjectStyleConfig();
    const enhancedPrompt = `${prompt}, ${styleConfig.promptModifier}`;
    const negativePrompt = 'blurry, low quality, text, watermark, frozen pose, motionless subject, still image, artifacts';

    // Load and parameterize the workflow
    const template = loadWorkflowTemplate(workflowMetadata.filename);
    const workflow = parameterizeLtxT2VWorkflow(template, {
      prompt: enhancedPrompt,
      negativePrompt,
      seed: Math.floor(Math.random() * 2 ** 32),
      filenamePrefix: `Placement${scene_number}_video`,
      width: 1280, // 16:9 HD resolution
      height: 720,
      frameCount,
    });

    // Queue workflow
    const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

    // Update job with video prompt ID
    job.promptId = promptId;
    job.status = 'processing';
    job.updatedAt = Date.now();

    console.log(`[submitVideoPlacementGeneration] Video generation job submitted with prompt ID: ${promptId}, frame count: ${frameCount}`);

    return {
      jobId,
      status: 'submitted',
    };
  } catch (error) {
    job.status = 'failed';
    job.error = String(error);
    job.updatedAt = Date.now();

    return {
      jobId,
      status: 'error',
      error: String(error),
    };
  }
}

/**
 * Generate a video for a placement using AI video generation.
 * This tool generates videos from text prompts for video placements.
 */
export const generateVideoPlacementTool: ToolDefinition = createTool(
  'generate_video',
  `Generate an AI video for a video placement using text-to-video generation.

This tool generates videos from text prompts for video placements identified in the transcript.
The video will be saved to the video-placements directory.

The tool will return a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed video generation prompt describing the visual and motion',
      },
      duration: {
        type: 'number',
        description: 'Video duration in seconds (4-10 seconds maximum)',
        enum: [4, 5, 6, 7, 8, 9, 10],
      },
      scene_number: {
        type: 'number',
        description: 'Scene/placement number for file naming',
      },
      video_type: {
        type: 'string',
        enum: ['cinematic_realism', 'stock_footage', 'motion_graphics'],
        description: 'Type of video to generate',
      },
    },
    required: ['prompt', 'duration', 'scene_number', 'video_type'],
  },
  async (args) => {
    const params = args as unknown as VideoPlacementGenerationParams;

    // Submit video generation job
    const result = await submitVideoPlacementGeneration(params);

    if (result.status === 'error') {
      return {
        status: 'error',
        error: result.error,
        job_id: result.jobId,
      };
    }

    return {
      status: 'submitted',
      job_id: result.jobId,
      message: `Video generation job submitted. Use wait_for_job("${result.jobId}") to check status.`,
      params: {
        scene_number: params.scene_number,
        video_type: params.video_type,
        duration: params.duration,
        prompt: params.prompt,
      },
    };
  }
);

/**
 * Helper function to find image path from artifact ID.
 */
function findImagePathFromArtifactId(artifactId: string): string | undefined {
  const project = loadProject();
  if (!project) return undefined;

  // Check project assets manifest (now in agent/manifest.json)
  const assets = getAssets();
  const basePath = getCurrentProjectBasePath();
  const asset = assets.find((a) => a.id === artifactId);
  if (asset) {
    // Asset path is relative to .kshana/, so join with project dir
    return path.join(basePath, PROJECT_DIR, asset.path);
  }

  // Check scenes for matching artifact
  for (const scene of project.scenes) {
    if (scene.imageArtifactId === artifactId || scene.videoArtifactId === artifactId) {
      // Try to find path from assets
      const foundAsset = assets.find((a) => a.id === artifactId);
      if (foundAsset) {
        return path.join(basePath, PROJECT_DIR, foundAsset.path);
      }
    }
  }

  return undefined;
}

/**
 * Generate video from single image tool.
 * This is a COMPLEX tool - requires user confirmation.
 *
 * Use this for animating a SINGLE scene - NOT for transitions between scenes.
 */
export const generateVideoFromImageTool: ToolDefinition = createTool(
  'generate_video_from_image',
  `Animate a SINGLE scene image with motion effects.

**USE THIS TOOL WHEN:**
- Creating video for ONE scene (e.g., "animate Scene 3")
- The scene has internal motion but doesn't transition to another scene
- Adding camera movement within the same scene composition
- Adding character movement, environmental effects within ONE frame

**DO NOT USE THIS TOOL WHEN:**
- You need to transition BETWEEN two different scene images
- You want to connect Scene N to Scene N+1 (use generate_video_from_frames instead)

**Input:** Single scene image artifact
**Output:** Video clip of that scene with motion

**Example motion prompts:**
- "camera slowly pans across the scene"
- "the character gestures while speaking"
- "wind blows through the trees, clouds drift"
- "subtle breathing motion, eyes blinking"

Returns a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      scene_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the scene image to animate',
      },
      scene_number: {
        type: 'number',
        description: 'Scene number',
      },
      motion_prompt: {
        type: 'string',
        description: 'Description of the motion/animation to apply (camera movements, character actions, environmental effects)',
      },
      negative_prompt: {
        type: 'string',
        description: 'What to avoid in the video (optional)',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['scene_image_artifact_id', 'scene_number', 'motion_prompt'],
  },
  async (args) => {
    const sceneImageArtifactId = args['scene_image_artifact_id'] as string;
    const sceneNumber = args['scene_number'] as number;
    const motionPrompt = args['motion_prompt'] as string;
    const negativePrompt = args['negative_prompt'] as string | undefined;
    const seed = args['seed'] as number | undefined;

    // Create job for tracking with context for linking
    const jobId = `vid-${Date.now()}-${nanoid(6)}`;
    const job: GenerationJob = {
      id: jobId,
      type: 'video',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      context: {
        entityType: 'scene',
        sceneNumber,
        artifactType: 'video',
      },
    };
    jobs.set(jobId, job);

    try {
      // Find the image file from the artifact ID
      const imagePath = findImagePathFromArtifactId(sceneImageArtifactId);

      if (!imagePath || !getProjectFileOps().existsSync(imagePath)) {
        throw new Error(`Image not found for artifact: ${sceneImageArtifactId}`);
      }

      const registry = getRegistry();
      const workflowMetadata = registry.get('wan_single_image');

      if (!workflowMetadata) {
        throw new Error("Workflow 'wan_single_image' not found");
      }

      const basePath = getCurrentProjectBasePath();
      const assetsDir = path.join(basePath, PROJECT_DIR, AGENT_DIR, 'assets', 'videos');
      if (!getProjectFileOps().existsSync(assetsDir)) {
        getProjectFileOps().mkdirSync(assetsDir, { recursive: true });
      }

      const client = new ComfyUIClient({
        outputDir: assetsDir,
      });

      // Upload the image to ComfyUI
      const uploadResult = await client.uploadImage(imagePath, 'input', true);

      // Load and parameterize the workflow
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      const workflow = parameterizeWorkflowByName('wan_single_image', template, {
        sceneNumber,
        prompt: motionPrompt,
        negativePrompt,
        seed,
        inputImageFilename: uploadResult.name,
        filenamePrefix: `Scene${sceneNumber}_video`,
      });

      // Queue workflow
      const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

      // Update job
      job.promptId = promptId;
      job.status = 'processing';
      job.updatedAt = Date.now();

      return {
        status: 'submitted',
        job_id: jobId,
        workflow: 'wan_single_image',
        message: `Single-image video generation job submitted. Use wait_for_job("${jobId}") to check status.`,
        params: {
          scene_number: sceneNumber,
          image_artifact: sceneImageArtifactId,
          motion_prompt: motionPrompt,
        },
      };
    } catch (error) {
      job.status = 'failed';
      job.error = String(error);
      job.updatedAt = Date.now();

      return {
        status: 'error',
        job_id: jobId,
        error: String(error),
      };
    }
  }
);

/**
 * Generate video from start and end frames tool.
 * This is a COMPLEX tool - requires user confirmation.
 *
 * Use this for TRANSITIONS between two different scene images.
 */
export const generateVideoFromFramesTool: ToolDefinition = createTool(
  'generate_video_from_frames',
  `Create a TRANSITION video between TWO different scene images.

**USE THIS TOOL WHEN:**
- Connecting Scene N to Scene N+1 (e.g., "transition from Scene 3 to Scene 4")
- You have TWO different scene images and need smooth motion between them
- Creating a video that starts at one composition and ends at another
- The character/camera needs to move from position A (start image) to position B (end image)

**DO NOT USE THIS TOOL WHEN:**
- You only have ONE scene image (use generate_video_from_image instead)
- You want to animate a single scene without transitioning to another

**Input:** TWO scene image artifacts (start_image + end_image)
**Output:** Video that smoothly transitions from start to end

**Example transition prompts:**
- "character walks from the doorway to the window"
- "camera smoothly dollies from wide shot to close-up"
- "smooth transition as the scene shifts from day to night"
- "the character turns and walks toward the camera"

**Typical workflow:**
1. Scene 3 image → generate_video_from_image (animate Scene 3)
2. Scene 3 + Scene 4 images → generate_video_from_frames (transition 3→4)
3. Scene 4 image → generate_video_from_image (animate Scene 4)

Returns a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      start_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the starting frame image',
      },
      end_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the ending frame image',
      },
      scene_number: {
        type: 'number',
        description: 'Scene number (use the scene number of the start frame)',
      },
      transition_prompt: {
        type: 'string',
        description: 'Description of the transition/motion between the two frames',
      },
      negative_prompt: {
        type: 'string',
        description: 'What to avoid in the video (optional)',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['start_image_artifact_id', 'end_image_artifact_id', 'scene_number', 'transition_prompt'],
  },
  async (args) => {
    const startImageArtifactId = args['start_image_artifact_id'] as string;
    const endImageArtifactId = args['end_image_artifact_id'] as string;
    const sceneNumber = args['scene_number'] as number;
    const transitionPrompt = args['transition_prompt'] as string;
    const negativePrompt = args['negative_prompt'] as string | undefined;
    const seed = args['seed'] as number | undefined;

    // Create job for tracking with context for linking
    const jobId = `vid-${Date.now()}-${nanoid(6)}`;
    const job: GenerationJob = {
      id: jobId,
      type: 'video',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      context: {
        entityType: 'scene',
        sceneNumber,
        artifactType: 'video',
      },
    };
    jobs.set(jobId, job);

    try {
      // Find both image files from artifact IDs
      const startImagePath = findImagePathFromArtifactId(startImageArtifactId);
      const endImagePath = findImagePathFromArtifactId(endImageArtifactId);

      if (!startImagePath || !getProjectFileOps().existsSync(startImagePath)) {
        throw new Error(`Start image not found for artifact: ${startImageArtifactId}`);
      }

      if (!endImagePath || !getProjectFileOps().existsSync(endImagePath)) {
        throw new Error(`End image not found for artifact: ${endImageArtifactId}`);
      }

      const registry = getRegistry();
      const workflowMetadata = registry.get('wan_start_end');

      if (!workflowMetadata) {
        throw new Error("Workflow 'wan_start_end' not found");
      }

      const basePath = getCurrentProjectBasePath();
      const assetsDir = path.join(basePath, PROJECT_DIR, AGENT_DIR, 'assets', 'videos');
      if (!getProjectFileOps().existsSync(assetsDir)) {
        getProjectFileOps().mkdirSync(assetsDir, { recursive: true });
      }

      const client = new ComfyUIClient({
        outputDir: assetsDir,
      });

      // Upload both images to ComfyUI
      const startUploadResult = await client.uploadImage(startImagePath, 'input', true);
      const endUploadResult = await client.uploadImage(endImagePath, 'input', true);

      // Load and parameterize the workflow
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      const workflow = parameterizeWorkflowByName('wan_start_end', template, {
        sceneNumber,
        prompt: transitionPrompt,
        negativePrompt,
        seed,
        startImageFilename: startUploadResult.name,
        endImageFilename: endUploadResult.name,
        filenamePrefix: `Scene${sceneNumber}_transition`,
      });

      // Queue workflow
      const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

      // Update job
      job.promptId = promptId;
      job.status = 'processing';
      job.updatedAt = Date.now();

      return {
        status: 'submitted',
        job_id: jobId,
        workflow: 'wan_start_end',
        message: `Start-end video generation job submitted. Use wait_for_job("${jobId}") to check status.`,
        params: {
          scene_number: sceneNumber,
          start_image_artifact: startImageArtifactId,
          end_image_artifact: endImageArtifactId,
          transition_prompt: transitionPrompt,
        },
      };
    } catch (error) {
      job.status = 'failed';
      job.error = String(error);
      job.updatedAt = Date.now();

      return {
        status: 'error',
        job_id: jobId,
        error: String(error),
      };
    }
  }
);

/**
 * Generate video tool (legacy wrapper).
 * This is a COMPLEX tool - requires user confirmation.
 *
 * This tool is kept for backward compatibility and routes to generate_video_from_image.
 */
export const generateVideoTool: ToolDefinition = createTool(
  'generate_video',
  `[LEGACY - prefer generate_video_from_image or generate_video_from_frames]

Generate a video from a scene image. This is a legacy tool that wraps generate_video_from_image.

For new implementations, use:
- generate_video_from_image: When you have ONE image to animate
- generate_video_from_frames: When you have TWO images (start/end) to interpolate

Returns a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      scene_image_artifact_id: {
        type: 'string',
        description: 'Artifact ID of the scene image to animate',
      },
      scene_number: {
        type: 'number',
        description: 'Scene number',
      },
      prompt: {
        type: 'string',
        description: 'Motion description for the video',
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['scene_image_artifact_id', 'scene_number'],
  },
  async (args) => {
    // Route to the new generate_video_from_image tool
    const newArgs = {
      scene_image_artifact_id: args['scene_image_artifact_id'],
      scene_number: args['scene_number'],
      motion_prompt: args['prompt'] || 'subtle motion and movement in the scene',
      seed: args['seed'],
    };

    // Call the handler of generate_video_from_image
    return generateVideoFromImageTool.handler!(newArgs);
  }
);

/**
 * Edit image tool.
 * This is a COMPLEX tool - requires user confirmation.
 */
export const editImageTool: ToolDefinition = createTool(
  'edit_image',
  `Edit an existing image based on a text prompt using ComfyUI's Qwen Edit workflow.

Uses intelligent editing to modify specific parts of an image.
The tool will return a job ID. Use wait_for_job to check completion.`,
  {
    type: 'object',
    properties: {
      scene_number: {
        type: 'number',
        description: 'Scene number for the edited image',
      },
      edit_prompt: {
        type: 'string',
        description: 'Description of the edit to make',
      },
      base_image_path: {
        type: 'string',
        description: 'Path or artifact ID of the image to edit',
      },
      negative_prompt: {
        type: 'string',
        description: 'What to avoid in the edit (optional)',
      },
      aspect_ratio: {
        type: 'string',
        description: 'Output aspect ratio (default: same as input)',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      seed: {
        type: 'number',
        description: 'Random seed for reproducibility (optional)',
      },
    },
    required: ['scene_number', 'edit_prompt', 'base_image_path'],
  },
  async (args) => {
    const params = args as unknown as ImageEditParams;

    // Create job for tracking with context for linking
    const jobId = `edit-${Date.now()}-${nanoid(6)}`;
    const job: GenerationJob = {
      id: jobId,
      type: 'image',
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      context: {
        entityType: 'scene',
        sceneNumber: params.scene_number,
        artifactType: 'image',
      },
    };
    jobs.set(jobId, job);

    try {
      const registry = getRegistry();
      const workflowMetadata = registry.get('qwen_edit');

      if (!workflowMetadata) {
        throw new Error("Workflow 'qwen_edit' not found");
      }

      // Resolve the image path
      const basePath = getCurrentProjectBasePath();
      let imagePath = params.base_image_path;
      if (!path.isAbsolute(imagePath) && !imagePath.startsWith('.')) {
        // Assume it's relative to project
        // imagePath is already relative to .kshana/, just join
        if (!imagePath.startsWith(PROJECT_DIR)) {
          imagePath = path.join(basePath, PROJECT_DIR, imagePath);
        } else {
          imagePath = path.join(basePath, imagePath);
        }
      }

      if (!getProjectFileOps().existsSync(imagePath)) {
        throw new Error(`Base image not found: ${params.base_image_path}`);
      }

      const assetsDir = getAssetsDir();
      const client = new ComfyUIClient({
        outputDir: assetsDir,
      });

      // Upload the base image
      const uploadResult = await client.uploadImage(imagePath, 'input', true);

      // Load and parameterize workflow
      const template = loadWorkflowTemplate(workflowMetadata.filename);
      const workflow = parameterizeWorkflowByName('qwen_edit', template, {
        sceneNumber: params.scene_number,
        prompt: params.edit_prompt,
        negativePrompt: params.negative_prompt,
        aspectRatio: params.aspect_ratio,
        seed: params.seed,
        inputImageFilename: uploadResult.name,
        filenamePrefix: `Scene${params.scene_number}_edit`,
      });

      // Queue workflow
      const promptId = await client.queueWorkflow(workflow as Record<string, unknown>);

      // Update job
      job.promptId = promptId;
      job.status = 'processing';
      job.updatedAt = Date.now();

      return {
        status: 'submitted',
        job_id: jobId,
        message: `Image edit job submitted. Use wait_for_job("${jobId}") to check status.`,
        params: {
          scene_number: params.scene_number,
          base_image: params.base_image_path,
          edit_prompt: params.edit_prompt,
        },
      };
    } catch (error) {
      job.status = 'failed';
      job.error = String(error);
      job.updatedAt = Date.now();

      return {
        status: 'error',
        job_id: jobId,
        error: String(error),
      };
    }
  }
);

/**
 * Wait for job tool.
 * Used to check the status of async generation jobs and download results.
 */
export const waitForJobTool: ToolDefinition = createTool(
  'wait_for_job',
  `Wait for a generation job to complete and get the result.

Use this after submitting generate_image, generate_video, or edit_image to check status.
When job completes, returns the artifact ID and file path.`,
  {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The job ID returned from a generation tool',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 300)',
      },
    },
    required: ['job_id'],
  },
  async (args) => {
    const jobId = args['job_id'] as string;
    const timeout = (args['timeout'] as number) || 300;
    const job = jobs.get(jobId);

    if (!job) {
      return {
        status: 'error',
        error: `Job not found: ${jobId}`,
      };
    }

    // If job is still pending/processing, wait for ComfyUI
    if (job.status === 'pending' || job.status === 'processing') {
      if (job.promptId) {
        const result = await waitForComfyUIJob(jobId, timeout);
        return {
          job_id: job.id,
          type: job.type,
          status: result.status,
          artifact_id: result.artifactId,
          file_path: result.filePath,
          error: result.error,
        };
      }
    }

    // Return current job status
    return {
      job_id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      artifact_id: job.result?.artifactId,
      file_path: job.result?.path,
      error: job.error,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
    };
  }
);

/**
 * Storyboard parameters for preview image generation.
 */
export interface StoryboardParams {
  /** Act or sequence number */
  act_number: number;
  /** Array of scene summaries to generate previews for */
  scene_summaries: Array<{
    scene_number: number;
    title: string;
    description: string;
  }>;
  /** Optional: Maximum number of preview images (default: 6) */
  max_images?: number;
}

/**
 * Get storyboard directory for storing preview images.
 */
function getStoryboardDir(): string {
  const basePath = getCurrentProjectBasePath();
  const storyboardDir = path.join(basePath, PROJECT_DIR, AGENT_DIR, 'assets', 'storyboard');
  if (!getProjectFileOps().existsSync(storyboardDir)) {
    getProjectFileOps().mkdirSync(storyboardDir, { recursive: true });
  }
  return storyboardDir;
}

/**
 * Generate storyboard preview images for an act.
 * Creates quick preview images for key scenes to help visualize the story flow.
 */
export const generateStoryboardTool: ToolDefinition = createTool(
  'generate_storyboard',
  `Generate storyboard preview images for a sequence of scenes.

USE THIS TOOL WHEN:
- User wants to see a visual preview of the story before detailed scene generation
- Planning scene composition and flow
- Getting quick visual feedback on story direction
- Visualizing key moments in an act

This tool generates ~6 quick preview images representing key moments.
The images are lower quality but faster to generate for quick iteration.

Returns an array of job IDs that can be tracked with wait_for_job.`,
  {
    type: 'object',
    properties: {
      act_number: {
        type: 'number',
        description: 'Act or sequence number for organizing storyboard images',
      },
      scene_summaries: {
        type: 'array',
        description: 'Array of scene summaries to generate preview images for',
        items: {
          type: 'object',
          properties: {
            scene_number: {
              type: 'number',
              description: 'Scene number',
            },
            title: {
              type: 'string',
              description: 'Scene title',
            },
            description: {
              type: 'string',
              description: 'Brief description of what happens in the scene (used as image prompt)',
            },
          },
          required: ['scene_number', 'title', 'description'],
        },
      },
      max_images: {
        type: 'number',
        description: 'Maximum number of preview images to generate (default: 6)',
      },
    },
    required: ['act_number', 'scene_summaries'],
  },
  async (args) => {
    const actNumber = args['act_number'] as number;
    const sceneSummaries = args['scene_summaries'] as StoryboardParams['scene_summaries'];
    const maxImages = (args['max_images'] as number) || 6;

    if (!sceneSummaries || sceneSummaries.length === 0) {
      return {
        status: 'error',
        error: 'No scene summaries provided',
      };
    }

    // Select up to maxImages scenes evenly distributed across the summaries
    const step = Math.max(1, Math.ceil(sceneSummaries.length / maxImages));
    const selectedScenes = sceneSummaries.filter((_, index) => index % step === 0).slice(0, maxImages);

    const jobIds: string[] = [];
    const storyboardDir = getStoryboardDir();

    console.log(`[Storyboard] Generating ${selectedScenes.length} preview images for Act ${actNumber}`);

    for (const scene of selectedScenes) {
      try {
        // Create storyboard-specific prompt (concise for fast generation)
        const storyboardPrompt = `Storyboard sketch: ${scene.description}. Cinematic composition, 16:9 aspect ratio.`;

        // Use zimage for fast generation with lower step count
        const filenamePrefix = `Storyboard_Act${actNumber}_Scene${scene.scene_number}`;

        const result = await submitImageGeneration({
          scene_number: scene.scene_number,
          prompt: storyboardPrompt,
          negative_prompt: 'blurry, low quality, text, watermark',
          aspect_ratio: '16:9',
          image_type: 'scene',
          generation_mode: 'text_to_image',
        });

        if (result.status === 'submitted' && result.jobId) {
          jobIds.push(result.jobId);
          console.log(`[Storyboard] Queued scene ${scene.scene_number}: ${result.jobId}`);
        } else {
          console.error(`[Storyboard] Failed to queue scene ${scene.scene_number}: ${result.error}`);
        }
      } catch (error) {
        console.error(`[Storyboard] Error generating scene ${scene.scene_number}:`, error);
      }
    }

    return {
      status: 'submitted',
      act_number: actNumber,
      job_ids: jobIds,
      total_images: jobIds.length,
      message: `Queued ${jobIds.length} storyboard preview images for Act ${actNumber}. Use wait_for_job with each job_id to track completion.`,
      scenes_selected: selectedScenes.map(s => s.scene_number),
    };
  }
);

function recomputeBatchCounts(batch: BackgroundGenerationBatch): void {
  batch.completedItems = batch.items.filter((item) => item.status === 'completed').length;
  batch.failedItems = batch.items.filter((item) => item.status === 'failed').length;
}

function emitBackgroundGenerationEvent(
  basePath: string,
  batch: BackgroundGenerationBatch,
): void {
  assetEventEmitter.emitBackgroundGeneration({
    batchId: batch.id,
    kind: batch.kind,
    status: batch.status,
    phase: batch.phase,
    totalItems: batch.totalItems,
    completedItems: batch.completedItems,
    failedItems: batch.failedItems,
    projectDirectory: basePath,
  });
}

function startBackgroundBatchRunner(
  basePath: string,
  projectId: string,
  batchId: string,
  kind: BackgroundGenerationKind,
): boolean {
  const key = getBatchRunnerKey(projectId, batchId);
  if (activeBatchRunners.has(key)) {
    return false;
  }

  const runner = (kind === 'image'
    ? runImageBatchSequentially(basePath, batchId)
    : runVideoBatchSequentially(basePath, batchId))
    .catch((error) => {
      console.error(`[background:${kind}] Batch ${batchId} failed with unhandled error:`, error);
      const failedBatch = persistBatchUpdate(basePath, batchId, (batch) => {
        batch.status = 'failed';
        batch.finishedAt = Date.now();
      });
      if (failedBatch) {
        emitBackgroundGenerationEvent(basePath, failedBatch);
      }
    })
    .finally(() => {
      activeBatchRunners.delete(key);
    });

  activeBatchRunners.set(key, runner);
  return true;
}

function getRetryItemsForBatch(
  basePath: string,
  batchId: string,
  expectedKind: BackgroundGenerationKind,
): { items: BackgroundGenerationItem[]; sourceFile: string } | { error: string } {
  const project = loadProject(basePath);
  if (!project?.backgroundGeneration) {
    return { error: 'No background generation state found in project.' };
  }

  const batch = project.backgroundGeneration.batches.find((entry) => entry.id === batchId);
  if (!batch) {
    return { error: `Background batch not found: ${batchId}` };
  }
  if (batch.kind !== expectedKind) {
    return { error: `Batch ${batchId} is ${batch.kind}, expected ${expectedKind}.` };
  }

  const failedItems = batch.items
    .filter((item) => item.status === 'failed')
    .map((item) => ({
      ...item,
      status: 'pending' as const,
      attempts: 0,
      error: undefined,
      artifactId: undefined,
      filePath: undefined,
      jobId: undefined,
      updatedAt: Date.now(),
    }));

  if (failedItems.length === 0) {
    return { error: `Batch ${batchId} has no failed items to retry.` };
  }

  return {
    items: failedItems,
    sourceFile: batch.sourceFile,
  };
}

/**
 * Extract video metadata using LLM for rich, context-aware extraction.
 * Returns null if LLM is not configured or fails.
 */
async function deriveVideoMetadataWithLLM(
  transcriptContent: string,
  contentPlanRaw: string | null,
  logPrefix: string,
): Promise<VideoMetadata | null> {
  const validation = validateLLMConfig();
  if (!validation.valid) {
    console.log(`${logPrefix} LLM not configured for metadata extraction; using regex fallback.`);
    return null;
  }

  try {
    // Build context from transcript and content plan
    const contextParts: string[] = [];
    if (transcriptContent.trim()) {
      contextParts.push(`## Transcript\n\n${transcriptContent.trim()}`);
    }
    if (contentPlanRaw && contentPlanRaw.trim()) {
      contextParts.push(`## Content Plan\n\n${contentPlanRaw.trim()}`);
    }
    if (contextParts.length === 0) return null;

    const systemPrompt = buildVideoMetadataPrompt(contextParts.join('\n\n'));

    const config = getLLMConfig();
    const client = new LLMClient(config);
    const response = await client.generate({
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content:
            'Analyze the transcript and content plan above. Extract comprehensive video metadata as JSON. Output valid JSON only, no commentary.',
        },
      ],
      temperature: 0.15,
      maxTokens: 2000,
    });

    const raw = (response.content ?? '').trim();
    if (!raw) {
      console.warn(`${logPrefix} LLM returned empty metadata response.`);
      return null;
    }

    // Extract JSON from response (may be wrapped in code fences)
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    const jsonStr = (jsonMatch[1] ?? raw).trim();

    const parsed = JSON.parse(jsonStr) as Partial<VideoMetadata>;
    if (!parsed || typeof parsed !== 'object') {
      console.warn(`${logPrefix} LLM metadata response was not a valid object.`);
      return null;
    }

    console.log(`${logPrefix} Successfully extracted video metadata via LLM.`);
    return normalizeVideoMetadata(parsed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `${logPrefix} LLM metadata extraction failed; falling back to regex. Error: ${msg}`,
    );
    return null;
  }
}

async function loadOrCreateVideoMetadata(
  transcriptContent: string | null,
  contentPlanRaw: string | null,
  logPrefix: string,
): Promise<VideoMetadata | null> {
  const existingJson = parseVideoMetadataJson(readProjectFile(VIDEO_METADATA_JSON_PATH));
  if (existingJson) {
    return existingJson;
  }

  const existingMarkdown = parseVideoMetadataMarkdown(readProjectFile(VIDEO_METADATA_MARKDOWN_PATH));
  if (existingMarkdown) {
    const serializedJson = `${JSON.stringify(existingMarkdown, null, 2)}\n`;
    writeProjectFile(VIDEO_METADATA_JSON_PATH, serializedJson);
    return existingMarkdown;
  }

  // Try AI-based extraction first for richer metadata
  if (transcriptContent && transcriptContent.trim()) {
    const llmDerived = await deriveVideoMetadataWithLLM(
      transcriptContent,
      contentPlanRaw,
      logPrefix,
    );
    if (llmDerived) {
      writeProjectFile(VIDEO_METADATA_JSON_PATH, `${JSON.stringify(llmDerived, null, 2)}\n`);
      writeProjectFile(VIDEO_METADATA_MARKDOWN_PATH, formatVideoMetadataMarkdown(llmDerived));
      console.log(`${logPrefix} Saved LLM-derived video metadata to ${VIDEO_METADATA_JSON_PATH}`);
      return llmDerived;
    }
  }

  // Fallback to regex-based extraction
  const derived = deriveVideoMetadata({
    transcriptContent,
    contentPlan: contentPlanRaw,
  });
  if (!derived) return null;

  writeProjectFile(VIDEO_METADATA_JSON_PATH, `${JSON.stringify(derived, null, 2)}\n`);
  writeProjectFile(VIDEO_METADATA_MARKDOWN_PATH, formatVideoMetadataMarkdown(derived));
  console.log(`${logPrefix} Saved regex-derived video metadata to ${VIDEO_METADATA_JSON_PATH}`);
  return derived;
}

async function prepareImagePlacementsForGeneration(
  placements: ParsedImagePlacement[],
  options: {
    expandPrompts: boolean;
    logExpandedPrompts: boolean;
    logPrefix: string;
  },
): Promise<PreparedImageGenerationPlacement[]> {
  const defaultNegativePrompt = 'blurry, low quality, text, watermark';
  const transcriptContent = readProjectFile('agent/content/transcript.md');
  const contentPlanRaw = readProjectFile('agent/plans/content-plan.md');
  const contentPlanSnippet =
    contentPlanRaw && contentPlanRaw.trim() ? contentPlanRaw.trim().slice(0, 1500) : undefined;
  const videoMetadata = await loadOrCreateVideoMetadata(
    transcriptContent,
    contentPlanRaw,
    options.logPrefix,
  );

  const prepared: PreparedImageGenerationPlacement[] = [];

  for (const placement of placements) {
    let prompt = placement.prompt;
    const transcriptSegment = getTranscriptSegmentForTimeRange(
      transcriptContent,
      placement.startTime,
      placement.endTime,
    );
    let negativePrompt = appendMetadataConstraintsToNegativePrompt(defaultNegativePrompt, videoMetadata);

    if (options.expandPrompts) {
      const expanded = await expandImagePlacementPrompt(placement, {
        transcriptSegment,
        contentPlan: contentPlanSnippet,
        videoMetadata,
      });
      if (expanded && 'error' in expanded) {
        console.warn(
          `${options.logPrefix} Placement ${placement.placementNumber}: prompt expansion failed (${expanded.error}); continuing with original placement prompt. ` +
            'In desktop: Settings → select OpenAI/Gemini, enter API key, Save & Restart.',
        );
      } else if (expanded && 'prompt' in expanded) {
        prompt = expanded.prompt;
        if (expanded.negativePrompt) {
          negativePrompt = appendMetadataConstraintsToNegativePrompt(
            expanded.negativePrompt,
            videoMetadata,
          );
        }
        console.log(`${options.logPrefix} Placement ${placement.placementNumber}: using expanded prompt`);
        if (options.logExpandedPrompts) {
          console.log(
            [
              `${options.logPrefix} --- BEGIN EXPANDED PROMPT (Placement ${placement.placementNumber}) ---`,
              expanded.prompt,
              `${options.logPrefix} --- END EXPANDED PROMPT (Placement ${placement.placementNumber}) ---`,
            ].join('\n'),
          );
          console.log(
            [
              `${options.logPrefix} --- BEGIN NEGATIVE PROMPT (Placement ${placement.placementNumber}) ---`,
              negativePrompt,
              `${options.logPrefix} --- END NEGATIVE PROMPT (Placement ${placement.placementNumber}) ---`,
            ].join('\n'),
          );
        } else {
          const maxPreview = 400;
          const preview =
            prompt.length <= maxPreview ? prompt : `${prompt.slice(0, maxPreview)}... (${prompt.length} chars total)`;
          console.log(`${options.logPrefix} Placement ${placement.placementNumber} expanded prompt (preview):\n${preview}`);
        }
      } else if (!expanded) {
        console.warn(
          `${options.logPrefix} Placement ${placement.placementNumber}: prompt expansion returned empty; continuing with original placement prompt`,
        );
      }
    }

    const guardResult = applyPromptContextGuard({
      prompt,
      mediaType: 'image',
      metadata: videoMetadata,
      placementPrompt: placement.prompt,
      transcriptSegment,
    });
    prompt = guardResult.prompt;
    if (guardResult.reason) {
      console.warn(
        `${options.logPrefix} Placement ${placement.placementNumber}: image prompt guard applied (${guardResult.reason})`,
      );
    }

    prepared.push({
      placementNumber: placement.placementNumber,
      startTime: placement.startTime,
      endTime: placement.endTime,
      prompt,
      negativePrompt,
    });
  }

  return prepared;
}

async function prepareVideoPlacementsForGeneration(
  placements: ParsedVideoPlacement[],
  options: {
    expandPrompts: boolean;
    logPrefix: string;
  },
): Promise<PreparedVideoGenerationPlacement[]> {
  const transcriptContent = readProjectFile('agent/content/transcript.md');
  const contentPlanRaw = readProjectFile('agent/plans/content-plan.md');
  const contentPlanSnippet =
    contentPlanRaw && contentPlanRaw.trim() ? contentPlanRaw.trim().slice(0, 1500) : undefined;
  const videoMetadata = await loadOrCreateVideoMetadata(
    transcriptContent,
    contentPlanRaw,
    options.logPrefix,
  );

  const prepared: PreparedVideoGenerationPlacement[] = [];
  for (const placement of placements) {
    let prompt = placement.prompt;
    const transcriptSegment = getTranscriptSegmentForTimeRange(
      transcriptContent,
      placement.startTime,
      placement.endTime,
    );
    if (options.expandPrompts) {
      const expanded = await expandVideoPlacementPrompt(placement, {
        transcriptSegment,
        contentPlan: contentPlanSnippet,
        videoMetadata,
      });
      if (expanded) {
        prompt = expanded;
        console.log(`${options.logPrefix} Placement ${placement.placementNumber}: using expanded prompt`);
      } else {
        console.warn(
          `${options.logPrefix} Placement ${placement.placementNumber}: prompt expansion unavailable; continuing with original placement prompt`,
        );
      }
    }

    const guardResult = applyPromptContextGuard({
      prompt,
      mediaType: 'video',
      metadata: videoMetadata,
      placementPrompt: placement.prompt,
      transcriptSegment,
    });
    prompt = guardResult.prompt;
    if (guardResult.reason) {
      console.warn(
        `${options.logPrefix} Placement ${placement.placementNumber}: video prompt guard applied (${guardResult.reason})`,
      );
    }

    prepared.push({
      placementNumber: placement.placementNumber,
      startTime: placement.startTime,
      endTime: placement.endTime,
      prompt,
      duration: placement.duration,
      videoType: placement.videoType,
    });
  }

  return prepared;
}

async function runImageGenerationSequentially(
  placements: PreparedImageGenerationPlacement[],
  logPrefix: string,
): Promise<Array<{
  placementNumber: number;
  status: 'success' | 'failed';
  artifactId?: string;
  filePath?: string;
  error?: string;
}>> {
  const results: Array<{
    placementNumber: number;
    status: 'success' | 'failed';
    artifactId?: string;
    filePath?: string;
    error?: string;
  }> = [];

  for (const placement of placements) {
    try {
      console.log(`${logPrefix} Submitting image generation for Placement ${placement.placementNumber}`);
      const submitResult = await submitImageGeneration({
        scene_number: placement.placementNumber,
        prompt: placement.prompt,
        negative_prompt: placement.negativePrompt,
        aspect_ratio: '16:9',
        image_type: 'scene',
        generation_mode: 'text_to_image',
      });

      if (submitResult.status !== 'submitted' || !submitResult.jobId) {
        const errorMsg = submitResult.error || 'Failed to submit image generation';
        results.push({
          placementNumber: placement.placementNumber,
          status: 'failed',
          error: errorMsg,
        });
        continue;
      }

      const timeout = getVideoGenerationTimeout();
      const waitResult = await waitForComfyUIJob(submitResult.jobId, timeout);
      if (waitResult.status === 'completed' && waitResult.artifactId && waitResult.filePath) {
        results.push({
          placementNumber: placement.placementNumber,
          status: 'success',
          artifactId: waitResult.artifactId,
          filePath: waitResult.filePath,
        });
      } else {
        results.push({
          placementNumber: placement.placementNumber,
          status: 'failed',
          error: waitResult.error || 'Image generation did not complete',
        });
      }
    } catch (error) {
      results.push({
        placementNumber: placement.placementNumber,
        status: 'failed',
        error: String(error),
      });
    }
  }

  return results;
}

async function runVideoGenerationSequentially(
  placements: PreparedVideoGenerationPlacement[],
  logPrefix: string,
): Promise<Array<{
  placementNumber: number;
  status: 'success' | 'failed';
  artifactId?: string;
  filePath?: string;
  error?: string;
}>> {
  const results: Array<{
    placementNumber: number;
    status: 'success' | 'failed';
    artifactId?: string;
    filePath?: string;
    error?: string;
  }> = [];

  for (const placement of placements) {
    try {
      console.log(`${logPrefix} Submitting video generation for Placement ${placement.placementNumber}`);
      const submitResult = await submitVideoPlacementGeneration({
        scene_number: placement.placementNumber,
        prompt: placement.prompt,
        duration: placement.duration,
        video_type: placement.videoType,
      });

      if (submitResult.status !== 'submitted' || !submitResult.jobId) {
        const errorMsg = submitResult.error || 'Failed to submit video generation';
        results.push({
          placementNumber: placement.placementNumber,
          status: 'failed',
          error: errorMsg,
        });
        continue;
      }

      const timeout = getVideoGenerationTimeout();
      const waitResult = await waitForComfyUIJob(submitResult.jobId, timeout);
      if (waitResult.status === 'completed' && waitResult.artifactId && waitResult.filePath) {
        results.push({
          placementNumber: placement.placementNumber,
          status: 'success',
          artifactId: waitResult.artifactId,
          filePath: waitResult.filePath,
        });
      } else {
        results.push({
          placementNumber: placement.placementNumber,
          status: 'failed',
          error: waitResult.error || 'Video generation did not complete',
        });
      }
    } catch (error) {
      results.push({
        placementNumber: placement.placementNumber,
        status: 'failed',
        error: String(error),
      });
    }
  }

  return results;
}

async function runImageBatchSequentially(basePath: string, batchId: string): Promise<void> {
  let batch = persistBatchUpdate(basePath, batchId, (entry) => {
    if (entry.status !== 'completed' && entry.status !== 'failed') {
      entry.status = 'running';
      entry.startedAt = entry.startedAt ?? Date.now();
      for (const item of entry.items) {
        if (item.status === 'processing') {
          item.status = 'pending';
          item.jobId = undefined;
        }
      }
      recomputeBatchCounts(entry);
    }
  });
  if (!batch) return;
  emitBackgroundGenerationEvent(basePath, batch);
  if (batch.status === 'completed' || batch.status === 'failed') return;

  for (const itemSnapshot of batch.items) {
    if (itemSnapshot.status === 'completed') continue;
    if (itemSnapshot.status === 'failed') continue;

    const itemId = itemSnapshot.placementNumber;
    batch = persistBatchUpdate(basePath, batchId, (entry) => {
      const item = entry.items.find((candidate) => candidate.placementNumber === itemId);
      if (!item || item.status === 'completed') return;
      item.status = 'processing';
      item.attempts += 1;
      item.updatedAt = Date.now();
      item.error = undefined;
      item.jobId = undefined;
      recomputeBatchCounts(entry);
    });
    if (!batch) return;

    const item = batch.items.find((candidate) => candidate.placementNumber === itemId);
    if (!item) continue;

    const submitResult = await submitImageGeneration({
      scene_number: item.placementNumber,
      prompt: item.prompt,
      negative_prompt: item.metadata?.negativePrompt ?? 'blurry, low quality, text, watermark',
      aspect_ratio: '16:9',
      image_type: 'scene',
      generation_mode: 'text_to_image',
    });

    if (submitResult.status !== 'submitted' || !submitResult.jobId) {
      persistBatchUpdate(basePath, batchId, (entry) => {
        const target = entry.items.find((candidate) => candidate.placementNumber === itemId);
        if (!target) return;
        target.status = 'failed';
        target.error = submitResult.error || 'Failed to submit image generation';
        target.updatedAt = Date.now();
        recomputeBatchCounts(entry);
      });
      continue;
    }

    persistBatchUpdate(basePath, batchId, (entry) => {
      const target = entry.items.find((candidate) => candidate.placementNumber === itemId);
      if (!target) return;
      target.jobId = submitResult.jobId;
      target.updatedAt = Date.now();
    });

    const waitResult = await waitForComfyUIJob(submitResult.jobId, getVideoGenerationTimeout());
    persistBatchUpdate(basePath, batchId, (entry) => {
      const target = entry.items.find((candidate) => candidate.placementNumber === itemId);
      if (!target) return;
      if (waitResult.status === 'completed' && waitResult.artifactId && waitResult.filePath) {
        target.status = 'completed';
        target.artifactId = waitResult.artifactId;
        target.filePath = waitResult.filePath;
        target.error = undefined;
      } else {
        target.status = 'failed';
        target.error = waitResult.error || 'Image generation did not complete';
      }
      target.updatedAt = Date.now();
      recomputeBatchCounts(entry);
    });
  }

  const finalized = persistBatchUpdate(basePath, batchId, (entry) => {
    recomputeBatchCounts(entry);
    entry.status = entry.failedItems > 0 ? 'failed' : 'completed';
    entry.finishedAt = Date.now();
  });
  if (finalized) {
    emitBackgroundGenerationEvent(basePath, finalized);
  }
}

async function runVideoBatchSequentially(basePath: string, batchId: string): Promise<void> {
  let batch = persistBatchUpdate(basePath, batchId, (entry) => {
    if (entry.status !== 'completed' && entry.status !== 'failed') {
      entry.status = 'running';
      entry.startedAt = entry.startedAt ?? Date.now();
      for (const item of entry.items) {
        if (item.status === 'processing') {
          item.status = 'pending';
          item.jobId = undefined;
        }
      }
      recomputeBatchCounts(entry);
    }
  });
  if (!batch) return;
  emitBackgroundGenerationEvent(basePath, batch);
  if (batch.status === 'completed' || batch.status === 'failed') return;

  for (const itemSnapshot of batch.items) {
    if (itemSnapshot.status === 'completed') continue;
    if (itemSnapshot.status === 'failed') continue;

    const itemId = itemSnapshot.placementNumber;
    batch = persistBatchUpdate(basePath, batchId, (entry) => {
      const item = entry.items.find((candidate) => candidate.placementNumber === itemId);
      if (!item || item.status === 'completed') return;
      item.status = 'processing';
      item.attempts += 1;
      item.updatedAt = Date.now();
      item.error = undefined;
      item.jobId = undefined;
      recomputeBatchCounts(entry);
    });
    if (!batch) return;

    const item = batch.items.find((candidate) => candidate.placementNumber === itemId);
    if (!item) continue;

    const submitResult = await submitVideoPlacementGeneration({
      scene_number: item.placementNumber,
      prompt: item.prompt,
      duration: item.metadata?.duration ?? 6,
      video_type: item.metadata?.videoType ?? 'cinematic_realism',
    });

    if (submitResult.status !== 'submitted' || !submitResult.jobId) {
      persistBatchUpdate(basePath, batchId, (entry) => {
        const target = entry.items.find((candidate) => candidate.placementNumber === itemId);
        if (!target) return;
        target.status = 'failed';
        target.error = submitResult.error || 'Failed to submit video generation';
        target.updatedAt = Date.now();
        recomputeBatchCounts(entry);
      });
      continue;
    }

    persistBatchUpdate(basePath, batchId, (entry) => {
      const target = entry.items.find((candidate) => candidate.placementNumber === itemId);
      if (!target) return;
      target.jobId = submitResult.jobId;
      target.updatedAt = Date.now();
    });

    const waitResult = await waitForComfyUIJob(submitResult.jobId, getVideoGenerationTimeout());
    persistBatchUpdate(basePath, batchId, (entry) => {
      const target = entry.items.find((candidate) => candidate.placementNumber === itemId);
      if (!target) return;
      if (waitResult.status === 'completed' && waitResult.artifactId && waitResult.filePath) {
        target.status = 'completed';
        target.artifactId = waitResult.artifactId;
        target.filePath = waitResult.filePath;
        target.error = undefined;
      } else {
        target.status = 'failed';
        target.error = waitResult.error || 'Video generation did not complete';
      }
      target.updatedAt = Date.now();
      recomputeBatchCounts(entry);
    });
  }

  const finalized = persistBatchUpdate(basePath, batchId, (entry) => {
    recomputeBatchCounts(entry);
    entry.status = entry.failedItems > 0 ? 'failed' : 'completed';
    entry.finishedAt = Date.now();
  });
  if (finalized) {
    emitBackgroundGenerationEvent(basePath, finalized);
  }

  if (finalized?.status === 'completed' && finalized.failedItems === 0) {
    const project = loadProject(basePath);
    if (project) {
      updatePhaseStatus(project, 'video_generation', 'completed', basePath);
      const refreshed = loadProject(basePath);
      if (refreshed?.currentPhase === WorkflowPhase.VIDEO_GENERATION) {
        await transitionToNextPhase(refreshed, basePath);
      }
    }
  }
}

export async function resumePendingBatches(
  basePath: string = getCurrentProjectBasePath(),
): Promise<{ resumed: number }> {
  const project = loadProject(basePath);
  if (!project?.backgroundGeneration) {
    return { resumed: 0 };
  }
  const state = ensureBackgroundGenerationState(project);
  const resumable = state.batches.filter((batch) => {
    if (batch.status !== 'queued' && batch.status !== 'running') return false;
    return state.activeBatchIds.includes(batch.id) || batch.status === 'queued' || batch.status === 'running';
  });

  let resumed = 0;
  for (const batch of resumable) {
    if (startBackgroundBatchRunner(basePath, project.id, batch.id, batch.kind)) {
      resumed += 1;
    }
  }

  if (resumed > 0) {
    state.lastResumedAt = Date.now();
    saveProject(project, basePath);
  }

  return { resumed };
}

export function __getActiveBatchRunnerCountForTests(): number {
  return activeBatchRunners.size;
}

export function __resetActiveBatchRunnersForTests(): void {
  activeBatchRunners.clear();
}

export const readBackgroundGenerationTool: ToolDefinition = createTool(
  'read_background_generation',
  `Read persistent background generation batch status for image/video runs.`,
  {
    type: 'object',
    properties: {
      batch_id: {
        type: 'string',
        description: 'Optional batch id filter.',
      },
      kind: {
        type: 'string',
        enum: ['image', 'video'],
        description: 'Optional generation kind filter.',
      },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'completed', 'failed'],
        description: 'Optional batch status filter.',
      },
      include_items: {
        type: 'boolean',
        description: 'Include per-placement item details (default: false).',
      },
    },
    required: [],
  },
  async (args) => {
    const project = loadProject();
    if (!project?.backgroundGeneration) {
      return {
        status: 'success',
        active_batch_ids: [],
        batches: [],
      };
    }

    const includeItems = args['include_items'] === true;
    const batchId = args['batch_id'] as string | undefined;
    const kind = args['kind'] as BackgroundGenerationKind | undefined;
    const statusFilter = args['status'] as BackgroundGenerationBatchStatus | undefined;

    const state = ensureBackgroundGenerationState(project);
    const batches = state.batches
      .filter((batch) => (batchId ? batch.id === batchId : true))
      .filter((batch) => (kind ? batch.kind === kind : true))
      .filter((batch) => (statusFilter ? batch.status === statusFilter : true))
      .map((batch) => ({
        id: batch.id,
        kind: batch.kind,
        status: batch.status,
        phase: batch.phase,
        source_file: batch.sourceFile,
        created_at: batch.createdAt,
        started_at: batch.startedAt,
        finished_at: batch.finishedAt,
        updated_at: batch.updatedAt,
        total_items: batch.totalItems,
        completed_items: batch.completedItems,
        failed_items: batch.failedItems,
        retry_of_batch_id: batch.retryOfBatchId,
        items: includeItems ? batch.items : undefined,
      }));

    return {
      status: 'success',
      active_batch_ids: state.activeBatchIds,
      total_batches: batches.length,
      batches,
    };
  },
);

/**
 * Generate all images for placements defined in image-placements.md.
 * Parses the file, extracts all placements, and generates images sequentially.
 * Each image is generated one at a time, waiting for completion before moving to the next.
 */
export const generateAllImagesTool: ToolDefinition = createTool(
  'generate_all_images',
  `Generate all images for placements defined in the image-placements.md file.

This tool:
1. Reads and parses agent/content/image-placements.md
2. Extracts all placement entries (Placement 1, 2, 3, etc.)
3. Optionally expands each placement prompt via LLM (image-generator–style, placement + transcript + content plan) into a detailed ComfyUI-ready prompt. Use expand_prompts: false to skip.
4. By default, queues a persistent background batch and returns immediately
5. Background worker generates sequentially and persists per-placement progress
6. Supports retry_failed_batch_id to retry only failed placements from a previous batch
7. Optionally runs synchronously when run_in_background: false

Use this tool during the image_generation phase to process all placements automatically.
The tool handles parsing, optional prompt expansion, background persistence, retries, and generation.`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to image-placements.md file (default: agent/content/image-placements.md)',
      },
      expand_prompts: {
        type: 'boolean',
        description: 'If true (default), expand each placement prompt with LLM before ComfyUI. Set false to use placement prompts as-is.',
      },
      log_expanded_prompts: {
        type: 'boolean',
        description:
          'If true, print the FULL expanded prompt and negative prompt for each placement. You can also set KSHANA_LOG_EXPANDED_PROMPTS=1.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'If true (default), queue and run generation in background. Set false for blocking execution.',
      },
      retry_failed_batch_id: {
        type: 'string',
        description: 'Retry only failed placements from this prior image batch id.',
      },
    },
    required: [],
  },
  async (args) => {
    const comfyUIAvailable = await ComfyUIClient.isAvailable();
    if (!comfyUIAvailable) {
      console.warn('[generate_all_images] ComfyUI unavailable - skipping image generation');
      return {
        status: 'error',
        error: 'ComfyUI is unavailable (health check failed).',
        suggestion: 'Skip IMAGE_GENERATION and proceed to INFOGRAPHICS_PLACEMENT. You can retry image generation after ComfyUI is back.',
        next_action: 'Call update_project to mark image_generation complete, then transition to the next phase.',
      };
    }

    const filePath = (args['file_path'] as string | undefined) || 'agent/content/image-placements.md';
    const expandPrompts = (args['expand_prompts'] as boolean | undefined) !== false;
    const runInBackground = (args['run_in_background'] as boolean | undefined) !== false;
    const retryFailedBatchId = args['retry_failed_batch_id'] as string | undefined;
    const basePath = getCurrentProjectBasePath();
    const logExpandedPrompts =
      (args['log_expanded_prompts'] as boolean | undefined) === true ||
      process.env['KSHANA_LOG_EXPANDED_PROMPTS'] === '1';

    let preparedPlacements: PreparedImageGenerationPlacement[] = [];
    let sourceFile = filePath;

    if (retryFailedBatchId) {
      const retry = getRetryItemsForBatch(basePath, retryFailedBatchId, 'image');
      if ('error' in retry) {
        return { status: 'error', error: retry.error };
      }
      sourceFile = retry.sourceFile;
      preparedPlacements = retry.items.map((item) => ({
        placementNumber: item.placementNumber,
        startTime: item.startTime,
        endTime: item.endTime,
        prompt: item.prompt,
        negativePrompt: item.metadata?.negativePrompt ?? 'blurry, low quality, text, watermark',
      }));
    } else {
      const content = readProjectFile(filePath);
      if (!content) {
        return {
          status: 'error',
          error: `Image placements file not found: ${filePath}`,
          suggestion: 'The image_placement phase must be completed first. Please run the image_placement phase to create the image-placements.md file, or call update_project with action: "update_phase" to return to the image_placement phase.',
          next_action: 'Complete the image_placement phase by creating agent/content/image-placements.md, then try generating images again.',
        };
      }

      let placements: ParsedImagePlacement[];
      try {
        const parseResult = parseImagePlacementsWithErrors(content, false, { validateOverlaps: true });
        placements = parseResult.placements;
        if (parseResult.warnings.length > 0) {
          console.warn('[generate_all_images] Parser warnings:', parseResult.warnings);
        }
        if (parseResult.errors.length > 0) {
          console.error('[generate_all_images] Parser errors (non-strict mode, continuing):', parseResult.errors);
          const errorDetails = parseResult.errors.map(e =>
            `Line ${e.line}: ${e.reason}${e.suggestion ? ` (${e.suggestion})` : ''}`,
          ).join('; ');
          console.error('[generate_all_images] Error details:', errorDetails);
        }

        const normalizedMarkdown = buildImagePlacementsMarkdown(placements);
        if (normalizedMarkdown.trim() !== content.trim()) {
          writeProjectFile(filePath, normalizedMarkdown);
        }

        if (placements.length === 0) {
          const errorMessages = parseResult.errors.length > 0
            ? `\n\nParser found ${parseResult.errors.length} error(s):\n${parseResult.errors.map(e =>
                `  Line ${e.line}: ${e.reason}${e.suggestion ? ` - ${e.suggestion}` : ''}`,
              ).join('\n')}`
            : '';

          return {
            status: 'error',
            error: 'No placements found in image-placements.md',
            suggestion: `The image-placements.md file exists but contains no valid placements.${errorMessages}\n\nPlease re-run the image_placement phase to create placements.`,
            next_action: 'Re-run the image_placement phase to identify and create image placements, then try generating images again.',
          };
        }
      } catch (error) {
        console.error('[generate_all_images] Unexpected error parsing placements:', error);
        return {
          status: 'error',
          error: `Failed to parse image placements: ${String(error)}`,
          suggestion: 'The image-placements.md file may be corrupted or in an invalid format. Please check the file or re-run the image_placement phase to regenerate it.',
          next_action: 'Review the image-placements.md file format, or re-run the image_placement phase to create a new placements file.',
        };
      }

      preparedPlacements = await prepareImagePlacementsForGeneration(placements, {
        expandPrompts,
        logExpandedPrompts,
        logPrefix: '[generate_all_images]',
      });
    }

    if (preparedPlacements.length === 0) {
      return {
        status: 'error',
        error: 'No placements available to generate.',
      };
    }

    if (runInBackground) {
      const now = Date.now();
      const batchItems: BackgroundGenerationItem[] = preparedPlacements.map((placement) => ({
        placementNumber: placement.placementNumber,
        startTime: placement.startTime,
        endTime: placement.endTime,
        prompt: placement.prompt,
        status: 'pending',
        attempts: 0,
        updatedAt: now,
        metadata: {
          negativePrompt: placement.negativePrompt,
        },
      }));

      const created = createBackgroundBatch(basePath, {
        kind: 'image',
        sourceFile,
        expandPrompts,
        retryOfBatchId: retryFailedBatchId,
        items: batchItems,
      });
      if (!created) {
        return {
          status: 'error',
          error: 'No active project found. Create or load a project before queuing background generation.',
        };
      }
      emitBackgroundGenerationEvent(basePath, created.batch);

      let autoTransitioned = false;
      let currentPhase: WorkflowPhase | undefined;
      const projectAfterQueue = loadProject(basePath);
      if (projectAfterQueue) {
        currentPhase = projectAfterQueue.currentPhase;
        if (projectAfterQueue.currentPhase === WorkflowPhase.IMAGE_GENERATION) {
          updatePhaseStatus(projectAfterQueue, 'image_generation', 'completed', basePath);
          const refreshed = loadProject(basePath);
          if (refreshed && refreshed.currentPhase === WorkflowPhase.IMAGE_GENERATION) {
            const transitionResult = await transitionToNextPhase(refreshed, basePath);
            autoTransitioned = transitionResult.transitioned;
            currentPhase = transitionResult.project.currentPhase;
          } else {
            currentPhase = refreshed?.currentPhase ?? currentPhase;
          }
        }
      }

      startBackgroundBatchRunner(basePath, created.projectId, created.batch.id, 'image');

      return {
        status: 'queued',
        batch_id: created.batch.id,
        total_placements: preparedPlacements.length,
        transitioned: autoTransitioned,
        current_phase: currentPhase,
        next_action: autoTransitioned
          ? 'Background image generation started and workflow has already moved to the next phase.'
          : 'Background image generation started. Continue workflow and use read_background_generation to monitor progress.',
        message: autoTransitioned
          ? `Queued ${preparedPlacements.length} image placements in background batch ${created.batch.id} and auto-transitioned to ${currentPhase}.`
          : `Queued ${preparedPlacements.length} image placements in background batch ${created.batch.id}.`,
      };
    }

    const results = await runImageGenerationSequentially(preparedPlacements, '[generate_all_images]');
    const successful = results.filter((result) => result.status === 'success');
    const failed = results.filter((result) => result.status === 'failed');

    return {
      status: 'completed',
      total_placements: preparedPlacements.length,
      successful: successful.length,
      failed: failed.length,
      results,
      message: `Generated ${successful.length} out of ${preparedPlacements.length} images. ${failed.length} failed.`,
    };
  }
);

/**
 * Generate all videos for placements defined in video-placements.md.
 * Parses the file, extracts all placements, and generates videos sequentially.
 * Each video is generated one at a time, waiting for completion before moving to the next.
 */
export const generateAllVideosTool: ToolDefinition = createTool(
  'generate_all_videos',
  `Generate all videos for placements defined in the video-placements.md file.

This tool:
1. Reads and parses agent/content/video-placements.md
2. Extracts all placement entries (Placement 1, 2, 3, etc.)
3. Optionally expands each placement prompt via LLM (video-placer–style, placement + transcript + content plan) into a detailed ComfyUI-ready video prompt. Use expand_prompts: false to skip.
4. By default, queues a persistent background batch and returns immediately
5. Background worker generates sequentially and persists per-placement progress
6. Supports retry_failed_batch_id to retry only failed placements from a previous batch
7. Optionally runs synchronously when run_in_background: false

Use this tool during the video_generation phase to process all placements automatically.
The tool handles all parsing, optional prompt expansion, sequential generation, and error handling internally.
Videos are generated from text prompts (no scene_image_artifact_id required).`,
  {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Path to video-placements.md file (default: agent/content/video-placements.md)',
      },
      expand_prompts: {
        type: 'boolean',
        description: 'If true (default), expand each placement prompt with LLM before ComfyUI. Set false to use placement prompts as-is.',
      },
      auto_fill_gaps: {
        type: 'boolean',
        description: 'If true (default), auto-generate video placements to fill timeline gaps before generating.',
      },
      run_in_background: {
        type: 'boolean',
        description: 'If true (default), queue and run generation in background. Set false for blocking execution.',
      },
      retry_failed_batch_id: {
        type: 'string',
        description: 'Retry only failed placements from this prior video batch id.',
      },
    },
    required: [],
  },
  async (args) => {
    const filePath = (args['file_path'] as string | undefined) || 'agent/content/video-placements.md';
    const expandPrompts = (args['expand_prompts'] as boolean | undefined) !== false;
    const autoFillGaps = (args['auto_fill_gaps'] as boolean | undefined) !== false;
    const runInBackground = (args['run_in_background'] as boolean | undefined) !== false;
    const retryFailedBatchId = args['retry_failed_batch_id'] as string | undefined;
    const basePath = getCurrentProjectBasePath();

    let preparedPlacements: PreparedVideoGenerationPlacement[] = [];
    let sourceFile = filePath;

    if (retryFailedBatchId) {
      const retry = getRetryItemsForBatch(basePath, retryFailedBatchId, 'video');
      if ('error' in retry) {
        return { status: 'error', error: retry.error };
      }
      sourceFile = retry.sourceFile;
      preparedPlacements = retry.items.map((item) => ({
        placementNumber: item.placementNumber,
        startTime: item.startTime,
        endTime: item.endTime,
        prompt: item.prompt,
        duration: item.metadata?.duration ?? 6,
        videoType: item.metadata?.videoType ?? 'cinematic_realism',
      }));
    } else {
      if (autoFillGaps) {
        await autoFillVideoPlacementGaps(filePath);
      }

      const content = readProjectFile(filePath);
      if (!content) {
        return {
          status: 'error',
          error: `Video placements file not found: ${filePath}`,
        };
      }

      let placements: ParsedVideoPlacement[];
      try {
        const parseResult = parseVideoPlacementsWithErrors(content, false, { validateOverlaps: true });
        placements = parseResult.placements;
        if (parseResult.warnings.length > 0) {
          console.warn('[generate_all_videos] Parser warnings:', parseResult.warnings);
        }
        if (parseResult.errors.length > 0) {
          console.warn('[generate_all_videos] Parser errors (non-strict mode):', parseResult.errors);
        }

        const normalizedMarkdown = buildVideoPlacementsMarkdown(
          placements.filter((placement) => !isAutoGapPrompt(placement.prompt)),
          placements.filter((placement) => isAutoGapPrompt(placement.prompt)),
        );
        if (normalizedMarkdown.trim() !== content.trim()) {
          writeProjectFile(filePath, normalizedMarkdown);
        }
      } catch (error) {
        return {
          status: 'error',
          error: `Failed to parse video placements: ${String(error)}`,
        };
      }

      if (placements.length === 0) {
        return {
          status: 'error',
          error: 'No placements found in video-placements.md',
        };
      }

      preparedPlacements = await prepareVideoPlacementsForGeneration(placements, {
        expandPrompts,
        logPrefix: '[generate_all_videos]',
      });
    }

    if (preparedPlacements.length === 0) {
      return {
        status: 'error',
        error: 'No placements available to generate.',
      };
    }

    if (runInBackground) {
      const now = Date.now();
      const batchItems: BackgroundGenerationItem[] = preparedPlacements.map((placement) => ({
        placementNumber: placement.placementNumber,
        startTime: placement.startTime,
        endTime: placement.endTime,
        prompt: placement.prompt,
        status: 'pending',
        attempts: 0,
        updatedAt: now,
        metadata: {
          duration: placement.duration,
          videoType: placement.videoType,
        },
      }));

      const created = createBackgroundBatch(basePath, {
        kind: 'video',
        sourceFile,
        expandPrompts,
        autoFillGaps,
        retryOfBatchId: retryFailedBatchId,
        items: batchItems,
      });
      if (!created) {
        return {
          status: 'error',
          error: 'No active project found. Create or load a project before queuing background generation.',
        };
      }
      emitBackgroundGenerationEvent(basePath, created.batch);

      startBackgroundBatchRunner(basePath, created.projectId, created.batch.id, 'video');
      return {
        status: 'queued',
        batch_id: created.batch.id,
        total_placements: preparedPlacements.length,
        next_action:
          'Background video generation started. Continue workflow and use read_background_generation to monitor progress. video_generation will auto-complete only when all placements succeed.',
        message: `Queued ${preparedPlacements.length} video placements in background batch ${created.batch.id}.`,
      };
    }

    const results = await runVideoGenerationSequentially(preparedPlacements, '[generate_all_videos]');
    const successful = results.filter((result) => result.status === 'success');
    const failed = results.filter((result) => result.status === 'failed');

    return {
      status: 'completed',
      total_placements: preparedPlacements.length,
      successful: successful.length,
      failed: failed.length,
      results,
      message: `Generated ${successful.length} out of ${preparedPlacements.length} videos. ${failed.length} failed.`,
    };
  }
);

/**
 * Resolve path to remotion-infographics package.
 * Priority:
 * 1. KSHANA_REMOTION_INFographics_DIR environment variable (set by desktop app)
 * 2. Check if remotion-infographics exists as sibling of kshana-ink (monorepo/dev)
 * 3. Check if remotion-infographics exists relative to kshana-ink location (when bundled)
 * 4. Fall back to relative path resolution from current file location
 */
function getRemotionInfographicsDir(): string {
  // 1. Check environment variable (set by desktop app)
  const envDir = process.env['KSHANA_REMOTION_INFographics_DIR'];
  if (envDir) {
    const envPath = String(envDir).trim();
    if (envPath && fs.existsSync(envPath)) {
      return envPath;
    }
  }

  // 2. Try to find remotion-infographics relative to kshana-ink location
  // When bundled in kshana-desktop, we might be at node_modules/kshana-ink/dist/...
  const toolsDir = path.dirname(fileURLToPath(import.meta.url));
  
  // Try multiple possible locations
  const possiblePaths = [
    // Monorepo/dev: kshana-ink/remotion-infographics (sibling of dist/)
    path.resolve(toolsDir, '..', '..', '..', '..', 'remotion-infographics'),
    // Bundled: node_modules/kshana-ink/remotion-infographics (sibling of dist/)
    path.resolve(toolsDir, '..', '..', 'remotion-infographics'),
    // Alternative bundled location
    path.resolve(toolsDir, '..', '..', '..', 'remotion-infographics'),
    // Fallback: original logic
    path.join(path.resolve(toolsDir, '..', '..', '..', '..'), 'remotion-infographics'),
  ];

  for (const candidatePath of possiblePaths) {
    if (fs.existsSync(candidatePath) && fs.existsSync(path.join(candidatePath, 'package.json'))) {
      return candidatePath;
    }
  }

  // If none found, return the most likely path (for error message)
  return path.resolve(toolsDir, '..', '..', '..', '..', 'remotion-infographics');
}

/**
 * Create the generate_all_infographics tool. When runRemotionAgent is provided, the tool
 * invokes the Remotion sub-agent to get animation recommendations before rendering.
 */
/**
 * Generate index.tsx content that imports and registers all generated components.
 */
function generateComponentIndex(componentNames: string[]): string {
  const imports = componentNames
    .map((name) => `import { ${name} } from './components/${name}';`)
    .join('\n');
  const compositions = componentNames
    .map(
      (name) => `      <Composition
        id="${name}"
        // @ts-ignore - Remotion Composition expects Record<string, unknown> but components use InfographicProps
        component={${name}}
        durationInFrames={5 * fps}
        fps={fps}
        width={1920}
        height={1080}
        defaultProps={{
          prompt: '',
          infographicType: 'statistic',
          data: {},
        }}
      />`
    )
    .join('\n');
  return `import React from 'react';
import { Composition, registerRoot } from 'remotion';
${imports}

const fps = 24;

const RemotionRoot: React.FC = () => {
  return (
    <>
${compositions}
    </>
  );
};

registerRoot(RemotionRoot);
`;
}

interface RenderReferenceErrorDetails {
  variableName: string;
  componentName?: string;
  placementNumber?: number;
}

/**
 * Rewrites common invalid JSX SVG references like `fill={waterGrad}` to `fill="url(#waterGrad)"`
 * when `waterGrad` is declared as an SVG id in this component's <defs> section.
 */
export function sanitizeGeneratedComponentCode(componentCode: string): string {
  const defsSectionPattern = /<defs[\s\S]*?<\/defs>/g;
  const idPattern = /\bid=["']([A-Za-z_][\w:-]*)["']/g;
  const svgIds = new Set<string>();

  for (const defsSection of componentCode.match(defsSectionPattern) ?? []) {
    let idMatch: RegExpExecArray | null;
    while ((idMatch = idPattern.exec(defsSection)) !== null) {
      if (idMatch[1]) svgIds.add(idMatch[1]);
    }
  }

  let sanitized = componentCode;

  if (svgIds.size > 0) {
    const attrPattern = /\b(fill|stroke|filter|clipPath|mask)=\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
    sanitized = sanitized.replace(attrPattern, (_m, attr: string, refName: string) => {
      if (!svgIds.has(refName)) return `${attr}={${refName}}`;
      return `${attr}="url(#${refName})"`;
    });
  }

  // Guard against unsupported easing names from generated code.
  sanitized = sanitized
    .replace(/\bEasing\.quart\b/g, 'Easing.quad')
    .replace(/\bEasing\.quint\b/g, 'Easing.quad');

  // Fix mismatched quotes in JSX/TSX attributes (e.g., attr="value' or attr='value")
  // This catches common LLM errors where opening and closing quotes don't match
  sanitized = sanitized.replace(
    /(\w+)=(["'])([^"']*?)(['"])/g,
    (match, attr, openQuote, value, closeQuote) => {
      // If quotes don't match, use the opening quote for both
      if (openQuote !== closeQuote) {
        console.warn(
          `[sanitizeGeneratedComponentCode] Fixed mismatched quotes: ${attr}=${openQuote}${value}${closeQuote} -> ${attr}=${openQuote}${value}${openQuote}`
        );
        return `${attr}=${openQuote}${value}${openQuote}`;
      }
      return match;
    }
  );

  // Warn on common 3D and CSS animation pitfalls.
  if (sanitized.includes('<ThreeCanvas')) {
    const hasWidth = /<ThreeCanvas[^>]*(\swidth=|\swidth=\{)/.test(sanitized);
    const hasHeight = /<ThreeCanvas[^>]*(\sheight=|\sheight=\{)/.test(sanitized);
    if (!hasWidth || !hasHeight) {
      console.warn('[sanitizeGeneratedComponentCode] ThreeCanvas missing width/height props.');
    }
  }
  if (/(animation\s*:|transition\s*:|@keyframes)/i.test(sanitized)) {
    console.warn('[sanitizeGeneratedComponentCode] CSS animations/transitions detected in component code.');
  }

  return sanitized;
}

/**
 * Validate basic syntax of generated component code before writing to file.
 * Catches common issues that would cause build failures (mismatched quotes, unclosed tags, etc.)
 * @returns Object with valid flag and optional error message
 */
function validateComponentSyntax(code: string): { valid: boolean; error?: string } {
  const issues: string[] = [];

  // Check for basic JSX tag balance (rough heuristic)
  // Count opening tags (not self-closing), closing tags, and self-closing tags
  const openTags = (code.match(/<\w+[^/>]*>/g) ?? []).filter(tag => !tag.endsWith('/>')).length;
  const closeTags = (code.match(/<\/\w+>/g) ?? []).length;
  const selfClosing = (code.match(/<\w+[^>]*\/>/g) ?? []).length;

  // Allow some tolerance since JSX fragments and complex nesting can throw off simple counting
  const tagDifference = Math.abs(openTags - closeTags);
  if (tagDifference > 2) {
    issues.push(`Potential tag mismatch: ${openTags} opening tags, ${closeTags} closing tags`);
  }

  // Check for obvious unmatched quotes in string literals
  // This is a heuristic - we look for strings that appear incomplete
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue; // Skip undefined/empty lines
    
    // Skip comment lines
    if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
      continue;
    }
    
    // Count quotes (excluding escaped quotes)
    const doubleQuotes = (line.match(/(?<!\\)"/g) ?? []).length;
    const singleQuotes = (line.match(/(?<!\\)'/g) ?? []).length;
    const backticks = (line.match(/(?<!\\)`/g) ?? []).length;

    // Each type of quote should appear in pairs (even number) on a single line
    // Allow odd counts for template literals and multi-line strings
    if (doubleQuotes % 2 !== 0 && !line.includes('`')) {
      issues.push(`Line ${i + 1}: Unmatched double quotes`);
    }
    if (singleQuotes % 2 !== 0 && !line.includes('`')) {
      issues.push(`Line ${i + 1}: Unmatched single quotes`);
    }
  }

  // Check for common syntax errors
  if (code.includes('=""') && code.includes("=''")) {
    // Mixed quote styles are fine, but check for the specific mismatched pattern
    const mismatchedPattern = /\w+=["'][^"']*['"](?!["'])/g;
    const matches = code.match(mismatchedPattern);
    if (matches && matches.length > 0) {
      issues.push(`Potentially mismatched quotes detected in ${matches.length} locations`);
    }
  }

  return issues.length > 0
    ? { valid: false, error: issues.join('; ') }
    : { valid: true };
}

interface BuildComponentErrorDetails {
  fileName: string;
  placementNumber?: number;
  line?: number;
  column?: number;
}

function parseBuildComponentError(detail: string): BuildComponentErrorDetails | null {
  const patterns = [
    /(Infographic(\d+)\.tsx):(\d+):(\d+)/,
    /\/components\/(Infographic(\d+)\.tsx)[\s\S]*?:(\d+):(\d+)/,
    /(Infographic(\d+)\.tsx)\((\d+),(\d+)\)/,
    /SyntaxError.*?(Infographic(\d+)\.tsx).*?line\s+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = detail.match(pattern);
    if (!match || !match[1]) continue;
    const fileName = match[1];
    const placementNumber =
      match[2] && !Number.isNaN(Number.parseInt(match[2], 10))
        ? Number.parseInt(match[2], 10)
        : undefined;
    const line =
      match[3] && !Number.isNaN(Number.parseInt(match[3], 10))
        ? Number.parseInt(match[3], 10)
        : undefined;
    const column =
      match[4] && !Number.isNaN(Number.parseInt(match[4], 10))
        ? Number.parseInt(match[4], 10)
        : undefined;
    return {
      fileName,
      placementNumber,
      line,
      column,
    };
  }
  return null;
}

function parseRenderReferenceError(stderr: string, stdout: string): RenderReferenceErrorDetails | null {
  const combined = `${stderr}\n${stdout}`;
  const referenceMatch = combined.match(/ReferenceError:\s*([A-Za-z_][A-Za-z0-9_]*)\s+is not defined/);
  if (!referenceMatch?.[1]) return null;
  const componentMatch = combined.match(/at\s+(Infographic(\d+))/);
  return {
    variableName: referenceMatch[1],
    componentName: componentMatch?.[1],
    placementNumber: componentMatch?.[2] ? parseInt(componentMatch[2], 10) : undefined,
  };
}

/** Result of an async process execution */
interface AsyncProcessResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: Error;
  timedOut?: boolean;
}

/** Progress update from Remotion render */
interface RemotionProgressUpdate {
  placementIndex?: number;
  totalPlacements?: number;
  progress?: number;
  stage?: string;
}

export function normalizeRemotionProgress(progress: number | undefined): number {
  if (progress === undefined || Number.isNaN(progress)) return 0;
  const normalized = progress > 1 ? progress / 100 : progress;
  if (normalized < 0) return 0;
  if (normalized > 1) return 1;
  return normalized;
}

/**
 * Run a command asynchronously with progress streaming support.
 * Parses REMOTION_PROGRESS logs from stdout to stream progress updates.
 */
async function runRemotionRenderAsync(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
    streamProgress?: (chunk: string) => void;
    totalPlacements?: number;
  },
): Promise<AsyncProcessResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let resolved = false;
    let lastProgressMessage = '';

    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
    });

    // Track progress for user-friendly updates
    let lastReportedPlacement = 0;
    let lastReportedProgress = 0;

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      stdout += output;

      // Parse REMOTION_PROGRESS logs for progress updates
      const lines = output.split('\n');
      for (const line of lines) {
        const match = line.match(/REMOTION_PROGRESS:(.+)/);
        if (match?.[1] && options.streamProgress) {
          try {
            const progress = JSON.parse(match[1]) as RemotionProgressUpdate;
            const placementIdx = (progress.placementIndex ?? 0) + 1; // Convert to 1-indexed
            const totalPlacements = progress.totalPlacements ?? options.totalPlacements ?? 1;
            const renderProgress = Math.round(normalizeRemotionProgress(progress.progress) * 100);
            const stage = progress.stage ?? 'rendering';

            // Only report meaningful progress changes
            const shouldReport =
              placementIdx !== lastReportedPlacement ||
              Math.abs(renderProgress - lastReportedProgress) >= 10 ||
              stage !== 'rendering';

            if (shouldReport) {
              lastReportedPlacement = placementIdx;
              lastReportedProgress = renderProgress;

              const progressMessage =
                stage === 'bundling'
                  ? `Building infographic ${placementIdx}/${totalPlacements}...`
                  : `Rendering infographic ${placementIdx}/${totalPlacements} (${renderProgress}%)`;

              // Avoid duplicate messages
              if (progressMessage !== lastProgressMessage) {
                lastProgressMessage = progressMessage;
                options.streamProgress(progressMessage + '\n');
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        timedOut = true;
        proc.kill('SIGTERM');
        // Give it a moment to terminate gracefully
        setTimeout(() => {
          if (!resolved) {
            proc.kill('SIGKILL');
          }
        }, 5000);
      }
    }, options.timeoutMs);

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({
        success: code === 0 && !timedOut,
        stdout,
        stderr,
        exitCode: code,
        timedOut,
      });
    });

    proc.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({
        success: false,
        stdout,
        stderr,
        exitCode: null,
        error,
        timedOut,
      });
    });
  });
}

/**
 * Run a build command asynchronously with progress streaming.
 */
async function runBuildAsync(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
    streamProgress?: (chunk: string) => void;
  },
): Promise<AsyncProcessResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let resolved = false;

    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: process.platform === 'win32',
    });

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      if (!resolved) {
        timedOut = true;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!resolved) {
            proc.kill('SIGKILL');
          }
        }, 5000);
      }
    }, options.timeoutMs);

    proc.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({
        success: code === 0 && !timedOut,
        stdout,
        stderr,
        exitCode: code,
        timedOut,
      });
    });

    proc.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      resolve({
        success: false,
        stdout,
        stderr,
        exitCode: null,
        error,
        timedOut,
      });
    });
  });
}

function createGenerateAllInfographicsTool(runRemotionAgent?: RunRemotionAgentCallback): ToolDefinition {
  return createTool(
    'generate_all_infographics',
    `Generate all infographics for placements defined in infographic-placements.md using Remotion.

Reads and parses agent/content/infographic-placements.md, then renders each placement as a short video clip
(charts, diagrams, statistics, etc.) via the Remotion infographics app. Outputs are saved to
agent/infographic-placements/ and registered in the manifest.`,
    {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to infographic-placements.md (default: agent/content/infographic-placements.md)',
        },
        expand_prompts: {
          type: 'boolean',
          description:
            'If true (default), expand each infographic prompt with LLM before Remotion generation. Set false to use placement prompts as-is.',
        },
        log_expanded_prompts: {
          type: 'boolean',
          description:
            'If true, log full expanded infographic prompts and data blocks. Can also set KSHANA_LOG_EXPANDED_PROMPTS=1.',
        },
      },
      required: [],
    },
    async (args, context) => {
      const streamProgress = context?.streamProgress;
      const filePath = (args['file_path'] as string | undefined) || 'agent/content/infographic-placements.md';
      const expandPrompts = (args['expand_prompts'] as boolean | undefined) !== false;
      const logExpandedPrompts =
        (args['log_expanded_prompts'] as boolean | undefined) === true ||
        process.env['KSHANA_LOG_EXPANDED_PROMPTS'] === '1';
      const basePath = getCurrentProjectBasePath();
      const content = readProjectFile(filePath, basePath);
      if (!content) {
        return {
          status: 'error',
          error: `Infographic placements file not found: ${filePath}`,
          suggestion: 'Complete the infographics_placement phase first to create infographic-placements.md.',
        };
      }

      let placements: ParsedInfographicPlacement[];
      try {
        const parseResult = parseInfographicPlacementsWithErrors(content, false, { validateOverlaps: true });
        placements = parseResult.placements;
        console.log(`[generate_all_infographics] Parsed ${placements.length} placements`);
        if (parseResult.warnings.length) console.warn('[generate_all_infographics] Warnings:', parseResult.warnings);
        if (parseResult.errors.length) console.warn('[generate_all_infographics] Parse errors:', parseResult.errors);

        const normalizedMarkdown = buildInfographicPlacementsMarkdown(placements);
        if (normalizedMarkdown.trim() !== content.trim()) {
          writeProjectFile(filePath, normalizedMarkdown, basePath);
        }
      } catch (e) {
        return {
          status: 'error',
          error: `Failed to parse infographic placements: ${String(e)}`,
        };
      }

      if (placements.length === 0) {
        console.log('[generate_all_infographics] No placements found, skipping generation');
        return {
          status: 'completed',
          total_placements: 0,
          successful: 0,
          failed: 0,
          results: [],
          message: 'No infographic placements found. Mark phase complete and transition.',
        };
      }

      console.log(`[generate_all_infographics] Found ${placements.length} placements to generate`);
      const transcriptContent = readProjectFile('agent/content/transcript.md');
      let contentPlanSnippet: string | undefined;
      const contentPlanRaw = readProjectFile('agent/plans/content-plan.md');
      if (contentPlanRaw && contentPlanRaw.trim()) {
        contentPlanSnippet = contentPlanRaw.trim().slice(0, 1500);
      }

      const placementsForGeneration: ParsedInfographicPlacement[] = [];
      let expandedCount = 0;
      let fallbackCount = 0;

      for (const placement of placements) {
        let nextPrompt = placement.prompt;
        let nextData = placement.data;
        if (expandPrompts) {
          const transcriptSegment = getTranscriptSegmentForTimeRange(
            transcriptContent,
            placement.startTime,
            placement.endTime,
          );
          const expanded = await expandInfographicPlacementPrompt(placement, {
            transcriptSegment,
            contentPlan: contentPlanSnippet,
          });
          if (expanded && 'error' in expanded) {
            fallbackCount += 1;
            console.warn(
              `[generate_all_infographics] Placement ${placement.placementNumber}: prompt expansion failed (${expanded.error}); using original prompt.`,
            );
          } else if (expanded && 'prompt' in expanded) {
            expandedCount += 1;
            nextPrompt = expanded.prompt;
            if (expanded.data && Object.keys(expanded.data).length > 0) {
              nextData = expanded.data;
            }
            if (logExpandedPrompts) {
              console.log(
                [
                  `[generate_all_infographics] --- BEGIN EXPANDED PROMPT (Placement ${placement.placementNumber}) ---`,
                  nextPrompt,
                  `[generate_all_infographics] --- END EXPANDED PROMPT (Placement ${placement.placementNumber}) ---`,
                ].join('\n'),
              );
              if (nextData && Object.keys(nextData).length > 0) {
                console.log(
                  [
                    `[generate_all_infographics] --- BEGIN EXPANDED DATA (Placement ${placement.placementNumber}) ---`,
                    JSON.stringify(nextData),
                    `[generate_all_infographics] --- END EXPANDED DATA (Placement ${placement.placementNumber}) ---`,
                  ].join('\n'),
                );
              }
            }
          } else {
            fallbackCount += 1;
            console.warn(
              `[generate_all_infographics] Placement ${placement.placementNumber}: prompt expansion unavailable; using original prompt.`,
            );
          }
        }

        placementsForGeneration.push({
          ...placement,
          prompt: nextPrompt,
          data: nextData,
        });
      }

      console.log('[generate_all_infographics] Prompt expansion summary', {
        enabled: expandPrompts,
        expandedCount,
        fallbackCount,
      });

      const remotionDir = getRemotionInfographicsDir();
      console.log(`[generate_all_infographics] Using remotion-infographics directory: ${remotionDir}`);
      if (!fs.existsSync(path.join(remotionDir, 'package.json'))) {
        console.error(`[generate_all_infographics] Package.json not found at ${remotionDir}`);
        return {
          status: 'error',
          error: `remotion-infographics package not found at ${remotionDir}. Ensure remotion-infographics is set up before running infographic generation.`,
          suggestion: 'This is a setup issue. Dependencies must be pre-installed. Check that remotion-infographics directory exists and has package.json.',
        };
      }
      // Check if dependencies are installed (check root node_modules first for workspace hoisting, then remotion-infographics/node_modules)
      const toolsDir = path.dirname(fileURLToPath(import.meta.url));
      // Find kshana-ink root (go up from dist/tasks/video/tools.js to root)
      const kshanaInkRoot = path.resolve(toolsDir, '..', '..', '..', '..');
      const rootNodeModules = path.join(kshanaInkRoot, 'node_modules');
      const remotionNodeModules = path.join(remotionDir, 'node_modules');
      
      // Check if @remotion/renderer exists in either location (indicates dependencies installed)
      const hasRootDeps = fs.existsSync(rootNodeModules) && fs.existsSync(path.join(rootNodeModules, '@remotion', 'renderer'));
      const hasRemotionDeps = fs.existsSync(remotionNodeModules) && fs.existsSync(path.join(remotionNodeModules, '@remotion', 'renderer'));
      
      if (hasRootDeps) {
        console.log('[generate_all_infographics] Dependencies found in root node_modules (workspace hoisting)');
      } else if (hasRemotionDeps) {
        console.log('[generate_all_infographics] Dependencies found in remotion-infographics/node_modules');
      } else {
        console.error('[generate_all_infographics] Dependencies not found in root or remotion-infographics node_modules');
        return {
          status: 'error',
          error: `remotion-infographics dependencies are not installed. Dependencies must be pre-installed before running infographic generation.`,
          suggestion: 'This is a setup issue that must be resolved manually. Run "pnpm install" at the kshana-ink root directory (workspace setup will install all dependencies including Remotion). The agent cannot install packages.',
        };
      }

      // Generate component code via Remotion agent.
      const componentsDir = path.join(remotionDir, 'src', 'components');
      fs.mkdirSync(componentsDir, { recursive: true });

      if (!runRemotionAgent) {
        console.log('[generate_all_infographics] Remotion agent not available, cannot generate components');
        return {
          status: 'error',
          error: 'Remotion agent callback not available. Component generation requires the Remotion sub-agent.',
          suggestion: 'Ensure the Remotion sub-agent is properly configured in the workflow.',
        };
      }

      // Clear NODE_OPTIONS to avoid inheriting ts-node/register from Electron dev env (not available in remotion-infographics)
      const remotionEnv = { ...process.env, NODE_OPTIONS: '' };
      const componentNames = placementsForGeneration.map((p) => `Infographic${p.placementNumber}`);
      const isPackaged = process.env['KSHANA_PACKAGED'] === '1' && process.env['NODE_ENV'] === 'production';
      const skillSelectionByPlacement = new Map<
        number,
        { selectedRules: string[]; selectedExamples: string[]; content: string }
      >();
      const writeComponentCode = (
        placement: ParsedInfographicPlacement,
        componentCode: string,
      ): {
        sanitizedCode: string;
        syntaxValidation: { valid: boolean; error?: string };
      } => {
        const componentFileName = `Infographic${placement.placementNumber}.tsx`;
        const componentPath = path.join(componentsDir, componentFileName);
        const sanitizedCode = sanitizeGeneratedComponentCode(componentCode);
        
        // Validate syntax before writing
        const syntaxValidation = validateComponentSyntax(sanitizedCode);
        if (!syntaxValidation.valid) {
          console.warn(
            `[generate_all_infographics] Component ${componentFileName} has potential syntax issues: ${syntaxValidation.error}`
          );
          console.warn('[generate_all_infographics] Writing anyway - build will catch any real errors');
        }
        
        fs.writeFileSync(componentPath, sanitizedCode, 'utf-8');
        console.log(`[generate_all_infographics] Wrote component: ${componentFileName}`);

        return {
          sanitizedCode,
          syntaxValidation,
        };
      };

      const rebuildBundle = async (): Promise<{
        ok: boolean;
        error?: string;
        buildFailure?: BuildComponentErrorDetails;
      }> => {
        console.log('[generate_all_infographics] Rebuilding Remotion bundle with new components...');
        streamProgress?.('Building Remotion components...\n');
        let detail = '';

        if (!isPackaged) {
          const buildResult = await runBuildAsync('pnpm', ['run', 'build'], {
            cwd: remotionDir,
            env: remotionEnv,
            timeoutMs: 120_000,
            streamProgress,
          });
          if (!buildResult.success) {
            detail = buildResult.stderr || String(buildResult.error ?? '');
          }
        } else {
          try {
            const entryPoint = path.join(remotionDir, 'src', 'index.tsx');
            const buildOutDir = path.join(remotionDir, 'build');

            if (!fs.existsSync(entryPoint)) {
              throw new Error(`Remotion entry point not found: ${entryPoint}`);
            }

            await bundle({
              entryPoint,
              outDir: buildOutDir,
              enableCaching: true,
              publicPath: '/',
              onProgress: (progress: number) => {
                const percent = Math.round(progress * 100);
                if (percent % 10 === 0 || percent === 100) {
                  streamProgress?.(
                    `Bundling: ${percent}%\n`,
                  );
                }
              },
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : '';
            detail = [errorMsg, errorStack].filter(Boolean).join('\n');
          }
        }

        if (detail) {
          console.error('[generate_all_infographics] Bundle failed:', detail);

          const buildFailure = parseBuildComponentError(detail);
          if (buildFailure) {
            console.error(
              `[generate_all_infographics] ✗ Syntax error in ${buildFailure.fileName} at line ${buildFailure.line ?? '?'}, column ${buildFailure.column ?? '?'}`,
            );
            console.error(`[generate_all_infographics] Common causes:`);
            console.error(`  - Mismatched quotes (e.g., attr="value' instead of attr="value")`);
            console.error(`  - Unclosed JSX tags or malformed JSX`);
            console.error(`  - Invalid JavaScript/TypeScript syntax`);
            console.error(
              `[generate_all_infographics] Check the component file for syntax errors before retrying`,
            );
          }

          return { ok: false, error: detail, buildFailure: buildFailure ?? undefined };
        }

        console.log('[generate_all_infographics] Bundle completed successfully');
        streamProgress?.('Bundle completed successfully\n');
        return { ok: true };
      };

      const MAX_BUILD_REMEDIATION_RETRIES = 2;
      const remediateBuildFailure = async (
        initialBuildResult: {
          ok: boolean;
          error?: string;
          buildFailure?: BuildComponentErrorDetails;
        },
      ): Promise<{ ok: boolean; error?: string; buildFailure?: BuildComponentErrorDetails }> => {
        let buildResult = initialBuildResult;
        let buildRetryAttempt = 0;

        while (!buildResult.ok && buildRetryAttempt < MAX_BUILD_REMEDIATION_RETRIES) {
          const failedPlacementNumber = buildResult.buildFailure?.placementNumber;
          if (!failedPlacementNumber) {
            break;
          }

          const failedPlacement = placementsForGeneration.find(
            (placement) => placement.placementNumber === failedPlacementNumber,
          );
          if (!failedPlacement) {
            break;
          }

          buildRetryAttempt += 1;
          const selectedSkills =
            skillSelectionByPlacement.get(failedPlacementNumber)?.content ??
            loadRemotionSkillsForInfographicType(
              failedPlacement.infographicType,
              failedPlacement.prompt,
            ).content;
          const lineHint = buildResult.buildFailure?.line;
          const columnHint = buildResult.buildFailure?.column;
          const locationHint =
            lineHint !== undefined
              ? `line ${lineHint}${columnHint !== undefined ? `, column ${columnHint}` : ''}`
              : 'the reported location';

          console.warn(
            `[generate_all_infographics] Remediating build failure in placement #${failedPlacementNumber} (${locationHint}) (retry ${buildRetryAttempt}/${MAX_BUILD_REMEDIATION_RETRIES})`,
          );

          const retryResult = await runRemotionAgent([failedPlacement], selectedSkills, {
            failedPlacementNumber,
            retryAttempt: buildRetryAttempt,
            userMessageSuffix:
              `The previous component failed to compile for placement ${failedPlacementNumber} at ${locationHint}. ` +
              `Regenerate ONLY this component with strict TSX syntax correctness. ` +
              `Avoid malformed JSX, unmatched tags/quotes, and invalid characters in JSX text.`,
          });
          const retryItem = retryResult.placements.find(
            (entry) => entry.placementNumber === failedPlacementNumber,
          );
          if (!retryItem) {
            return {
              ok: false,
              error: `Build remediation retry did not return placement ${failedPlacementNumber}.`,
              buildFailure: buildResult.buildFailure,
            };
          }

          writeComponentCode(failedPlacement, retryItem.componentCode);
          buildResult = await rebuildBundle();
        }

        return buildResult;
      };

      try {
        console.log('[generate_all_infographics] Calling Remotion sub-agent to generate component code...');

        for (const placement of placementsForGeneration) {
          const skillSelection = loadRemotionSkillsForInfographicType(
            placement.infographicType,
            placement.prompt,
          );
          skillSelectionByPlacement.set(placement.placementNumber, skillSelection);
          console.log('[generate_all_infographics] Skill selection', {
            placementNumber: placement.placementNumber,
            selectedRules: skillSelection.selectedRules,
            selectedExamples: skillSelection.selectedExamples,
          });

          const agentResult = await runRemotionAgent([placement], skillSelection.content);
          const item = agentResult.placements.find(
            (entry) => entry.placementNumber === placement.placementNumber,
          );
          if (!item) {
            throw new Error(
              `Remotion agent did not return component code for placement ${placement.placementNumber}`,
            );
          }

          writeComponentCode(placement, item.componentCode);
        }

        const indexContent = generateComponentIndex(componentNames);
        const indexPath = path.join(remotionDir, 'src', 'index.tsx');
        fs.writeFileSync(indexPath, indexContent, 'utf-8');
        console.log(`[generate_all_infographics] Updated index.tsx with ${componentNames.length} components`);
      } catch (e) {
        console.error('[generate_all_infographics] Remotion agent failed:', e);
        return {
          status: 'error',
          error: `Failed to generate component code: ${String(e)}`,
          suggestion: 'Check LLM configuration and ensure placements are valid.',
        };
      }

      const initialBuild = await remediateBuildFailure(await rebuildBundle());
      if (!initialBuild.ok) {
        return {
          status: 'error',
          error: `Remotion bundle failed after component generation. Build must succeed before running infographic generation. ${initialBuild.error ?? ''}`,
          suggestion:
            'Automatic remediation was attempted but build still failed. Inspect the reported Infographic*.tsx syntax error and rerun generation.',
        };
      }

      const payloadPlacements: Array<{
        placementNumber: number;
        startTime: string;
        endTime: string;
        infographicType: string;
        prompt: string;
        data?: Record<string, unknown>;
        componentName: string;
      }> = placementsForGeneration.map((p) => ({
        placementNumber: p.placementNumber,
        startTime: p.startTime,
        endTime: p.endTime,
        infographicType: p.infographicType,
        prompt: p.prompt,
        data: p.data,
        componentName: `Infographic${p.placementNumber}`,
      }));

      const projectOutDir = path.join(basePath, '.kshana', 'agent', 'infographic-placements');
      getProjectFileOps().mkdirSync(projectOutDir, { recursive: true });

      const isRemote = getProjectFileOps().isRemote();
      const localOutDir = isRemote
        ? path.join(tmpdir(), `kshana-render-${Date.now()}`)
        : projectOutDir;
      if (isRemote) {
        fs.mkdirSync(localOutDir, { recursive: true });
        console.log(`[generate_all_infographics] Remote mode: using local temp dir ${localOutDir}`);
      }
      console.log(`[generate_all_infographics] Output directory: ${localOutDir}`);

      const inputPath = path.join(localOutDir, '_render_input.json');
      const outputPath = path.join(localOutDir, '_render_output.json');
      
      console.log(`[generate_all_infographics] Writing render input with ${payloadPlacements.length} placements...`);
      fs.writeFileSync(inputPath, JSON.stringify({ placements: payloadPlacements }), 'utf-8');
      console.log(`[generate_all_infographics] Render input written to ${inputPath}`);

      const cleanupLocalTemp = () => {
        if (isRemote && localOutDir !== projectOutDir) {
          try { fs.rmSync(localOutDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      };

      const RENDER_TIMEOUT_MS = 600_000;
      const MAX_REMEDIATION_RETRIES = 2;
      let retryAttempt = 0;
      let renderResult: AsyncProcessResult;
      let lastReferenceError: RenderReferenceErrorDetails | null = null;

      while (true) {
        console.log(`[generate_all_infographics] Starting Remotion render (timeout: ${RENDER_TIMEOUT_MS / 1000}s)...`);
        streamProgress?.(
          `Starting render for ${placementsForGeneration.length} infographic${placementsForGeneration.length > 1 ? 's' : ''}...\n`,
        );
        
        renderResult = await runRemotionRenderAsync(
          'pnpm',
          ['run', 'render', '--', '--input', inputPath, '--outDir', localOutDir, '--output', outputPath],
          {
            cwd: remotionDir,
            env: remotionEnv,
            timeoutMs: RENDER_TIMEOUT_MS,
            streamProgress,
            totalPlacements: placementsForGeneration.length,
          }
        );

        if (renderResult.error) {
          const timeoutMsg = renderResult.timedOut ? ' Render timed out.' : '';
          const isModuleNotFound = renderResult.error.message?.includes('Cannot find module') || renderResult.error.message?.includes('MODULE_NOT_FOUND');

          console.error(`[generate_all_infographics] Render process error:`, renderResult.error);
          if (isModuleNotFound) {
            console.error('[generate_all_infographics] Module not found error detected');
            cleanupLocalTemp();
            return {
              status: 'error',
              error: `Remotion render failed: module not found. Dependencies must be pre-installed before running infographic generation.`,
              suggestion: 'This is a setup issue that must be resolved manually. Ensure remotion-infographics has all dependencies installed (run "pnpm install" in remotion-infographics directory). The agent cannot install packages.',
            };
          }

          cleanupLocalTemp();
          return {
            status: 'error',
            error: `Remotion render failed: ${String(renderResult.error)}${timeoutMsg}`,
            suggestion: 'Check remotion-infographics setup and dependencies. This is a setup issue that must be resolved manually.',
          };
        }

        if (renderResult.success) break;

        const stderr = renderResult.stderr;
        const stdout = renderResult.stdout;
        const isModuleNotFound = stderr.includes('Cannot find module') || stderr.includes('MODULE_NOT_FOUND') || stdout.includes('Cannot find module');
        lastReferenceError = parseRenderReferenceError(stderr, stdout);

        console.error(`[generate_all_infographics] Render failed with exit code ${renderResult.exitCode}`);
        if (stderr) console.error(`[generate_all_infographics] stderr:`, stderr.slice(0, 1000));
        if (stdout) console.log(`[generate_all_infographics] stdout:`, stdout.slice(0, 1000));

        if (isModuleNotFound) {
          console.error('[generate_all_infographics] Module not found error detected in stderr/stdout');
          cleanupLocalTemp();
          return {
            status: 'error',
            error: `Remotion render failed: module not found. Dependencies must be pre-installed before running infographic generation.`,
            suggestion: 'This is a setup issue that must be resolved manually. Ensure remotion-infographics has all dependencies installed (run "pnpm install" in remotion-infographics directory). The agent cannot install packages.',
            stderr: stderr.slice(0, 500),
          };
        }

        const failedPlacementNumber = lastReferenceError?.placementNumber;
        if (
          !lastReferenceError ||
          !failedPlacementNumber ||
          retryAttempt >= MAX_REMEDIATION_RETRIES
        ) {
          cleanupLocalTemp();
          return {
            status: 'error',
            error: `Remotion render failed (exit ${renderResult.exitCode}). stderr: ${stderr || 'none'}`,
            stdout: stdout,
            runtime_error: lastReferenceError
              ? {
                  variableName: lastReferenceError.variableName,
                  componentName: lastReferenceError.componentName,
                  placementNumber: lastReferenceError.placementNumber,
                }
              : undefined,
          };
        }

        const failedPlacement = placementsForGeneration.find((p) => p.placementNumber === failedPlacementNumber);
        if (!failedPlacement) {
          cleanupLocalTemp();
          return {
            status: 'error',
            error: `Remotion render failed for unknown placement ${failedPlacementNumber}. stderr: ${stderr || 'none'}`,
            runtime_error: {
              variableName: lastReferenceError.variableName,
              componentName: lastReferenceError.componentName,
              placementNumber: failedPlacementNumber,
            },
          };
        }

        retryAttempt += 1;
        console.warn(
          `[generate_all_infographics] Remediating placement #${failedPlacementNumber} after runtime error "${lastReferenceError.variableName}" (retry ${retryAttempt}/${MAX_REMEDIATION_RETRIES})`,
        );
        try {
          const selectedSkills =
            skillSelectionByPlacement.get(failedPlacementNumber)?.content ??
            loadRemotionSkillsForInfographicType(
              failedPlacement.infographicType,
              failedPlacement.prompt,
            ).content;
          const retryResult = await runRemotionAgent([failedPlacement], selectedSkills, {
            retryAttempt,
            failedPlacementNumber,
            failedComponentName: lastReferenceError.componentName,
            userMessageSuffix:
              `The previous component failed at runtime: ReferenceError: ${lastReferenceError.variableName} is not defined` +
              `${lastReferenceError.componentName ? ` in ${lastReferenceError.componentName}` : ''}.` +
              ' Regenerate ONLY this component with valid TSX. If referencing SVG defs ids, use strings like "url(#id)" instead of JS identifiers.',
          });
          const retryItem = retryResult.placements.find((item) => item.placementNumber === failedPlacementNumber);
          if (!retryItem) {
            cleanupLocalTemp();
            return {
              status: 'error',
              error: `Remotion retry failed: sub-agent did not return placement ${failedPlacementNumber}.`,
              runtime_error: {
                variableName: lastReferenceError.variableName,
                componentName: lastReferenceError.componentName,
                placementNumber: failedPlacementNumber,
              },
            };
          }
          writeComponentCode(failedPlacement, retryItem.componentCode);
          const retryBuild = await remediateBuildFailure(await rebuildBundle());
          if (!retryBuild.ok) {
            cleanupLocalTemp();
            return {
              status: 'error',
              error: `Remotion bundle failed after retrying placement ${failedPlacementNumber}. ${retryBuild.error ?? ''}`,
              runtime_error: {
                variableName: lastReferenceError.variableName,
                componentName: lastReferenceError.componentName,
                placementNumber: failedPlacementNumber,
              },
            };
          }
          continue;
        } catch (retryErr) {
          cleanupLocalTemp();
          return {
            status: 'error',
            error: `Failed to regenerate component for placement ${failedPlacementNumber}: ${String(retryErr)}`,
            runtime_error: {
              variableName: lastReferenceError.variableName,
              componentName: lastReferenceError.componentName,
              placementNumber: failedPlacementNumber,
            },
          };
        }
      }

      try {
        fs.unlinkSync(inputPath);
      } catch {
        /* ignore */
      }

    console.log('[generate_all_infographics] Render completed successfully');
    streamProgress?.(
      `All ${placementsForGeneration.length} infographic${placementsForGeneration.length > 1 ? 's' : ''} rendered successfully!\n`,
    );

    let outputs: string[] = [];
    try {
      const raw = fs.readFileSync(outputPath, 'utf-8');
      const out = JSON.parse(raw) as { outputs?: string[] };
      outputs = out.outputs ?? [];
      console.log(`[generate_all_infographics] Render output contains ${outputs.length} files`);
    } catch (e) {
      console.warn('[generate_all_infographics] Could not read or parse _render_output.json:', e);
    } finally {
      try {
        fs.unlinkSync(outputPath);
      } catch {
        /* ignore */
      }
    }

    if (isRemote && outputs.length > 0) {
      console.log(`[generate_all_infographics] Remote mode: proxying ${outputs.length} rendered files to desktop`);
      for (const outPath of outputs) {
        if (!outPath || !fs.existsSync(outPath)) continue;
        try {
          const fileBuffer = fs.readFileSync(outPath);
          const destPath = path.join(projectOutDir, path.basename(outPath));
          getProjectFileOps().writeFileSync(destPath, fileBuffer);
          console.log(`[generate_all_infographics] Proxied ${path.basename(outPath)} (${(fileBuffer.length / 1024).toFixed(0)} KB)`);
        } catch (proxyErr) {
          console.error(`[generate_all_infographics] Failed to proxy ${outPath}:`, proxyErr);
        }
      }
      cleanupLocalTemp();
    }

    const results: Array<{ placementNumber: number; status: 'success' | 'failed'; artifactId?: string; filePath?: string; error?: string }> = [];
    for (const outPath of outputs) {
      if (!outPath) {
        const placementNumber = results.length + 1;
        console.error(`[generate_all_infographics] ✗ Placement ${placementNumber}: Output path is undefined`);
        results.push({
          placementNumber,
          status: 'failed',
          error: 'Output path is undefined',
        });
        continue;
      }
      const baseName = path.parse(path.basename(outPath ?? '')).name;
      const match = baseName.match(/^info(\d+)_/);
      const placementNumber = match?.[1] ? parseInt(match[1], 10) : results.length + 1;
      const manifestPath = `agent/infographic-placements/${path.basename(outPath ?? '')}`;
      const artifactId = `info_${nanoid(8)}`;
      console.log(`[generate_all_infographics] Processing Placement ${placementNumber}: ${outPath}`);
      try {
        await addAsset(
          {
            id: artifactId,
            type: 'scene_infographic',
            path: manifestPath,
            createdAt: Date.now(),
            scene_number: placementNumber,
            metadata: { placementNumber },
          },
          basePath
        );
        console.log(`[generate_all_infographics] ✓ Placement ${placementNumber} completed successfully:`, {
          artifactId,
          filePath: manifestPath,
          placementNumber,
        });
        results.push({
          placementNumber,
          status: 'success',
          artifactId,
          filePath: manifestPath,
        });
      } catch (e) {
        const errorMsg = String(e);
        console.error(`[generate_all_infographics] ✗ Placement ${placementNumber} failed to register asset:`, errorMsg);
        results.push({
          placementNumber,
          status: 'failed',
          error: errorMsg,
        });
      }
    }

    const successful = results.filter((r) => r.status === 'success');
    const failed = results.filter((r) => r.status === 'failed');

    console.log(`[generate_all_infographics] Completed: ${successful.length} successful, ${failed.length} failed`);

    if (placementsForGeneration.length > 0 && successful.length === 0) {
      console.error('[generate_all_infographics] No infographics were generated - all placements failed');
      return {
        status: 'error',
        error:
          'No infographics were generated. Remotion may have failed or produced no output files. Check remotion-infographics build and stderr.',
        total_placements: placementsForGeneration.length,
        successful: 0,
        failed: failed.length,
        results,
        suggestion:
          'Run "pnpm run build" in kshana-ink/remotion-infographics, then retry. If it still fails, check _render_output.json and render stderr.',
      };
    }

    return {
      status: 'completed',
      total_placements: placementsForGeneration.length,
      successful: successful.length,
      failed: failed.length,
      results,
      message: `Generated ${successful.length} out of ${placementsForGeneration.length} infographics. ${failed.length} failed.`,
    };
  }
  );
}

/** Options for getVideoGenerationTools (e.g. runRemotionAgent for generate_all_infographics). */
export interface GetVideoGenerationToolsOptions {
  runRemotionAgent?: RunRemotionAgentCallback;
}

/**
 * Get all video generation tools. When runRemotionAgent is provided, generate_all_infographics
 * will invoke the Remotion sub-agent to get animation recommendations before rendering.
 */
export function getVideoGenerationTools(options?: GetVideoGenerationToolsOptions): ToolDefinition[] {
  const generateAllInfographicsTool = createGenerateAllInfographicsTool(options?.runRemotionAgent);
  return [
    generateImageTool,
    generateVideoPlacementTool,
    generateVideoFromImageTool,
    generateVideoFromFramesTool,
    editImageTool,
    generateStoryboardTool,
    generateAllImagesTool,
    generateAllVideosTool,
    generateAllInfographicsTool,
    readBackgroundGenerationTool,
    waitForJobTool,
  ];
}

/**
 * Register video tools as complex tools.
 * These require user confirmation before execution.
 */
export const VIDEO_COMPLEX_TOOLS = new Set([
  'generate_image',
  'generate_video_from_image',
  'generate_video_from_frames',
  'edit_image',
  'generate_storyboard',
  'generate_all_images',
  'generate_all_videos',
  'generate_all_infographics',
]);

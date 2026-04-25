/**
 * ExecutorAgent
 *
 * A drop-in replacement for GenericAgent that uses DependencyGraphExecutor
 * to drive the workflow deterministically. Presents the same event interface
 * so ConversationManager and the WebSocket layer work unchanged.
 *
 * The LLM is called as a pure content generator per node — no tools, no file
 * I/O, no navigation decisions. All dependency resolution, file reading, file
 * writing, and progress tracking happens in deterministic code.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname, relative } from 'path';
import { TypedEventEmitter } from '../../events/EventEmitter.js';
import { LLMClient } from '../llm/index.js';
import type { Message, GenerateOptions } from '../llm/types.js';
import { buildRouterFromEnv, type LLMRouter, type LLMPurpose } from '../llm/index.js';
import type { GenericAgentResult } from '../agent/AgentResult.js';
import type { ExpandableTodoItem } from '../todo/index.js';
import type {
  VideoTemplate,
  GenericProjectFile,
} from '../templates/types.js';
import type {
  ExecutionNode,
  ResolvedInputs,
  UserGoal,
} from './types.js';
import { DependencyGraphExecutor } from './DependencyGraphExecutor.js';
import { BackwardPlanner } from './BackwardPlanner.js';
import { AssetScanner } from './AssetScanner.js';
import { resolveInputs, writeOutput } from './contentResolver.js';
import { shouldExpandSceneCollectionToShots } from './collectionExpansion.js';
import {
  normalizeShotImagePrompt as normalizeShotImagePromptFrame,
  normalizeShotImagePromptWithRefs,
  alignFramesToFirstFrame,
  scanOTSWithSingleChar,
  type AvailableRefMinimal,
} from './shotImagePromptNormalizer.js';
import { extractCollectionItems } from './collectionExtractor.js';
import { healStaleMatchingDeps } from './stateHeal.js';
import { isStageGateSatisfied, resolveStageToTypeIds } from './stages.js';
import type { ArtifactCategory } from '../templates/types.js';
import { resolveGuide, loadContentTypeSkills, type SkillResolutionContext } from '../prompts/loader.js';
// Media generation imports
import {
  submitImageGeneration,
  parsePromptFile,
  jobs as mediaJobs,
} from '../../tasks/video/tools.js';
import { comfyProgressBus, type ComfyProgressHandler } from '../../services/comfyui/index.js';
import {
  loadTimeline,
  saveTimeline,
  createTimelineSkeleton,
  updateSegmentLayers,
  splitSegmentIntoShots,
  setSegmentTransition,
  validateTimeline,
} from '../timeline/TimelineManager.js';
import { assembleVideos, resolveSegmentFilePaths } from '../timeline/FFmpegAssembler.js';
import type { Timeline, SegmentDescriptor, TimelineLayerEntry } from '../timeline/types.js';
import type { TodoNodeInfo } from '../../events/events.js';
import { fitShotDurations } from './shotDurationFit.js';
import { scanMultiSpeakerShots, scanAmbiguousSpeakerTag } from './dialogueValidation.js';
import { validateWithSchema, normalizeSceneVideoPrompt, getPromptSchema } from './schemas.js';
import {
  validateContinuitySequence,
  checkPositionContinuity,
  formatWarnings as formatContinuityWarnings,
  shouldRerollShot,
} from './continuityValidator.js';
import { getProviderRegistry } from '../../services/providers/index.js';
import { getWorkflowModeRegistry } from '../../services/providers/WorkflowModeRegistry.js';
import { addAsset } from '../../tasks/video/workflow/index.js';

/**
 * Configuration for creating an ExecutorAgent.
 */
export interface ExecutorAgentConfig {
  template: VideoTemplate;
  project: GenericProjectFile;
  projectDir: string;
  goal: UserGoal;
  /** Name shown in events */
  name?: string;
  /**
   * When true, media generation (image/video via ComfyUI) runs in parallel
   * with LLM prompt generation. Use this when the image/video provider is on
   * a separate server from the LLM. When false (default), everything runs
   * serially — suitable when LLM and ComfyUI share the same machine.
   */
  parallelMediaGeneration?: boolean;
  /**
   * Stop the executor after any node of this type completes.
   * Used for testing — run one step at a time.
   * Example: stopAfterNodeType: 'plot' — runs until plot completes, then stops.
   */
  stopAfterNodeType?: string;
  /**
   * Stop the executor when every node of a given stage is terminal.
   *
   * A "stage" is a user-facing alias (e.g. 'character_image') that may
   * cover multiple typeIds (character_image + setting_image + object_image)
   * and multiple per-item children (character_image:alice, :bob, :glitch).
   * The gate fires only once ALL of them are in a terminal status
   * (completed | skipped | failed).
   *
   * Unlike stopAfterNodeType (which fires after the FIRST node of a type
   * completes — retained for legacy test-mode), this is the production
   * surface for the `/run-to <stage>` user command. See stages.ts for
   * the canonical alias table.
   */
  stopAtStage?: string;
  /**
   * Skip media generation (ComfyUI calls). Only generates LLM prompts.
   * Used for testing — validates prompt structure without calling image/video providers.
   */
  skipMediaGeneration?: boolean;
}

/**
 * Category-specific system prompt instructions for the executor.
 * These are tool-free — the LLM generates content directly from pre-loaded context.
 */
const CATEGORY_PROMPTS: Record<ArtifactCategory, string> = {
  concept: `You are a creative writer. Generate a detailed plot outline or concept document.
Write in clear prose. Include key themes, character motivations, and narrative arc.
Output ONLY the content.`,

  structure: `You are a creative writer. Generate a detailed narrative or structural document.
Write rich, engaging prose with dialogue, description, and pacing.
Output ONLY the content.`,

  entity: `You are a creative writer specializing in character and entity profiles.
Create a detailed profile including physical description, personality, motivations, and background.
Output ONLY the profile content.`,

  environment: `You are a creative writer specializing in setting and environment descriptions.
Create a vivid, detailed description of the location including atmosphere, key features, and sensory details.
Output ONLY the description.`,

  segment: `You are a creative writer specializing in cinematic scene descriptions.
Create a detailed, shootable scene description with visual direction.
Output ONLY the scene content.`,

  visual_ref: `You are an expert reference image prompt engineer.
Output ONLY valid JSON.

The JSON must follow this exact structure:
{
  "imagePrompt": "<detailed image generation prompt — flowing prose, 80-250 words>",
  "negativePrompt": "<things to avoid>",
  "aspectRatio": "<ratio like 16:9, 1:1, etc.>"
}

Follow the guide instructions EXACTLY — especially regarding background, lighting, and pose.`,

  clip: `You are a video direction expert.
Follow the guide instructions to produce the motion prompt.
Output ONLY the JSON result.`,

  final: `You are a video assembly specialist.
Generate assembly instructions for combining video clips into a final video.`,
};

/**
 * ExecutorAgent — drives the dependency graph deterministically.
 *
 * Extends TypedEventEmitter so ConversationManager can listen to events
 * using the same pattern as GenericAgent.
 */
export class ExecutorAgent extends TypedEventEmitter {
  private llm: LLMClient;
  private router: LLMRouter;
  /**
   * In-memory lock: tracks which project directories have an active executor.
   * Prevents multiple ExecutorAgent instances in the same process from
   * running concurrently on the same project (e.g. multiple WebSocket sessions).
   */
  private static activeProjects = new Map<string, { sessionId: string; startedAt: number }>();

  private executor: DependencyGraphExecutor;
  private config: ExecutorAgentConfig;
  private running = false;
  private stopped = false;
  /**
   * Resolved typeIds for the current `/run-to <stage>` gate. Null when no
   * gate is active. Set from config.stopAtStage at construction time and
   * from `setStopAtStage(stage | null)` at runtime per-task.
   */
  private stopAtStageTypeIds: Set<string> | null = null;
  /**
   * Why the executor last stopped. Reset at the top of each run().
   * Read by ConversationManager/WebSocketHandler to distinguish
   * "paused at stage gate" from "completed" / "cancelled" / "failed"
   * so the UI can show the right banner.
   */
  private stopReason: 'complete' | 'paused_at_stage' | 'cancelled' | 'failed' | null = null;
  private vlmDisabled = process.env['DISABLE_VLM'] === 'true'; // Env flag or auto-disabled after first 404
  private sceneSummaries = new Map<string, string>(); // scene_1 → summary text
  private _initialized = false;
  private logPath: string;
  private lockFilePath: string;
  private currentPhase = '';
  private retriedNodes = new Set<string>();
  /** Pending media generation promises (parallel mode) */
  private pendingMedia = new Map<string, Promise<string | null>>();
  /** Timeline state — populated during execution, saved to timeline.json */
  private timeline: Timeline | null = null;
  /** Tracks how many times a dependency was regenerated for a given parent node (loop protection) */
  private depRegenCounts = new Map<string, number>();
  /**
   * When set, the next run() only executes nodes in this set (filters readyNodes).
   * Used by redoNode to isolate redo to the targeted node, so other pending work
   * in the graph does not auto-resume. Cleared at the start of each run().
   */
  private redoOnlyNodes: Set<string> | null = null;
  /**
   * Shot node IDs that have already had a continuity-reroll hint injected.
   * Prevents the hint from being applied twice on re-runs of the same node.
   */
  private retriedContinuity = new Set<string>();

  constructor(llm: LLMClient, config: ExecutorAgentConfig) {
    super();
    this.llm = llm;
    this.config = config;
    // Resolve the stage gate up-front if provided via config. Throws early on
    // invalid stage names so misconfiguration fails at construction, not
    // silently during the loop.
    if (config.stopAtStage) {
      const resolved = resolveStageToTypeIds(config.stopAtStage);
      if (!resolved) {
        throw new Error(
          `Unknown stopAtStage: '${config.stopAtStage}'. See stages.ts VALID_STAGES.`,
        );
      }
      this.stopAtStageTypeIds = new Set(resolved);
    }
    // Build per-call router. When LLM_ROUTING_ENABLED=false (default), every
    // purpose resolves to the default client so behavior is unchanged.
    this.router = buildRouterFromEnv(config.projectDir);
    if (this.router.isEnabled()) {
      // Best-effort: log routing status to the executor log after initialization
      setImmediate(() => this.log('LLM routing ENABLED — per-purpose model selection active'));
    }

    // Set up log file — try project dir first, fall back to cwd
    const projectLogsDir = join(config.projectDir, 'logs');
    const cwdLogsDir = join(process.cwd(), 'logs');
    const logsDir = existsSync(config.projectDir) ? projectLogsDir : cwdLogsDir;
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
    this.logPath = join(logsDir, 'executor.log');
    this.lockFilePath = join(config.projectDir, '.executor.lock');
    this.log('=== ExecutorAgent initialized ===');
    this.log(`Template: ${config.template.id}, Goal: ${config.goal.description}`);
    this.log(`Target artifacts: ${config.goal.targetArtifacts.join(', ')}`);
    this.log(`Preferences: ${JSON.stringify(config.goal.preferences)}`);

    // Build or restore executor
    if (config.project.executorState) {
      this.executor = DependencyGraphExecutor.fromState(
        config.project.executorState,
        config.template,
      );
      // Reset stuck nodes from previous session:
      // - 'failed' nodes: transient errors, retry them
      // - 'in_progress'/'ready' nodes: server crashed mid-execution, reset to pending
      const stuckNodes = this.executor.getAllNodes().filter(
        n => n.status === 'failed' || n.status === 'in_progress' || n.status === 'ready',
      );
      if (stuckNodes.length > 0) {
        this.log(`Resetting ${stuckNodes.length} stuck node(s) for retry: ${stuckNodes.map(n => `${n.id}(${n.status})`).join(', ')}`);
        for (const node of stuckNodes) {
          this.executor.invalidateNode(node.id);
        }
      }

      // Repair missing nodes: if a node references a dependency that doesn't exist,
      // recreate it from the template. This fixes graph corruption from manual resets.
      this.repairMissingNodes();

      // Heal stale matching-scope deps that an earlier buggy version of the
      // dangling-dep cleanup may have silently stripped (see stateHeal.ts).
      // Safe to run on every resume — idempotent when deps are healthy.
      try {
        const report = healStaleMatchingDeps(this.executor, config.template);
        if (report.added > 0) {
          this.log(`State heal: restored ${report.added} stale matching-scope dep(s)`);
          for (const d of report.details) {
            this.log(`  ${d.nodeId} ← ${d.restoredDep}`);
          }
          this.persistState();
        }
      } catch (err) {
        this.log(`State heal skipped: ${(err as Error).message}`);
      }
    } else {
      const scanner = new AssetScanner(config.template);
      const scanResult = scanner.scan(config.projectDir, config.project);
      const planner = new BackwardPlanner(config.template);
      const plan = planner.buildPlan(config.goal, scanResult.registry);
      this.executor = DependencyGraphExecutor.fromPlan(plan, config.template);
    }
  }

  /**
   * Acquire a project-level lock to prevent concurrent executor runs.
   * Uses an in-memory static map (handles same-process concurrency from multiple
   * WebSocket sessions) plus a lock file (handles cross-process concurrency).
   */
  private acquireProjectLock(): boolean {
    const projectDir = this.config.projectDir;
    const sessionId = this.config.name ?? 'unknown';

    // 1. Check in-memory lock (same-process concurrency)
    const existing = ExecutorAgent.activeProjects.get(projectDir);
    if (existing) {
      // Stale lock check: if the lock is older than 30 minutes, assume it's stale
      // (executor crashed, WebSocket dropped, server hot-reloaded without cleanup)
      const ageMs = Date.now() - existing.startedAt;
      const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
      if (ageMs > STALE_THRESHOLD_MS) {
        this.log(`Removing stale in-memory lock (session=${existing.sessionId}, age=${Math.round(ageMs / 60000)}m)`);
        ExecutorAgent.activeProjects.delete(projectDir);
      } else {
        this.log(`LOCK BLOCKED (in-memory): project already has active executor from session=${existing.sessionId}, started=${new Date(existing.startedAt).toISOString()}`);
        return false;
      }
    }

    // 2. Check file-based lock (cross-process concurrency)
    try {
      if (existsSync(this.lockFilePath)) {
        const lockContent = readFileSync(this.lockFilePath, 'utf-8');
        const match = lockContent.match(/pid=(\d+)/);
        if (match) {
          const lockPid = parseInt(match[1]!, 10);
          if (lockPid !== process.pid) {
            try {
              process.kill(lockPid, 0);
              // Different process is still alive
              this.log(`LOCK BLOCKED (file): another process is running (pid=${lockPid})`);
              return false;
            } catch {
              // Process is dead — stale lock
              this.log(`Removing stale lock file (pid=${lockPid} is dead)`);
            }
          }
        }
      }
    } catch { /* ignore file errors */ }

    // 3. Acquire both locks
    ExecutorAgent.activeProjects.set(projectDir, { sessionId, startedAt: Date.now() });
    try {
      writeFileSync(this.lockFilePath, `pid=${process.pid}\nsession=${sessionId}\nstarted=${new Date().toISOString()}\n`);
    } catch { /* file lock is best-effort */ }

    this.log(`Lock acquired (session=${sessionId}, pid=${process.pid})`);
    return true;
  }

  /**
   * Release the project-level lock.
   */
  private releaseProjectLock(): void {
    const projectDir = this.config.projectDir;

    // Release in-memory lock
    ExecutorAgent.activeProjects.delete(projectDir);

    // Release file lock
    try {
      if (existsSync(this.lockFilePath)) {
        unlinkSync(this.lockFilePath);
      }
    } catch { /* ignore */ }

    this.log(`Lock released (pid=${process.pid})`);
  }

  /**
   * Write a timestamped line to the executor log.
   */
  private log(message: string): void {
    try {
      const timestamp = new Date().toISOString();
      appendFileSync(this.logPath, `[${timestamp}] ${message}\n`);
    } catch {
      // Ignore logging errors
    }
  }

  /**
   * Get the LLMClient configured for a specific call purpose.
   * When LLM_ROUTING_ENABLED=false (default), returns the default client.
   * When enabled, resolves via the router's purpose/tier/default chain.
   */
  private llmFor(purpose: LLMPurpose): LLMClient {
    return this.router.isEnabled() ? this.router.getClient(purpose) : this.llm;
  }

  /**
   * Return the model name that will be used for a given LLM call purpose.
   * Used for UI display — each tool_call event attaches this so the user can
   * see which model produced a given prompt/output. Works with or without
   * per-purpose routing enabled.
   */
  private modelFor(purpose: LLMPurpose): string {
    try {
      return this.router.resolveConfig(purpose).model ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Map an artifact node typeId to an LLM purpose for per-call routing.
   * Unknown types fall back to content.scene as a reasonable default.
   */
  private purposeForNode(node: ExecutionNode): LLMPurpose {
    switch (node.typeId) {
      case 'story':           return 'content.story';
      case 'plot':            return 'content.plot';
      case 'character':       return 'content.character';
      case 'setting':         return 'content.setting';
      case 'object':          return 'content.setting'; // similar scope to setting
      case 'scene':           return 'content.scene';
      case 'world_style':     return 'content.world_style';
      case 'character_image': return 'content.character';
      case 'setting_image':   return 'content.setting';
      case 'object_image':    return 'content.setting';
      case 'scene_video_prompt':    return 'structured.scene_breakdown';
      case 'shot_image_prompt':     return 'content.shot_image_prompt';
      case 'shot_motion_directive': return 'content.shot_motion_directive';
      default:                return 'content.scene';
    }
  }

  /**
   * Resolve an array of LLM reference objects ({refId, type, ...}) to absolute file paths.
   * Uses the same resolution logic as image_text_to_image — looks up each refId in the
   * executor graph and returns paths to completed .png files.
   */
  private resolveRefIds(references: Array<{ refId?: string; type?: string }>): string[] {
    if (!references || references.length === 0) return [];
    const paths: string[] = [];
    for (const ref of references) {
      if (!ref.refId) continue;
      const refNode = this.executor.getNode(ref.refId);
      if (refNode?.outputPath?.endsWith('.png')) {
        paths.push(join(this.config.projectDir, refNode.outputPath));
      }
    }
    return paths;
  }

  /**
   * Edit an image with layered references. FLUX Klein supports up to 4 refs per call.
   * When there are more refs than fit in one pass, this iterates:
   *   Pass 1: base image + refs[0..3] → intermediate image
   *   Pass 2: intermediate + refs[4..7] → intermediate image
   *   ...until all refs are applied.
   */
  private async editImageLayered(
    editPrompt: string,
    baseImagePath: string,
    referenceImages: string[],
    outputDir: string,
    filenamePrefix: string,
  ): Promise<string> {
    const provider = getProviderRegistry().getImageEditor();
    if (!provider?.editImage) {
      throw new Error('No image editor available');
    }

    const BATCH_SIZE = 4;
    let currentBase = baseImagePath;

    if (referenceImages.length <= BATCH_SIZE) {
      // Single pass — no layering needed
      const result = await provider.editImage({
        editPrompt,
        baseImagePath: currentBase,
        referenceImages,
        outputDir,
        filenamePrefix,
      });
      return result.filePath;
    }

    // Multiple passes — layer refs in batches
    const totalPasses = Math.ceil(referenceImages.length / BATCH_SIZE);
    for (let pass = 0; pass < totalPasses; pass++) {
      const batch = referenceImages.slice(pass * BATCH_SIZE, (pass + 1) * BATCH_SIZE);
      const isLastPass = pass === totalPasses - 1;
      const passPrefix = isLastPass ? filenamePrefix : `${filenamePrefix}_layer${pass + 1}`;

      this.log(`  Layered edit pass ${pass + 1}/${totalPasses}: ${batch.length} refs`);

      const result = await provider.editImage({
        editPrompt,
        baseImagePath: currentBase,
        referenceImages: batch,
        outputDir,
        filenamePrefix: passPrefix,
      });
      currentBase = result.filePath;
    }

    return currentBase;
  }

  /**
   * Emit a phase transition if the node's category differs from current phase.
   */
  private emitPhaseIfChanged(node: ExecutionNode): void {
    const typeDef = this.config.template.artifactTypes[node.typeId];
    const category = typeDef?.category ?? 'concept';

    // Use node typeId for more specific phase names, fall back to category
    const typePhaseNames: Record<string, string> = {
      plot: 'Plot Development',
      story: 'Story Writing',
      character: 'Character Development',
      setting: 'Setting Development',
      scene: 'Scene Breakdown',
      world_style: 'World Style',
      character_image: 'Character Reference Images',
      setting_image: 'Setting Reference Images',
      scene_video_prompt: 'Scene Breakdown',
      shot_image_prompt: 'Shot Composition',
      shot_motion_directive: 'Shot Motion Directives',
      shot_image: 'Shot Image Generation',
      shot_video: 'Shot Video Generation',
      final_video: 'Final Assembly',
    };

    const categoryPhaseNames: Record<string, string> = {
      concept: 'Plot Development',
      structure: 'Content Writing',
      entity: 'Character Development',
      environment: 'Setting Development',
      segment: 'Scene Breakdown',
      visual_ref: 'Image Generation',
      clip: 'Video Generation',
      final: 'Final Assembly',
    };

    const phaseName = typePhaseNames[node.typeId] ?? categoryPhaseNames[category] ?? category;

    if (phaseName !== this.currentPhase) {
      const fromPhase = this.currentPhase || 'starting';
      this.currentPhase = phaseName;

      // Update project.currentPhase so it persists across sessions
      if (this.config.project.currentPhase !== undefined) {
        this.config.project.currentPhase = phaseName;
      }

      this.emit({
        type: 'phase_transition',
        fromPhase,
        toPhase: phaseName,
        displayName: phaseName,
        description: `Working on ${typeDef?.displayName ?? node.typeId}`,
      });
      this.log(`  Phase: ${fromPhase} → ${phaseName}`);
    }
  }

  /**
   * Emit todo_update with all graph nodes as todo items, sorted by dependency order.
   * Groups items by type (all characters together, all scenes together, etc.)
   */
  private emitTodoUpdate(): void {
    const nodes = this.executor.getAllNodes();

    // Sort by dependency/execution order — the order things will actually run.
    // Uses topological order from the template, then itemId for per-item nodes.
    const creationOrder = this.executor.getGraph().getCreationOrder();
    const typeOrder = new Map<string, number>();
    creationOrder.forEach((typeId, idx) => typeOrder.set(typeId, idx));

    const sorted = [...nodes].sort((a, b) => {
      // Sort by topological type order (dependency order)
      const aOrder = typeOrder.get(a.typeId) ?? 999;
      const bOrder = typeOrder.get(b.typeId) ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;

      // Within same type, sort by itemId (scene_1 before scene_2)
      return (a.itemId ?? '').localeCompare(b.itemId ?? '');
    });

    // Determine which type-level nodes have been expanded into per-item children
    const expandedTypes = new Set<string>();
    for (const node of sorted) {
      if (node.itemId) expandedTypes.add(node.typeId);
    }

    const todos: ExpandableTodoItem[] = sorted
      .filter(node => {
        // Hide type-level nodes that have per-item children (expanded into per-scene/per-shot)
        if (!node.itemId && expandedTypes.has(node.typeId)) {
          return false;
        }
        return true;
      })
      .map(node => {
        let status: ExpandableTodoItem['status'];
        switch (node.status) {
          case 'completed': status = 'completed'; break;
          case 'in_progress': case 'ready': status = 'in_progress'; break;
          case 'failed': status = 'cancelled'; break;
          case 'skipped': status = 'completed'; break;
          default: status = 'pending'; break;
        }

        return {
          id: node.id,
          content: node.displayName,
          status,
          visible: true,
          depth: 0,
        };
      });

    // Carry a parallel array of node-shape info keyed by the same ids.
    // Kept separate from `todos` because `ExpandableTodoItem` has a
    // strict shape — this metadata doesn't fit there — and is needed
    // by the frontend Storyboard to render shot frames / videos
    // without parsing filenames.
    const nodeInfo: TodoNodeInfo[] = sorted
      .filter(node => !(!node.itemId && expandedTypes.has(node.typeId)))
      .map(node => {
        const info: TodoNodeInfo = {
          id: node.id,
          typeId: node.typeId,
          status: node.status,
        };
        if (node.itemId !== undefined) info.itemId = node.itemId;
        if (node.outputPath) info.outputPath = node.outputPath;
        if (node.outputPaths && Object.keys(node.outputPaths).length > 0) {
          info.outputPaths = node.outputPaths;
        }
        return info;
      });

    this.emit({ type: 'todo_update', todos, nodes: nodeInfo });
  }

  /**
   * Initialize the agent (matches GenericAgent interface).
   */
  async initialize(): Promise<void> {
    this._initialized = true;
  }

  /**
   * Is the `/run-to <stage>` gate satisfied? Thin wrapper around the pure
   * helper in stages.ts — kept as a method so the run loop can consult
   * it without passing graph state around.
   */
  private shouldStopForStageGate(): boolean {
    return isStageGateSatisfied(
      this.executor.getAllNodes().map(n => ({ typeId: n.typeId, status: n.status })),
      this.stopAtStageTypeIds,
      this.redoOnlyNodes !== null,
    );
  }

  /**
   * Stop the agent mid-execution.
   */
  stop(): void {
    this.stopped = true;
    this.stopReason = 'cancelled';
    // Interrupt any in-progress ComfyUI generation immediately
    import('../../services/comfyui/ComfyUIClient.js')
      .then(({ ComfyUIClient }) => new ComfyUIClient({}).interrupt())
      .catch(() => {});
  }

  /**
   * Set or clear the `/run-to <stage>` gate at runtime. Pass a stage name
   * (e.g. `'character_image'`) to arm the gate; pass `null` to clear it.
   *
   * Called by ConversationManager per-task so the long-lived agent can
   * pick up a per-invocation `stopAtStage` without being reconstructed.
   * Throws on unknown stage names — fail fast on bad input.
   */
  setStopAtStage(stage: string | null): void {
    if (stage === null) {
      this.stopAtStageTypeIds = null;
      return;
    }
    const resolved = resolveStageToTypeIds(stage);
    if (!resolved) {
      throw new Error(
        `Unknown stopAtStage: '${stage}'. See stages.ts VALID_STAGES.`,
      );
    }
    this.stopAtStageTypeIds = new Set(resolved);
  }

  /**
   * Why the executor last stopped. Returns null before the first run().
   *
   * - `'complete'`: `executor.isComplete()` returned true — all target
   *   artifacts (or their graph) finished naturally.
   * - `'paused_at_stage'`: the `/run-to <stage>` gate fired (or the
   *   legacy test-only `stopAfterNodeType` fired). State is safe to
   *   resume from.
   * - `'cancelled'`: `stop()` was called externally (user hit the Stop
   *   button; WebSocket `cancel` message).
   * - `'failed'`: a node failed and self-repair couldn't recover.
   */
  getStopReason(): 'complete' | 'paused_at_stage' | 'cancelled' | 'failed' | null {
    return this.stopReason;
  }

  /**
   * Check if the agent is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get tool names (for compatibility — executor has no tools).
   */
  getToolNames(): string[] {
    return [];
  }

  /**
   * Set autonomous mode (no-op for executor — it's always deterministic).
   */
  setAutonomousMode(_enabled: boolean): void {
    // No-op
  }

  /**
   * Toggle parallel media generation at runtime.
   */
  setParallelMediaGeneration(enabled: boolean): void {
    this.config.parallelMediaGeneration = enabled;
    this.log(`Parallel media generation: ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Invalidate a node for re-execution.
   *
   * Modes:
   *   - `redoNode(nodeId)` — full shot/node redo. Cascades to all dependents,
   *     clears outputPaths entirely, all frames regenerate.
   *   - `redoNode(nodeId, { frame })` — single-frame redo. Drops just that
   *     frame from outputPaths. No cascade. Only that frame regenerates;
   *     downstream video/final are left alone.
   *   - `redoNode(nodeId, { scope: 'prompt' })` — prompt regen. Invalidates
   *     the matching shot_image_prompt AND the shot_image (so the LLM re-writes
   *     the prompt and the image regenerates). No cascade past shot_image.
   *   - `redoNode(nodeId, { scope: 'image_only' })` — invalidate JUST this
   *     shot_image node, no cascade. Used by the edit-prompt flow after the
   *     edited prompt was saved to disk — we want to regenerate the image
   *     from the edited prompt without touching the prompt node (which would
   *     re-run the LLM and overwrite edits).
   *
   * After calling this, call run('') to resume execution of the invalidated nodes.
   */
  redoNode(
    nodeId: string,
    opts: { frame?: string; scope?: 'prompt' | 'image_only' } = {},
  ): ExecutionNode[] {
    const { frame, scope } = opts;

    // image_only scope: invalidate this node AND cascade — but ONLY to
    // dependents that were already completed. If shot_video was generated,
    // regenerate it from the new image. If shot_video is still pending,
    // leave it alone — it'll pick up the new image naturally when it runs.
    //
    // Frame-specific edit (last_frame / mid_frame only):
    //   Preserve the other frames so only the edited frame regenerates.
    //   first_frame edits drop all frames (mid/last derive from first).
    if (scope === 'image_only') {
      const preserveOthers = frame === 'last_frame' || frame === 'mid_frame';
      const invalidated = this.executor.invalidateNode(nodeId, {
        cascade: true,
        cascadeOnlyCompleted: true,
        preserveFramesOther: preserveOthers,
        singleFrame: preserveOthers ? frame : undefined,
      });
      if (invalidated.length === 0) {
        this.log(`Redo image_only: node '${nodeId}' not found`);
        return [];
      }
      const frameLabel = frame ? ` [frame=${frame}]` : '';
      this.log(`Redo image_only${frameLabel}: invalidated ${invalidated.length} node(s): ${invalidated.map(n => n.id).join(', ')}`);
      this.persistState();
      this.emitTodoUpdate();
      const cascadedCount = invalidated.length - 1;
      const cascadedText = cascadedCount > 0
        ? ` (+${cascadedCount} already-completed dependent${cascadedCount > 1 ? 's' : ''})`
        : '';
      this.emit({
        type: 'notification',
        level: 'info',
        message: `Redoing ${nodeId.replace(/^shot_image:/, '')}${frame ? ` · ${frame}` : ''} (from edited prompt)${cascadedText}`,
      });
      this.redoOnlyNodes = new Set(invalidated.map(n => n.id));
      return invalidated;
    }

    // Prompt scope: invalidate shot_image_prompt + shot_image together, no cascade
    if (scope === 'prompt') {
      const shotImageNodeId = nodeId.startsWith('shot_image_prompt:')
        ? nodeId.replace('shot_image_prompt:', 'shot_image:')
        : nodeId;
      const promptNodeId = shotImageNodeId.replace('shot_image:', 'shot_image_prompt:');

      const invalidated: ExecutionNode[] = [];
      invalidated.push(...this.executor.invalidateNode(promptNodeId, { cascade: false }));
      invalidated.push(...this.executor.invalidateNode(shotImageNodeId, { cascade: false }));
      if (invalidated.length === 0) {
        this.log(`Redo prompt: nodes not found for '${shotImageNodeId}'`);
        return [];
      }
      this.log(`Redo prompt: invalidated ${invalidated.length} node(s): ${invalidated.map(n => n.id).join(', ')}`);
      this.persistState();
      this.emitTodoUpdate();
      this.emit({
        type: 'notification',
        level: 'info',
        message: `Redoing prompt for ${shotImageNodeId.replace('shot_image:', '')}`,
      });
      this.redoOnlyNodes = new Set(invalidated.map(n => n.id));
      return invalidated;
    }

    // Frame redo:
    //   - first_frame  → clear ALL outputPaths. Last/mid frames are derived
    //                    from first_frame via edit_first_frame, so they must
    //                    also regenerate to stay consistent.
    //   - mid/last     → clear just that frame. first_frame stays; the other
    //                    additional frame (if present) also stays.
    const invalidated = this.executor.invalidateNode(nodeId, frame
      ? (frame === 'first_frame'
          ? { cascade: false }  // clear all outputPaths → all frames regen
          : { cascade: false, preserveFramesOther: true, singleFrame: frame }
        )
      : undefined,
    );
    if (invalidated.length === 0) {
      this.log(`Redo: node '${nodeId}' not found or already pending`);
      return [];
    }

    const scopeLabel = frame ? `${nodeId} (frame: ${frame})` : nodeId;
    this.log(`Redo: invalidated ${invalidated.length} node(s) [scope=${scopeLabel}]: ${invalidated.map(n => n.id).join(', ')}`);
    this.persistState();
    this.emitTodoUpdate();

    // Notify UI about the cascade
    const names = invalidated.map(n => n.displayName);
    const dependentText = invalidated.length > 1
      ? ` (+${invalidated.length - 1} dependent${invalidated.length > 2 ? 's' : ''})`
      : '';
    const frameText = frame ? ` [${frame}]` : '';
    this.emit({
      type: 'notification',
      level: 'info',
      message: `Redoing ${names[0]}${frameText}${dependentText}`,
    });

    this.redoOnlyNodes = new Set(invalidated.map(n => n.id));
    return invalidated;
  }

  // ===========================================================================
  // Timeline helpers
  // ===========================================================================

  /** Send full timeline state to the frontend via WebSocket. */
  private emitTimelineUpdate(): void {
    if (!this.timeline) return;
    this.emit({
      type: 'timeline_update',
      timeline: this.timeline,
    });
  }

  /** Create timeline skeleton from all scene nodes in the dependency graph. */
  private initializeTimelineFromScenes(): void {
    const sceneNodes = this.executor.getAllNodes()
      .filter(n => n.typeId === 'scene' && n.status !== 'skipped')
      .sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''));

    if (sceneNodes.length === 0) return;

    const totalDuration = (this.config.goal.preferences.duration as number | undefined) ?? 30;
    const descriptors: SegmentDescriptor[] = sceneNodes.map(n => ({
      id: n.itemId ?? n.id,
      label: n.displayName,
    }));

    this.timeline = createTimelineSkeleton(totalDuration, descriptors);
    saveTimeline(this.config.projectDir, this.timeline);
    this.log(`Timeline: created skeleton with ${descriptors.length} scene segments (${totalDuration}s)`);
  }

  /** Update timeline segment after a shot_video node completes. */
  private updateTimelineForShotVideo(node: ExecutionNode, outputPath: string): void {
    if (!this.timeline || !node.itemId) return;

    const segmentId = node.itemId; // e.g., "scene_1_shot_2"
    const segment = this.timeline.segments.find(s => s.id === segmentId);
    if (!segment) {
      this.log(`Timeline: no segment found for ${segmentId}`);
      return;
    }

    const layer: TimelineLayerEntry = {
      type: 'visual',
      filePath: outputPath,
      label: node.displayName,
      source: 'generated',
    };

    this.timeline = updateSegmentLayers(this.timeline, segmentId, [layer], 'filled');
    saveTimeline(this.config.projectDir, this.timeline);
    this.emitTimelineUpdate();
    this.log(`Timeline: updated segment ${segmentId} → filled`);
  }

  /**
   * Run the dependency graph execution loop.
   *
   * This is the main entry point, matching GenericAgent.run() signature.
   * The `task` parameter is used for initial goal understanding only;
   * actual execution is driven by the graph.
   */
  async run(_task: string, _userResponse?: string): Promise<GenericAgentResult> {
    // Handle /reset command: run the reset script, reload state, then continue execution
    const resetMatch = _task.match(/^\/reset\s+(\S+)\s+(\S+)/);
    if (resetMatch) {
      const [, projectName, stage] = resetMatch;
      this.log(`Handling /reset: project=${projectName}, stage=${stage}`);
      try {
        const { execSync } = await import('child_process');
        const projectRoot = dirname(this.config.projectDir); // parent of .kshana dir
        const scriptPath = join(projectRoot, 'scripts', 'reset-project.ts');
        const cmd = `npx tsx "${scriptPath}" "${projectName}" "${stage}"`;
        this.log(`Running: ${cmd} (cwd: ${projectRoot})`);
        const output = execSync(cmd, { cwd: projectRoot, encoding: 'utf-8', timeout: 30000 });
        this.log(`Reset output:\n${output}`);

        // Reload project.json and executor state
        const projectPath = join(this.config.projectDir, 'project.json');
        if (existsSync(projectPath)) {
          const project = JSON.parse(readFileSync(projectPath, 'utf-8'));
          this.config.project = project;
          if (project.executorState) {
            this.executor = DependencyGraphExecutor.fromState(project.executorState, this.config.template);
          }
        }
        // Reload timeline
        this.timeline = loadTimeline(this.config.projectDir);

        this.emit({
          type: 'notification',
          level: 'info',
          message: `Reset to stage "${stage}" complete. Resuming execution...`,
        });
        // Fall through to normal execution with the reset state
      } catch (error) {
        this.log(`Reset failed: ${String(error)}`);
        this.emit({
          type: 'notification',
          level: 'error',
          message: `Reset failed: ${String(error)}`,
        });
        return { status: 'error', output: `Reset failed: ${String(error)}`, todos: [] };
      }
    }

    if (this.running) {
      this.log(`CONCURRENT RUN BLOCKED — run() called while already running`);
      this.log(`  Caller stack: ${new Error().stack?.split('\n').slice(1, 4).join(' <- ')}`);
      return { status: 'completed', output: 'Already running', todos: [] };
    }

    // Acquire project-level lock to prevent concurrent executor instances
    if (!this.acquireProjectLock()) {
      this.log(`CONCURRENT INSTANCE BLOCKED — another executor is running on this project`);
      return { status: 'completed', output: 'Another executor is already running on this project', todos: [] };
    }

    this.running = true;
    this.stopped = false;

    // Load existing timeline from disk (survives session resume / server restart)
    if (!this.timeline) {
      this.timeline = loadTimeline(this.config.projectDir);
      if (this.timeline) {
        this.emitTimelineUpdate();
      }
    }

    const agentName = this.config.name ?? 'kshana-executor';

    this.log('=== Execution started ===');
    this.log(`Nodes: ${this.executor.getAllNodes().map(n => n.id).join(', ')}`);

    try {
      this.emit({ type: 'agent_status', status: 'thinking', agentName });

      // Validate completed nodes — reset any whose output files are missing
      // (happens when a reset deletes files but doesn't cascade to all nodes)
      for (const node of this.executor.getAllNodes()) {
        if (node.status === 'completed' && node.outputPath) {
          const fullPath = join(this.config.projectDir, node.outputPath);
          if (!existsSync(fullPath)) {
            this.log(`  Output file missing for completed node ${node.id}: ${node.outputPath} — resetting to pending`);
            node.status = 'pending';
            node.outputPath = undefined;
            node.completedAt = undefined;
          }
        }
      }

      // Fix stale type-level dependencies on per-item nodes.
      // expandCollection can create per-item nodes that inherit parent's deps
      // (type-level shot_motion_directive instead of per-item shot_motion_directive:scene_1_shot_N).
      let totalRewired = 0;
      for (const node of this.executor.getAllNodes()) {
        if (!node.itemId) continue;
        const fixedDeps: string[] = [];
        let rewired = false;
        for (const depId of node.dependencies) {
          // If dep has no colon (type-level) and a per-item version exists, rewire
          if (!depId.includes(':') && node.itemId) {
            const perItemId = `${depId}:${node.itemId}`;
            if (this.executor.getNode(perItemId)) {
              fixedDeps.push(perItemId);
              totalRewired++;
              rewired = true;
              continue;
            }
          }
          fixedDeps.push(depId);
        }
        if (rewired) node.dependencies = fixedDeps;
      }
      if (totalRewired > 0) {
        this.log(`  Rewired ${totalRewired} stale type-level deps → per-item`);
        this.persistState();
      }

      // Handle input type — if user provided a full story, skip plot and story stages
      // and use the original input directly as the story artifact
      if (this.config.project.inputType === 'story') {
        const inputConfig = this.config.template.inputTypes?.find(
          (t: { id: string }) => t.id === 'story',
        );
        const skips = (inputConfig as any)?.skipsArtifacts ?? [];
        for (const skipTypeId of skips) {
          const node = this.executor.getNode(skipTypeId);
          if (node && node.status === 'pending') {
            // Copy original input to the story output path if this is the story node
            if (skipTypeId === 'story') {
              const inputFile = join(this.config.projectDir, 'original_input.md');
              const storyDir = join(this.config.projectDir, 'chapters', 'chapter_1', 'plans');
              if (existsSync(inputFile)) {
                if (!existsSync(storyDir)) mkdirSync(storyDir, { recursive: true });
                const storyPath = join(storyDir, 'story.md');
                const { copyFileSync } = await import('fs');
                copyFileSync(inputFile, storyPath);
                const relPath = 'chapters/chapter_1/plans/story.md';
                this.executor.markCompleted(node.id, relPath);
                this.log(`  Input type 'story': copied original input → ${relPath}`);
              }
            } else {
              // Skip plot — mark as completed with a placeholder
              this.executor.markCompleted(node.id, 'skipped-input-is-story');
              this.log(`  Input type 'story': skipping ${skipTypeId}`);
            }
          }
        }
        this.persistState();
      }

      // Expand any collection nodes whose dependencies are already completed
      await this.expandPendingCollections();

      this.emitTodoUpdate();

      // Reset stop reason at the start of this run(). Long-lived agent — if
      // the previous run() stopped at a stage, we don't want that leaking.
      this.stopReason = null;

      // Idempotent stage-gate check: if the user asked for /run-to <stage>
      // and the graph is already past that stage, nothing to do. Fire the
      // same paused-at-stage notification + set stopped=true BEFORE any
      // LLM/media calls are made.
      if (this.shouldStopForStageGate()) {
        this.log(`Stage gate '${this.config.stopAtStage}' already satisfied — nothing to run`);
        this.emit({
          type: 'notification',
          level: 'info',
          message: `Already at stage '${this.config.stopAtStage}'.`,
        });
        this.stopReason = 'paused_at_stage';
        this.stopped = true;
      }

      // Main execution loop
      let selfRepairCount = 0;
      const MAX_SELF_REPAIRS = 3;

      while (!this.executor.isComplete() && !this.stopped) {
        // Expand any type-level collections before checking for ready nodes
        await this.expandPendingCollections();
        let readyNodes = this.executor.getNextReady();

        // Isolated-redo mode: a redoNode() call set a whitelist of nodes.
        // We execute ONLY those nodes (and exit when they're all done), so
        // other pending work in the graph is NOT auto-resumed. This preserves
        // the "paused pipeline" semantic — redo one thing, don't restart all.
        if (this.redoOnlyNodes) {
          const whitelist = this.redoOnlyNodes;
          const allWhitelistDone = [...whitelist].every(id => {
            const n = this.executor.getNode(id);
            return !n || n.status === 'completed' || n.status === 'failed' || n.status === 'skipped';
          });
          if (allWhitelistDone) {
            this.log(`Isolated redo complete — stopping (whitelist: ${[...whitelist].join(', ')})`);
            this.redoOnlyNodes = null;
            break;
          }
          readyNodes = readyNodes.filter(n => whitelist.has(n.id));
        }

        if (readyNodes.length === 0) {
          // In parallel mode, if we have pending media, await them and retry
          if (this.pendingMedia.size > 0) {
            this.log(`Awaiting ${this.pendingMedia.size} pending media generation(s)...`);
            await Promise.all(this.pendingMedia.values());
            this.pendingMedia.clear();
            continue;  // Re-check for ready nodes
          }

          // In isolated-redo mode, skip self-repair of unrelated nodes — we
          // only care about the whitelisted nodes. If none are ready, the
          // next iteration's whitelist-done check will break the loop.
          if (this.redoOnlyNodes) {
            this.log(`Isolated redo — no whitelisted nodes ready, exiting loop`);
            this.redoOnlyNodes = null;
            break;
          }

          // Check if we're stuck because of failed nodes blocking downstream
          const failedNodes = this.executor.getAllNodes().filter(n => n.status === 'failed');
          const pendingNodes = this.executor.getAllNodes().filter(n => n.status === 'pending');

          if (failedNodes.length > 0 && pendingNodes.length > 0) {
            // There are failed nodes blocking progress — retry them
            if (selfRepairCount >= MAX_SELF_REPAIRS) {
              // Max retries reached — notify user and stop. Flag as failure
              // (not paused_at_stage) so UI can show error banner, not
              // "paused, continue when ready".
              this.log(`STUCK: ${failedNodes.length} failed node(s) after ${MAX_SELF_REPAIRS} retry attempts. Stopping.`);
              this.emit({
                type: 'notification',
                level: 'error',
                message: `${failedNodes.length} node(s) failed after retries: ${failedNodes.map(n => n.displayName).join(', ')}. Send any message to retry.`,
              });
              this.stopReason = 'failed';
              break;
            }

            selfRepairCount++;
            const retryDelay = selfRepairCount * 10000; // 10s, 20s, 30s backoff
            this.log(`Retrying ${failedNodes.length} failed node(s) (attempt ${selfRepairCount}/${MAX_SELF_REPAIRS}, waiting ${retryDelay / 1000}s)...`);
            this.emit({
              type: 'notification',
              level: 'info',
              message: `Retrying ${failedNodes.length} failed node(s) in ${retryDelay / 1000}s (attempt ${selfRepairCount}/${MAX_SELF_REPAIRS})...`,
            });

            await new Promise(resolve => setTimeout(resolve, retryDelay));

            for (const fn of failedNodes) {
              this.executor.invalidateNode(fn.id);
              this.retriedNodes.delete(fn.id); // allow transient retry again
            }
            this.persistState();
            this.emitTodoUpdate();
            continue;
          }

          // No failed nodes — try structural self-repair
          if (selfRepairCount >= MAX_SELF_REPAIRS) {
            this.log(`STUCK: Max self-repair attempts (${MAX_SELF_REPAIRS}) reached. Stopping.`);
            break;
          }

          selfRepairCount++;
          this.log(`No ready nodes — attempting self-repair (${selfRepairCount}/${MAX_SELF_REPAIRS})...`);
          this.repairMissingNodes();
          await this.expandPendingCollections();

          const newReady = this.executor.getNextReady();

          if (newReady.length > 0) {
            this.log(`Self-repair unblocked ${newReady.length} node(s)`);
            this.emit({
              type: 'notification',
              level: 'info',
              message: `Self-repair unblocked ${newReady.length} node(s) — continuing`,
            });
            this.persistState();
            this.emitTodoUpdate();
            continue;
          }

          this.log(`STUCK: Self-repair attempt ${selfRepairCount} could not unblock any nodes.`);
          break;
        }

        // In serial mode: ALL content finishes before ANY media starts.
        // Within content, compositions finish before motion directives.
        if (!this.config.parallelMediaGeneration) {
          const isMediaNode = (n: ExecutionNode) => {
            const typeDef = this.config.template.artifactTypes[n.typeId];
            const cat = typeDef?.category;
            return cat === 'visual_ref' || cat === 'clip' || cat === 'final';
          };
          const contentNodes = readyNodes.filter(n => !isMediaNode(n));
          const mediaNodes = readyNodes.filter(n => isMediaNode(n));

          // Check if ANY content node is still pending/in-progress in the entire graph
          // (not just the ready batch). If so, don't start media yet.
          const allNodes = this.executor.getAllNodes();
          const pendingContentExists = allNodes.some(n =>
            !isMediaNode(n) && (n.status === 'pending' || n.status === 'in_progress'),
          );

          if (pendingContentExists && mediaNodes.length > 0 && contentNodes.length === 0) {
            // Media nodes are ready but content is still pending elsewhere — skip this round
            this.log(`  Serial mode: waiting for all content to finish before media (${allNodes.filter(n => !isMediaNode(n) && n.status === 'pending').length} content pending)`);
            readyNodes.length = 0;
          } else {
            // Within content nodes, prioritize compositions over motion directives
            const compositionNodes = contentNodes.filter(n => n.typeId !== 'shot_motion_directive');
            const motionNodes = contentNodes.filter(n => n.typeId === 'shot_motion_directive');
            const prioritizedContent = compositionNodes.length > 0 ? compositionNodes : motionNodes;

            // Only process media nodes if no content nodes remain anywhere
            readyNodes.length = 0;
            readyNodes.push(...(prioritizedContent.length > 0 ? prioritizedContent : mediaNodes));
          }
        }

        this.log(`Ready nodes: ${readyNodes.map(n => n.id).join(', ')}`);

        /**
         * Process one ready node. Encapsulated as a local async fn so
         * the outer loop can choose to await serially OR fan out a
         * bounded number of LLM-eligible nodes concurrently. Every
         * `continue` in here that used to advance the outer for-loop
         * has been converted to `return` — behavior identical in
         * serial mode; enables parallelism when dispatched concurrently.
         *
         * Media (ComfyUI / FFmpeg) work still flows through the existing
         * `parallelMediaGeneration` / `pendingMedia` machinery — this
         * split is only about LLM calls.
         */
        const runOneNode = async (node: ExecutionNode): Promise<void> => {
          // In parallel mode: await any pending media this node depends on
          if (this.config.parallelMediaGeneration) {
            for (const depId of node.dependencies) {
              const pending = this.pendingMedia.get(depId);
              if (pending) {
                this.log(`  Waiting for pending media: ${depId}`);
                await pending;
                this.pendingMedia.delete(depId);
              }
            }
          }

          // Self-healing: validate dependency output files exist before executing
          const missingDeps = this.validateDependencyOutputs(node);
          if (missingDeps.length > 0) {
            // Track regeneration attempts to prevent infinite loops
            for (const depId of missingDeps) {
              const key = `${node.id}→${depId}`;
              const count = (this.depRegenCounts.get(key) ?? 0) + 1;
              this.depRegenCounts.set(key, count);

              if (count > 2) {
                this.log(`  LOOP PROTECTION: ${depId} regenerated ${count} times for ${node.id} — marking failed`);
                this.executor.markFailed(node.id, `Dependency ${depId} output keeps disappearing after ${count} regeneration attempts`);
                break;
              }

              this.log(`  Dependency output missing: ${depId} — resetting to pending for regeneration (attempt ${count}/2)`);
              // Reset ONLY this dependency node — don't cascade to its dependents
              // The downstream nodes just need this dep to be re-completed
              const depNode = this.executor.getNode(depId);
              if (depNode) {
                depNode.status = 'pending';
                depNode.outputPath = undefined;
                depNode.completedAt = undefined;
                depNode.error = undefined;
              }
              this.emit({
                type: 'notification',
                level: 'warning',
                message: `Auto-regenerating: ${depId} (output file missing)`,
              });
            }
            this.persistState();
            this.emitTodoUpdate();
            return; // Skip this node — deps need to regenerate first
          }

          this.executor.markStarted(node.id);
          this.emitPhaseIfChanged(node);
          this.emitTodoUpdate();
          this.emit({ type: 'agent_status', status: 'thinking', agentName });

          const progress = this.executor.getProgress();
          this.log(`[${progress.completed}/${progress.total}] Starting: ${node.id} (${node.displayName})`);
          this.emit({
            type: 'notification',
            level: 'info',
            message: `[${progress.completed}/${progress.total}] Working on: ${node.displayName}`,
          });

          try {
            // Check for deterministic nodes FIRST — these skip LLM entirely
            const nodeTypeDef = this.config.template.artifactTypes[node.typeId];
            const nodeCategory = nodeTypeDef?.category;
            let finalOutputPath = '';
            const toolCallId = `exec_${node.id}_${Date.now()}`;

            if (nodeCategory === 'final' && !this.config.skipMediaGeneration) {
              // Final assembly — skip LLM, go straight to deterministic assembly
              const assemblyResult = await this.executeFinalAssembly(node, toolCallId);
              if (!assemblyResult) {
                this.executor.markFailed(node.id, 'Final assembly failed');
                return;
              }
              finalOutputPath = assemblyResult;
            } else if (nodeCategory === 'final' && this.config.skipMediaGeneration) {
              // Test mode: skip final assembly — mark completed so pipeline finishes
              this.log(`  Skipping final assembly (skipMediaGeneration=true)`);
              this.executor.markCompleted(node.id, 'skipped-test-mode');
              this.persistState();
              this.emitTodoUpdate();
              return;
            } else if (node.typeId === 'shot_video' && !this.config.skipMediaGeneration) {
              // Shot video — purely deterministic: take shot image + motion → video provider
              const videoResult = await this.executeShotVideo(node, toolCallId);
              if (!videoResult) {
                this.executor.markFailed(node.id, 'Shot video generation failed');
                return;
              }
              finalOutputPath = videoResult;
              // Update timeline segment with the generated video
              this.updateTimelineForShotVideo(node, finalOutputPath);
            } else if (node.typeId === 'shot_video' && this.config.skipMediaGeneration) {
              // Test mode: skip shot video — mark completed so downstream nodes aren't blocked
              this.log(`  Skipping shot_video (skipMediaGeneration=true)`);
              this.executor.markCompleted(node.id, 'skipped-test-mode');
              this.persistState();
              this.emitTodoUpdate();
              return;
            } else if (node.typeId === 'shot_image' && !this.config.skipMediaGeneration) {
              // Shot image — deterministic: read prompt JSON, resolve refs, call ComfyUI
              const shotImageResult = await this.executeShotImage(node, toolCallId);
              if (!shotImageResult) {
                this.executor.markFailed(node.id, 'Shot image generation failed');
                return;
              }
              finalOutputPath = shotImageResult;
            } else if (node.typeId === 'shot_image' && this.config.skipMediaGeneration) {
              // Test mode: skip shot image generation
              this.log(`  Skipping shot_image (skipMediaGeneration=true)`);
              this.executor.markCompleted(node.id, 'skipped-test-mode');
              this.persistState();
              this.emitTodoUpdate();
              return;
            } else {
              // Non-deterministic node — needs LLM (or skip-if-exists)
              // 1. Resolve inputs
              const inputs = resolveInputs(node, this.executor, this.config.projectDir);
              this.log(`  Inputs resolved: ${inputs.filesRead.length} files read: ${inputs.filesRead.join(', ') || '(none)'}`);
              this.log(`  Reference images: ${inputs.referenceImages.length}`);
              this.log(`  Context block length: ${inputs.contextBlock.length} chars`);

              // 2. Build prompt
              const { system, user, loadedSkills } = await this.buildPromptForNode(node, inputs);
              this.log(`  Prompt built: system=${system.length} chars, user=${user.length} chars`);

              // 3. Emit tool_call
              const toolName = this.getToolDisplayName(node);
              const toolArgs = this.getToolDisplayArgs(node, inputs);
              if (loadedSkills.length > 0) {
                toolArgs['skills'] = loadedSkills.join(', ');
              }
              // Attach the LLM model that will handle this call (for UI display).
              toolArgs['model'] = this.modelFor(this.purposeForNode(node));
              this.emit({
                type: 'tool_call',
                toolCallId,
                toolName,
                arguments: toolArgs,
                agentName,
              });

              // 4. For expensive ops, ask user approval
              if (node.isExpensive) {
                this.log(`  Expensive op — requesting approval`);
                const approved = await this.askApproval(node, inputs);
                if (!approved) {
                  this.log(`  Skipped by user`);
                  this.executor.markFailed(node.id, 'Skipped by user');
                  return;
                }
              }

              // Check if prompt/output file already exists on disk (from a previous run)
              // BUT: if any dependency was re-completed more recently than the prompt file,
              // the prompt is stale and must be regenerated (e.g., after a reset)
              const isMediaNode = nodeCategory === 'visual_ref' || nodeCategory === 'clip';
              if (isMediaNode) {
                const existingPromptPath = this.findExistingPromptFile(node);
                const promptIsStale = existingPromptPath ? this.isPromptStale(node, existingPromptPath) : false;
                if (existingPromptPath && !promptIsStale) {
                  this.log(`  Prompt file already exists: ${existingPromptPath} — skipping LLM`);

                  if (isMediaNode) {
                    // Media node: skip LLM, go straight to image/video generation
                    this.emit({
                      type: 'notification',
                      level: 'info',
                      message: `Skipping LLM for ${node.displayName} — prompt exists, going to image gen`,
                    });
                    const mediaPath = await this.executeMediaGenerationWithRetry(node, existingPromptPath, toolCallId);
                    if (mediaPath) {
                      finalOutputPath = mediaPath;
                    } else {
                      this.executor.markFailed(node.id, 'Media generation failed (prompt saved, will retry)');
                      this.emitTodoUpdate();
                      return;
                    }
                  }

                  this.emit({
                    type: 'tool_result',
                    toolCallId,
                    toolName,
                    result: { status: 'skipped', file: finalOutputPath, reason: 'already exists' },
                    agentName,
                  });
                  this.emit({
                    type: 'agent_text',
                    text: `**${node.displayName}** → \`${finalOutputPath}\` (exists, skipped)`,
                    isFinal: false,
                  });
                  this.executor.markCompleted(node.id, finalOutputPath);
                  this.persistState();
                  this.emitTodoUpdate();
                  this.log(`  COMPLETED (skipped): ${node.id} → ${finalOutputPath}`);
                  if (this.config.stopAfterNodeType && node.typeId === this.config.stopAfterNodeType) {
                    this.log(`  stopAfterNodeType matched: ${node.typeId} — stopping`);
                    this.stopReason = 'paused_at_stage';
                    this.stopped = true;
                  }
                  if (this.shouldStopForStageGate()) {
                    this.log(`  stage gate '${this.config.stopAtStage}' satisfied — stopping`);
                    this.emit({
                      type: 'notification',
                      level: 'info',
                      message: `Paused at stage '${this.config.stopAtStage}'.`,
                    });
                    this.stopReason = 'paused_at_stage';
                    this.stopped = true;
                  }
                  return;
                }
              }

              // Generate content via LLM (pure completion, no tools)
              this.log(`  Calling LLM...`);
              let content = await this.generateForNode(node, system, user, toolCallId, toolName);
              this.log(`  LLM returned ${content.length} chars`);

              // Motion-directive soft-warn: scan for ambiguous speaker
              // tags ("The woman says", "He says") when 2+ characters
              // are in the shot. The video model lip-syncs to whichever
              // character is most visually prominent when the tag is
              // generic, so dialogue ends up on the wrong mouth. Pure
              // warning — we don't block or retry (that would risk
              // oscillation with the guide's own phrasing rules).
              if (node.typeId === 'shot_motion_directive') {
                this.scanMotionDirectiveForAmbiguousSpeaker(node, content);
              }

              // Validate JSON output for nodes that require it
              const jsonValidatedTypes = ['scene_video_prompt', 'shot_image_prompt', 'character_image', 'setting_image'];
              if (jsonValidatedTypes.includes(node.typeId)) {
                const validation = this.validateJsonOutput(content, node);
                if (validation.valid && validation.normalizedContent) {
                  content = validation.normalizedContent;
                }
                if (!validation.valid) {
                  this.log(`  JSON validation failed: ${validation.error} — asking LLM to fix...`);
                  this.emit({
                    type: 'notification',
                    level: 'warning',
                    message: `Invalid JSON from LLM for ${node.displayName} — attempting repair`,
                  });

                  // Close the original tool card as error
                  this.emit({
                    type: 'tool_result',
                    toolCallId,
                    toolName,
                    result: { status: 'error', error: `Invalid JSON: ${validation.error}` },
                    agentName,
                    isError: true,
                  });

                  // Step 1: Ask the LLM to fix the broken JSON — new card
                  const repairCallId = `repair_${node.id}_${Date.now()}`;
                  this.emit({
                    type: 'tool_call',
                    toolCallId: repairCallId,
                    toolName: 'json_repair',
                    arguments: {
                      item: node.displayName,
                      error: validation.error,
                      model: this.modelFor('utility.json_repair'),
                    },
                    agentName,
                  });
                  const fixPrompt = `The following JSON output has an error. Fix it and return ONLY the corrected valid JSON — no explanation, no markdown fences, no extra text.\n\nError: ${validation.error}\n\nBroken JSON:\n${content.substring(0, 8000)}`;
                  const fixedContent = await this.generateForNode(
                    node,
                    'You are a JSON repair tool. Return ONLY valid JSON. No markdown, no explanation.',
                    fixPrompt,
                    repairCallId,
                    'json_repair',
                    'utility.json_repair',
                  );
                  const fixValidation = this.validateJsonOutput(fixedContent, node);
                  if (fixValidation.valid) {
                    content = fixValidation.normalizedContent ?? fixedContent;
                    this.log(`  LLM JSON repair succeeded`);
                    this.emit({
                      type: 'tool_result',
                      toolCallId: repairCallId,
                      toolName: 'json_repair',
                      result: { status: 'completed' },
                      agentName,
                    });
                  } else {
                    this.log(`  LLM repair failed: ${fixValidation.error} — full retry...`);
                    this.emit({
                      type: 'tool_result',
                      toolCallId: repairCallId,
                      toolName: 'json_repair',
                      result: { status: 'error', error: fixValidation.error },
                      agentName,
                      isError: true,
                    });
                    // Step 2: Fall back to full regeneration — new card
                    const retryCallId = `retry_${node.id}_${Date.now()}`;
                    this.emit({
                      type: 'tool_call',
                      toolCallId: retryCallId,
                      toolName,
                      arguments: {
                        item: node.displayName,
                        retry: true,
                        model: this.modelFor(this.purposeForNode(node)),
                      },
                      agentName,
                    });
                    const retryContent = await this.generateForNode(
                      node,
                      system + '\n\nCRITICAL: Your output MUST be valid JSON. Do not include markdown, backticks, or any text outside the JSON object.',
                      user,
                      retryCallId,
                      toolName,
                    );
                    const retryValidation = this.validateJsonOutput(retryContent, node);
                    if (retryValidation.valid) {
                      content = retryValidation.normalizedContent ?? retryContent;
                      this.log(`  Full retry succeeded — valid JSON`);
                    } else {
                      this.log(`  Full retry also failed: ${retryValidation.error}`);
                      this.executor.markFailed(node.id, `Invalid JSON output after retry: ${retryValidation.error}`);
                      this.emitTodoUpdate();
                      return;
                    }
                  }
                }
              }

              // Write prompt/content to disk
              let outputPath = writeOutput(
                node, content, this.config.projectDir, this.config.template,
              );
              this.log(`  Written to: ${outputPath}`);

              // Record the prompt path in project.json for media nodes so a
              // later run can legitimately skip LLM regeneration (crash
              // recovery). Without this explicit record, orphan prompt JSONs
              // on disk would silently override the pending status — see
              // `findExistingPromptFile` for the full contract.
              if (nodeCategory === 'visual_ref' || nodeCategory === 'clip') {
                node.promptPath = outputPath;
              }

              // State is now computed BEFORE prompt generation in buildPromptForNode().
              // No post-generation state extraction needed.

              // Emit tool_result for the prompt generation
              this.emit({
                type: 'tool_result',
                toolCallId,
                toolName,
                result: { status: 'completed', file: outputPath },
                agentName,
              });

              // For media nodes: execute actual generation after prompt is written
              if ((nodeCategory === 'visual_ref' || nodeCategory === 'clip') && !this.config.skipMediaGeneration) {
                if (this.config.parallelMediaGeneration) {
                  // Parallel mode: fire-and-forget, collect result later
                  // The node stays as 'in_progress' until media completes
                  const capturedOutputPath = outputPath;
                  const mediaPromise = this.executeMediaGeneration(node, capturedOutputPath, toolCallId)
                    .then(mediaPath => {
                      if (mediaPath) {
                        this.executor.markCompleted(node.id, mediaPath);
                        this.persistState();
                        this.emitTodoUpdate();
                        this.log(`  [parallel] Media ready: ${node.id} → ${mediaPath}`);
                      } else {
                        // Media failed — mark as failed so it doesn't pollute downstream
                        this.executor.markFailed(node.id, 'Media generation failed (prompt saved)');
                        this.persistState();
                        this.emitTodoUpdate();
                        this.log(`  [parallel] Media failed: ${node.id} — prompt at ${capturedOutputPath}`);
                      }
                      return mediaPath;
                    })
                    .catch(err => {
                      this.executor.markFailed(node.id, String(err));
                      this.persistState();
                      this.log(`  [parallel] Media error: ${node.id} — ${String(err)}`);
                      return null;
                    });
                  this.pendingMedia.set(node.id, mediaPromise);
                  // Don't mark completed here — the parallel handler will do it
                  // Skip the markCompleted below by returning
                  this.log(`  [parallel] Media generation queued for ${node.id}`);
                  return; // Skip markCompleted — parallel handler owns the node status
                } else {
                  // Serial mode: block until media is generated (with retry)
                  const mediaPath = await this.executeMediaGenerationWithRetry(node, outputPath, toolCallId);
                  if (mediaPath) {
                    outputPath = mediaPath;  // Update to actual media file path
                  } else {
                    // Media generation failed — node should NOT be marked completed
                    // The prompt file is preserved so retry will skip LLM and go straight to image gen
                    this.executor.markFailed(node.id, 'Media generation failed (prompt saved, will retry)');
                    this.emitTodoUpdate();
                    this.log(`  Media gen failed for ${node.id} — marked failed, prompt preserved at ${outputPath}`);
                    return;
                  }
                }
              }

              finalOutputPath = outputPath;
            }

            // 5. Log completion (visible in executor log, NOT in chat UI)
            this.log(`  ✓ ${node.displayName} → ${finalOutputPath}`);

            // 6. Extract collection items if this node produces them
            // (only for LLM-generated content nodes, not final assembly)
            if (nodeCategory !== 'final') {
              // Only story (extracts chars/settings/scenes) and scene_video_prompt (extracts shots) produce collection items
              const needsExpansion = node.typeId === 'story' || node.typeId === 'scene_video_prompt';
              if (needsExpansion) {
                // Read content back from the prompt file for extraction
                const writtenFile = join(this.config.projectDir, finalOutputPath);
                if (existsSync(writtenFile)) {
                  const writtenContent = readFileSync(writtenFile, 'utf-8');
                  this.log(`  Extracting collection items...`);
                  await this.handleCollectionExpansion(node, writtenContent);
                }
              }
            }

            // 7. Mark completed and persist state
            this.executor.markCompleted(node.id, finalOutputPath);
            this.persistState();
            this.emitTodoUpdate();
            this.log(`  COMPLETED: ${node.id}`);

            // Reset self-repair counter and dep regen tracking on successful completion
            selfRepairCount = 0;
            // Clear regen counts for this node's deps (they succeeded)
            for (const key of this.depRegenCounts.keys()) {
              if (key.startsWith(`${node.id}→`)) this.depRegenCounts.delete(key);
            }

            // Check if we should stop after this node type (test mode)
            if (this.config.stopAfterNodeType && node.typeId === this.config.stopAfterNodeType) {
              this.log(`  stopAfterNodeType matched: ${node.typeId} — stopping`);
              this.stopReason = 'paused_at_stage';
              this.stopped = true;
            }
            // `/run-to <stage>` gate: fire only once every node of the gated
            // typeIds (all aliased siblings + every per-item child) is terminal.
            if (this.shouldStopForStageGate()) {
              this.log(`  stage gate '${this.config.stopAtStage}' satisfied — stopping`);
              this.emit({
                type: 'notification',
                level: 'info',
                message: `Paused at stage '${this.config.stopAtStage}'.`,
              });
              this.stopReason = 'paused_at_stage';
              this.stopped = true;
            }

          } catch (error) {
            const errMsg = String(error);
            const isTransient = /premature close|timed? ?out|ECONNRESET|ECONNREFUSED|socket hang up|network|connection error|502|503|429/i.test(errMsg);

            if (isTransient && !this.retriedNodes.has(node.id)) {
              // Retry once for transient errors
              this.retriedNodes.add(node.id);
              this.log(`  TRANSIENT ERROR: ${node.id} — ${errMsg} — will retry`);
              this.executor.markFailed(node.id, errMsg);
              // Reset to pending so it gets picked up again
              this.executor.invalidateNode(node.id);
              this.emit({
                type: 'notification',
                level: 'warning',
                message: `Retrying: ${node.displayName} (${errMsg})`,
              });
              this.emitTodoUpdate();
            } else {
              this.log(`  FAILED: ${node.id} — ${errMsg}`);
              this.executor.markFailed(node.id, errMsg);
              this.emitTodoUpdate();
              this.emit({
                type: 'notification',
                level: 'error',
                message: `Failed: ${node.displayName} — ${errMsg}`,
              });
            }
          }
        };
        // end runOneNode

        // Bounded-concurrency dispatch. LLM-eligible nodes run up to
        // `llmConcurrency` at a time; media/deterministic nodes stay
        // serial because their resource isn't bottlenecked at the LLM
        // provider (ComfyUI / FFmpeg concurrency is managed elsewhere).
        //
        // `llmConcurrency = 1` → fully serial behavior — bit-identical
        // to the previous loop. `> 1` is only enabled when LLM_MODE=cloud
        // (see `getLLMConcurrency`).
        const llmConcurrency = this.getLLMConcurrency();
        const pendingLLM = new Set<Promise<void>>();
        for (const node of readyNodes) {
          if (this.stopped) break;

          if (llmConcurrency > 1 && this.isLLMEligibleNode(node)) {
            // Block when we'd exceed the cap — Promise.race drains
            // whichever task finishes first before we add another.
            while (pendingLLM.size >= llmConcurrency) {
              await Promise.race(pendingLLM);
            }
            let p: Promise<void>;
            const tracked = () => runOneNode(node).finally(() => pendingLLM.delete(p));
            p = tracked();
            pendingLLM.add(p);
          } else {
            await runOneNode(node);
          }
        }
        // Drain any LLM tasks still in flight before the next round of
        // ready-node discovery — dependents may be gated on outputs
        // from nodes we just fanned out.
        if (pendingLLM.size > 0) {
          await Promise.all(pendingLLM);
        }
      }

      // Await any remaining pending media before finalizing
      if (this.pendingMedia.size > 0) {
        this.log(`Awaiting ${this.pendingMedia.size} final pending media generation(s)...`);
        await Promise.all(this.pendingMedia.values());
        this.pendingMedia.clear();
      }

      // Done
      const finalProgress = this.executor.getProgress();
      const summary = this.executor.getSummary();
      this.log(`=== Execution finished ===`);
      this.log(`Progress: ${JSON.stringify(finalProgress)}`);
      this.log(`Summary: ${summary}`);

      // Settle the stop reason if the loop exited naturally without any of
      // the earlier paths (stage gate, cancel, failed) setting it.
      if (this.stopReason === null) {
        this.stopReason = this.executor.isComplete() ? 'complete'
          : finalProgress.failed > 0 ? 'failed'
          : 'complete'; // no pending, no failures — treat as complete
      }

      this.emit({
        type: 'notification',
        level: finalProgress.failed > 0 ? 'warning' : 'info',
        message: summary,
      });
      this.emit({ type: 'agent_status', status: 'completed', agentName });

      return {
        status: this.executor.isComplete() ? 'completed' : 'error',
        output: summary,
        todos: [],
        error: finalProgress.failed > 0
          ? `${finalProgress.failed} node(s) failed`
          : undefined,
      };

    } catch (error) {
      this.emit({ type: 'agent_status', status: 'completed', agentName });
      return {
        status: 'error',
        output: '',
        todos: [],
        error: String(error),
      };
    } finally {
      this.running = false;
      this.releaseProjectLock();
    }
  }

  /**
   * Get the executor instance (for external inspection/testing).
   */
  getExecutor(): DependencyGraphExecutor {
    return this.executor;
  }

  // ===========================================================================
  // Private: Prompt building
  // ===========================================================================

  /**
   * Build system + user prompts for a given node based on its artifact category.
   * Uses simple, tool-free prompts — all context is pre-loaded in inputs.
   */
  private async buildPromptForNode(
    node: ExecutionNode,
    inputs: ResolvedInputs,
  ): Promise<{ system: string; user: string; loadedSkills: string[] }> {
    const typeDef = this.config.template.artifactTypes[node.typeId];
    const category = typeDef?.category ?? 'concept';

    // Special handling for specific node types that need different prompts than their category
    // - shot_image_prompt: uses visual_ref treatment (FLUX Klein edit prompt)
    // - scene_video_prompt: uses structured JSON output for deterministic parsing
    const effectiveCategory = node.typeId === 'shot_image_prompt' ? 'visual_ref' : category;

    let systemPrompt: string;
    if (node.typeId === 'scene_video_prompt') {
      // Minimal system prompt — all rules and field definitions are in the guide
      // (scene_breakdown_guide.md) which autoresearch optimizes end-to-end
      systemPrompt = `You are a cinematic shot planner. Output ONLY valid JSON.`;
    } else if (node.typeId === 'shot_image_prompt') {
      // Minimal system prompt — all rules and JSON structure are in the guide
      // (shot_composition_guide.md) which autoresearch optimizes end-to-end
      systemPrompt = `You are an expert image prompt engineer. Output ONLY valid JSON.`;
    } else {
      systemPrompt = CATEGORY_PROMPTS[effectiveCategory] ?? CATEGORY_PROMPTS.concept;
    }

    // Inject guides/skills for relevant categories
    const loadedSkills: string[] = [];
    const needsSkills = effectiveCategory === 'visual_ref' || effectiveCategory === 'clip' || effectiveCategory === 'segment' || node.typeId === 'plot' || node.typeId === 'story' || node.typeId === 'scene_video_prompt' || node.typeId === 'world_style' || node.typeId === 'shot_motion_directive';
    if (needsSkills) {
      const skills = this.loadSkillsForNode(node);
      if (skills.content) {
        systemPrompt += `\n\n<model_skills>\n${skills.content}\n</model_skills>`;
        loadedSkills.push(...skills.files);
      }
    }

    // Inject duration/project constraints with per-scene and per-shot specifics
    const duration = this.config.goal.preferences.duration as number | undefined;
    const style = this.config.goal.preferences.style as string | undefined;
    const allNodes = this.executor.getAllNodes();
    const sceneCount = allNodes.filter(n => n.typeId === 'scene').length;
    const perSceneDuration = duration && sceneCount > 0 ? Math.round(duration / sceneCount) : 0;

    let projectContext = '';
    const parts: string[] = [];

    if (style) {
      parts.push(`**Visual style:** ${style}`);
    }
    if (duration) {
      parts.push(`**Target video duration:** ${duration} seconds (${Math.floor(duration / 60)}m ${duration % 60}s)`);
    }

    // Scene-level: inject this scene's duration allocation
    if (node.typeId === 'scene' || node.typeId === 'scene_video_prompt') {
      if (perSceneDuration > 0) {
        parts.push(`**This scene's duration:** ~${perSceneDuration} seconds`);
        parts.push(`**Shot planning:** Break this scene into shots that total ~${perSceneDuration}s. Each shot should be 3-10 seconds for action/atmosphere, up to 15 seconds for dialogue-heavy shots. Dialogue shots MUST size to fit the full spoken line (~2.5 words/sec + 1s buffer) — shorter and the video cuts off mid-sentence.`);
      }
      if (sceneCount > 0) {
        // Figure out which scene number this is
        const sceneNum = node.itemId?.match(/(\d+)/)?.[1] ?? '?';
        parts.push(`**Scene ${sceneNum} of ${sceneCount}**`);
      }
    }

    // scene_video_prompt: inject the canonical refId list so the LLM uses
    // exact strings for mainSubject/secondarySubject/focus refs. Without
    // this, the LLM invents IDs from prose in the scene script (e.g.
    // "Johnathan O'Hare" → `johnathan` or `johnathan_o_hare` when the
    // canonical refId is `johnathan_o'hare`). See scene_breakdown_guide.md.
    let availableRefsBlock = '';
    if (node.typeId === 'scene_video_prompt') {
      const refLines: string[] = [];
      for (const n of allNodes) {
        if (!n.itemId) continue;
        if (n.typeId === 'character') refLines.push(`- character:    ${n.itemId}`);
        else if (n.typeId === 'setting') refLines.push(`- setting:     ${n.itemId}`);
        else if (n.typeId === 'object') refLines.push(`- object:      ${n.itemId}`);
      }
      if (refLines.length > 0) {
        availableRefsBlock = `\n\n<available_refs>
This is a canonical-spelling dictionary for the ENTIRE PROJECT. It is
NOT a shopping list — do NOT reference every entity here.

${refLines.join('\n')}

How to use this list:

1. **Read the scene script FIRST to determine who/what is in THIS scene.**
   Only the entities named or clearly implied by the scene's prose belong
   in this scene's JSON. A character being "available" in the project
   does not mean they appear in this scene.

2. **When an entity IS in the scene, use the EXACT refId string above**
   for mainSubject, secondarySubject, perspectiveOf, focus.primary,
   focus.background[], focus.lurking — copy verbatim, including
   apostrophes and underscores. Do not paraphrase, normalize, or "fix"
   spellings.

3. **Omit refs that aren't in the scene.**
   - \`secondarySubject\` is OPTIONAL. Only set it when the scene
     script gives a second character a pivotal dialogue/confrontation
     role. If there's no pivotal second character in THIS scene, omit
     the field entirely.
   - \`focus.primary\` names the razor-sharp subject of the shot —
     it must be something the script says is actually in that shot,
     not a random pick from the list.
   - \`focus.background[]\` and \`focus.lurking\` — same rule. Only
     include entities actually in the shot composition.

4. **If the scene needs an entity that isn't on this list** (e.g. the
   guards in a dock confrontation), describe them as PROSE in
   \`description\`/\`audio\`. Don't invent a new refId.

Examples of common failure modes to avoid:
- Inserting \`glitch\` (the apartment cat) as secondarySubject of a
  dock-confrontation scene just because glitch is on this list.
- Setting \`focus.primary\` to \`lazarus_drive\` when the shot's
  description is about guards raising rifles — the Drive isn't yet
  the subject of that shot.
</available_refs>`;
      }
    }

    // Shot-level: inject this shot's duration based on scene allocation and shot count
    if (node.typeId === 'shot_image_prompt' || node.typeId === 'shot_motion_directive' || node.typeId === 'scene_video' || node.typeId === 'scene_image') {
      // Extract scene ID from itemId (e.g., "scene_1_shot_2" → "scene_1")
      const sceneMatch = node.itemId?.match(/(scene_\d+)/);
      const sceneId = sceneMatch?.[1];

      if (sceneId && perSceneDuration > 0) {
        // Count how many shots this scene has
        const shotsInScene = allNodes.filter(n =>
          n.typeId === 'shot_image_prompt' && n.itemId?.startsWith(sceneId),
        ).length;
        const perShotDuration = shotsInScene > 0
          ? Math.round(perSceneDuration / shotsInScene)
          : perSceneDuration;

        parts.push(`**Scene:** ${sceneId} (~${perSceneDuration}s total)`);
        if (shotsInScene > 0) {
          parts.push(`**Shots in this scene:** ${shotsInScene}`);
          parts.push(`**This shot's duration:** ~${perShotDuration} seconds`);
        }
      }

      // Extract shot number for display
      const shotMatch = node.itemId?.match(/shot_(\d+)/);
      if (shotMatch) {
        parts.push(`**Shot number:** ${shotMatch[1]}`);
      }
    }

    // General pacing for other nodes
    if (parts.length === 0 && (duration || style)) {
      if (duration && sceneCount > 0) {
        parts.push(`**Scenes:** ${sceneCount} scenes, ~${perSceneDuration}s per scene`);
      }
    }

    if (parts.length > 0) {
      projectContext = `\n\n<project_constraints>\n${parts.join('\n')}\n</project_constraints>`;
    }

    const task = node.itemId
      ? `Create ${typeDef?.displayName ?? node.typeId} for "${node.itemId}"`
      : `Create ${typeDef?.displayName ?? node.typeId}`;

    // For shot_image_prompt: gather refs, filter by purpose, compute state, build hints
    let referenceImageContext = '';
    let shotContextHint = '';
    let sceneStateContext = '';
    let perspectiveContext = '';
    let focusContext = '';
    if (node.typeId === 'shot_image_prompt' && node.itemId) {
      const { buildAvailableReferences, formatReferencesForPrompt, filterRefsByPurpose, buildShotContextHint } = await import('./shotReferenceMapping.js');
      const sceneId = node.itemId.match(/(scene_\d+)/)?.[1];
      const shotNum = parseInt(node.itemId.match(/shot_(\d+)/)?.[1] ?? '0', 10);

      // Read shot from scene breakdown (for purpose filtering + state computation)
      let shotPurpose = '';
      let shotDescription = '';
      let sceneMainSubject = ''; // hoisted so the later position-continuity check can read it
      let shotContinuityRole = 'none';
      let shotPerspective = '';
      let prevShotPerspective = '';
      if (sceneId) {
        const svpNode = this.executor.getNode(`scene_video_prompt:${sceneId}`);
        if (svpNode?.outputPath) {
          try {
            const svpPath = join(this.config.projectDir, svpNode.outputPath);
            let svpContent = readFileSync(svpPath, 'utf-8').trim();
            if (svpContent.startsWith('```')) {
              svpContent = svpContent.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
            }
            const svpJson = JSON.parse(svpContent);
            const shots = svpJson.shots ?? svpJson;
            const shot = (Array.isArray(shots) ? shots : []).find((s: any) => s.shotNumber === shotNum);
            if (shot) {
              shotPurpose = shot.purpose || '';
              shotDescription = `Shot ${shotNum}: ${shot.description || ''}. Camera: ${shot.cameraWork || ''}. Purpose: ${shotPurpose || 'unknown'}.`;
              shotContinuityRole = shot.continuityRole || 'none';
              shotPerspective = shot.perspective || '';
            }
            // Look up previous shot's perspective too (for mode hint)
            const prevShot = (Array.isArray(shots) ? shots : []).find((s: any) => s.shotNumber === shotNum - 1);
            if (prevShot) {
              prevShotPerspective = prevShot.perspective || '';
            }

            // Perspective block — whose POV is this shot from
            const mainSubject: string = svpJson.mainSubject || '';
            sceneMainSubject = mainSubject;
            const secondarySubject: string = svpJson.secondarySubject || '';
            const perspective: string = shot?.perspective || '';
            const perspectiveOf: string = shot?.perspectiveOf || (perspective === 'main_subject' ? mainSubject : perspective === 'secondary_subject' ? secondarySubject : '');
            if (perspective) {
              const parts = [`perspective: ${perspective}`];
              if (perspectiveOf) parts.push(`perspectiveOf: ${perspectiveOf}`);
              if (mainSubject) parts.push(`scene_mainSubject: ${mainSubject}`);
              if (secondarySubject) parts.push(`scene_secondarySubject: ${secondarySubject}`);
              perspectiveContext = `\n\n<shot_perspective>\n${parts.join('\n')}\n\nYour prose MUST reflect this viewpoint (see Perspective → Framing Bias in your guide).\n</shot_perspective>`;
            }

            // Focus block — what's sharp vs blurred
            const focus = shot?.focus;
            if (focus?.primary) {
              const parts = [`primary (sharp): ${focus.primary}`];
              if (Array.isArray(focus.background) && focus.background.length > 0) {
                parts.push(`background (blurred): ${focus.background.join(', ')}`);
              }
              if (focus.lurking) {
                parts.push(`lurking (defocused, planted for later): ${focus.lurking}`);
              }
              focusContext = `\n\n<shot_focus>\n${parts.join('\n')}\n\nYour prose MUST name what is sharp AND what is blurred (see Focus Rules in your guide).\n</shot_focus>`;
            }
          } catch { /* scene breakdown not readable */ }
        }
      }

      // Gather all refs, then filter by purpose
      const { refs: allRefs } = buildAvailableReferences(this.executor);
      if (shotPurpose) {
        const filtered = filterRefsByPurpose(allRefs, shotPurpose);
        referenceImageContext = formatReferencesForPrompt(filtered.refs);
        this.log(`  Refs filtered by purpose="${shotPurpose}": ${allRefs.length} → ${filtered.refs.length} (mode: ${filtered.generationMode})`);
      } else {
        referenceImageContext = formatReferencesForPrompt(allRefs);
      }

      // Shot context hint
      const prevShotId = node.itemId.replace(/shot_(\d+)/, (_: string, n: string) => `shot_${parseInt(n, 10) - 1}`);
      const prevNode = shotNum > 1
        ? this.executor.getNode(`shot_image:${prevShotId}`)
        : null;
      const previousAvailable = prevNode?.status === 'completed';
      shotContextHint = buildShotContextHint(node.itemId, previousAvailable, {
        currentPerspective: shotPerspective,
        previousPerspective: prevShotPerspective,
        continuityRole: shotContinuityRole,
        purpose: shotPurpose,
      });

      // Compute target state BEFORE generating image prompt
      if (sceneId) {
        try {
          const { loadSceneState, initializeSceneState, saveSceneState, formatStateForPrompt, buildStateContext } = await import('./sceneState.js');

          let previousState = loadSceneState(this.config.projectDir, sceneId);
          if (!previousState) {
            // Scope the initial character list to characters actually referenced
            // in THIS scene — previously we seeded every character in the graph,
            // which caused Glitch (apartment cat) to leak into the bar scene
            // and get rendered as a humanoid. Source of truth: the
            // scene_video_prompt JSON's mainSubject/secondarySubject and every
            // focus.* ref across all shots.
            const sceneCharRefIds = this.extractSceneCharacterRefs(sceneId);
            const allCharacters = this.executor.getAllNodes()
              .filter((n: any) => n.typeId === 'character' && n.itemId);
            const sceneCharacters = sceneCharRefIds.length > 0
              ? allCharacters.filter((n: any) => sceneCharRefIds.includes(n.itemId!))
              : allCharacters; // Fallback: if parse failed, use everyone (legacy behavior)
            const charInits = sceneCharacters.map((n: any) => ({
              refId: n.itemId!,
              kind: this.inferCharacterKind(n.itemId!),
            }));
            const settingNode = this.executor.getAllNodes()
              .find((n: any) => n.typeId === 'setting_image' && n.itemId);
            const setting = settingNode?.itemId ?? '';
            previousState = initializeSceneState(sceneId, charInits, setting);
            this.log(`  Scene state init (${sceneId}): ${charInits.length} character(s): ${charInits.map(c => `${c.refId}[${c.kind}]`).join(', ')}`);
          }

          if (shotDescription) {
            this.log(`  Computing target state for ${node.itemId}...`);
            const stateCtx = await buildStateContext(this.llmFor('structured.scene_state'), previousState, shotDescription);
            sceneStateContext = stateCtx.promptContext;

            if (stateCtx.targetState) {
              stateCtx.targetState.sceneId = sceneId;
              stateCtx.targetState.shotNumber = shotNum;

              // Option 2 continuity check — LLM judges whether the main subject teleported.
              // Runs after state extraction, before save, so the warning is associated with the fresh pair.
              try {
                const warning = await checkPositionContinuity(
                  previousState,
                  stateCtx.targetState,
                  sceneMainSubject,
                  shotContinuityRole,
                  shotNum,
                  this.llmFor('utility.continuity_check'),
                );
                if (warning) {
                  this.log(`  [Continuity position] ${warning.message}${warning.suggestion ? ` — ${warning.suggestion}` : ''}`);
                  // Auto-reroll: inject a bridging hint into THIS generation's
                  // context so the LLM produces a non-teleporting composition.
                  // Tracked per-node to avoid stacking hints on re-runs.
                  const decision = shouldRerollShot(warning);
                  if (decision.reroll && !this.retriedContinuity.has(node.id)) {
                    this.retriedContinuity.add(node.id);
                    sceneStateContext += decision.hint;
                    this.log(`  [Continuity auto-reroll] Injected bridging hint for ${node.id}`);
                    this.emit({
                      type: 'notification',
                      level: 'warning',
                      message: `Continuity: bridging hint added for ${node.id} (shot ${shotNum})`,
                    });
                  }
                }
              } catch (err) {
                this.log(`  [Continuity position] skipped: ${(err as Error).message}`);
              }

              saveSceneState(this.config.projectDir, sceneId, stateCtx.targetState);
              // Save per-shot diff so motion directive can read it
              const { saveShotStateDiff, buildLastFrameChanges } = await import('./sceneState.js');
              saveShotStateDiff(this.config.projectDir, sceneId, shotNum, previousState, stateCtx.targetState);
              // Inject last_frame_changes so the LLM knows what must differ in the last frame
              sceneStateContext += buildLastFrameChanges(previousState, stateCtx.targetState);
              this.log(`  Target state saved for ${sceneId} shot ${shotNum}`);

              // Show BEFORE + TARGET state cards in UI
              const agentName = this.config.name ?? 'kshana-executor';
              const beforeCallId = `state_before_${node.itemId}_${Date.now()}`;
              this.emit({ type: 'tool_call', toolCallId: beforeCallId, toolName: 'scene_state', arguments: { shot: node.itemId, phase: 'BEFORE' }, agentName });
              this.emit({ type: 'tool_streaming', toolCallId: beforeCallId, chunk: formatStateForPrompt(previousState), done: true, agentName, toolName: 'scene_state' });
              this.emit({ type: 'tool_result', toolCallId: beforeCallId, toolName: 'scene_state', result: { phase: 'before', state: previousState }, agentName });

              const targetCallId = `state_target_${node.itemId}_${Date.now()}`;
              this.emit({
                type: 'tool_call',
                toolCallId: targetCallId,
                toolName: 'scene_state',
                arguments: {
                  shot: node.itemId,
                  phase: 'TARGET',
                  model: this.modelFor('structured.scene_state'),
                },
                agentName,
              });
              const targetText = stateCtx.diff
                ? `CHANGES:\n${stateCtx.diff}\n\n---\nTARGET STATE:\n${formatStateForPrompt(stateCtx.targetState)}`
                : `No changes\n\n${formatStateForPrompt(stateCtx.targetState)}`;
              this.emit({ type: 'tool_streaming', toolCallId: targetCallId, chunk: targetText, done: true, agentName, toolName: 'scene_state' });
              this.emit({ type: 'tool_result', toolCallId: targetCallId, toolName: 'scene_state', result: { phase: 'target', diff: stateCtx.diff, state: stateCtx.targetState }, agentName });
            }
          } else if (previousState.shotNumber > 0) {
            // No shot description — inject previous state only
            sceneStateContext = `\n\n<scene_state>\n${formatStateForPrompt(previousState)}\n\nYour shot MUST be consistent with this state.\n</scene_state>`;
          }
        } catch { /* state not available yet */ }
      }
    }

    // For shot_motion_directive: inject state delta (what needs to MOVE)
    // The shot_image_prompt step saved a state diff file we can read
    let characterTagsBlock = '';
    if (node.typeId === 'shot_motion_directive' && node.itemId) {
      try {
        const { loadShotStateDiff, buildMotionStateContext } = await import('./sceneState.js');
        const sceneId = node.itemId.match(/(scene_\d+)/)?.[1];
        const shotNum = parseInt(node.itemId.match(/shot_(\d+)/)?.[1] ?? '0', 10);
        if (sceneId) {
          const shotDiff = loadShotStateDiff(this.config.projectDir, sceneId, shotNum);
          if (shotDiff) {
            sceneStateContext = buildMotionStateContext(shotDiff.previous, shotDiff.target);
            this.log(`  Motion directive: injected state delta for shot ${shotNum}`);
          }
        }

        // Inject short visual tags for every character visible in this
        // shot when there are 2+ of them. Video models have no idea who
        // "Parvati" or "Isha" are — naming them bare produces an
        // unresolved token and the model invents someone new. Tags like
        // "the older woman in faded blue salwar" disambiguate across
        // characters while still being compact.
        const shotImagePromptNode = this.executor.getNode(`shot_image_prompt:${node.itemId}`);
        if (shotImagePromptNode?.outputPath) {
          const promptPath = join(this.config.projectDir, shotImagePromptNode.outputPath);
          if (existsSync(promptPath)) {
            try {
              let raw = readFileSync(promptPath, 'utf-8').trim();
              if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
              const shotJson = JSON.parse(raw);
              // Pull the union of character refs across all frames —
              // last_frame sometimes lists chars that left the frame
              // mid-shot, which still need tagging if first_frame has them.
              const frames = shotJson.frames ?? {};
              const charRefIds = new Set<string>();
              for (const f of Object.values(frames) as any[]) {
                for (const r of f?.references ?? []) {
                  if (r?.type === 'character' && typeof r.refId === 'string') {
                    const itemId = r.refId.replace(/^character_image:/, '');
                    if (itemId) charRefIds.add(itemId);
                  }
                }
              }

              if (charRefIds.size >= 2) {
                const { buildCharacterTagsBlock } = await import('./characterVisualTags.js');
                const chars: Array<{ refId: string; mdPath: string }> = [];
                for (const refId of charRefIds) {
                  const charNode = this.executor.getNode(`character:${refId}`);
                  const outPath = charNode?.outputPath;
                  if (outPath) {
                    chars.push({ refId, mdPath: join(this.config.projectDir, outPath) });
                  }
                }
                characterTagsBlock = buildCharacterTagsBlock(chars);
                if (characterTagsBlock) {
                  this.log(`  Motion directive: injected character tags for ${chars.length} char(s)`);
                }
              }
            } catch { /* shot image prompt unreadable — skip tags */ }
          }
        }
      } catch { /* state not available */ }
    }

    // For scene nodes: inject scene_assignment with summaries and boundaries
    let sceneAssignment = '';
    if (node.typeId === 'scene' && node.itemId && this.sceneSummaries.size > 0) {
      const mySceneId = node.itemId;
      const mySummary = this.sceneSummaries.get(mySceneId) || '';
      const myTitle = node.displayName.replace(/^Scenes:\s*/, '');

      const allSummaries = [...this.sceneSummaries.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, summary]) => {
          const num = id.replace('scene_', '');
          const title = this.executor.getNode(`scene:${id}`)?.displayName?.replace(/^Scenes:\s*/, '') || id;
          return `Scene ${num}: "${title}" — ${summary}`;
        })
        .join('\n');

      sceneAssignment = `\n\n<scene_assignment>\nYOUR SCENE: ${mySceneId} — "${myTitle}"\nSUMMARY: ${mySummary}\n\nYou must ONLY write content for the beats described in YOUR SUMMARY above.\nDo NOT include events, dialogue, or climactic moments from other scenes.\n\nALL SCENES IN THIS VIDEO (for context only — write ONLY yours):\n${allSummaries}\n</scene_assignment>`;
      this.log(`  Injected scene_assignment for ${mySceneId} (${mySummary.substring(0, 50)}...)`);
    }

    const user = inputs.contextBlock
      ? `${task}${projectContext}${availableRefsBlock}${referenceImageContext}${sceneStateContext}${characterTagsBlock}${perspectiveContext}${focusContext}${shotContextHint}${sceneAssignment}\n\n${inputs.contextBlock}`
      : `${task}${projectContext}${availableRefsBlock}${referenceImageContext}${sceneStateContext}${characterTagsBlock}${perspectiveContext}${focusContext}${shotContextHint}${sceneAssignment}`;

    return { system: systemPrompt, user, loadedSkills };
  }

  /**
   * Extract the list of character refIds referenced in this scene's
   * breakdown (scene_video_prompt JSON). Used to scope the initial
   * scene state to actual scene participants — Glitch (apartment cat)
   * must not be seeded into the bar scene's state. Reads `mainSubject`,
   * `secondarySubject`, `perspectiveOf`, and every `focus.*` ref across
   * all shots, then filters to refIds that exist as `character:*` nodes.
   *
   * Returns an empty array if the scene breakdown can't be read — caller
   * falls back to legacy all-characters behavior.
   */
  private extractSceneCharacterRefs(sceneId: string): string[] {
    const svpNode = this.executor.getNode(`scene_video_prompt:${sceneId}`);
    if (!svpNode?.outputPath) return [];
    try {
      const path = join(this.config.projectDir, svpNode.outputPath);
      if (!existsSync(path)) return [];
      let raw = readFileSync(path, 'utf-8').trim();
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      const svp = JSON.parse(raw);

      const refs = new Set<string>();
      if (typeof svp.mainSubject === 'string') refs.add(svp.mainSubject);
      if (typeof svp.secondarySubject === 'string') refs.add(svp.secondarySubject);

      const shots = Array.isArray(svp.shots) ? svp.shots : [];
      for (const shot of shots) {
        if (typeof shot.perspectiveOf === 'string') refs.add(shot.perspectiveOf);
        const focus = shot.focus ?? {};
        if (typeof focus.primary === 'string') refs.add(focus.primary);
        if (typeof focus.lurking === 'string') refs.add(focus.lurking);
        if (Array.isArray(focus.background)) {
          for (const bg of focus.background) if (typeof bg === 'string') refs.add(bg);
        }
      }

      // Filter to refIds that exist as character nodes (drops settings,
      // objects, and prose-like entries such as "rifle_sights" or
      // "whiskey_glass" that share the focus field).
      const validCharRefs = new Set(
        this.executor.getAllNodes()
          .filter(n => n.typeId === 'character' && n.itemId)
          .map(n => n.itemId!)
      );
      return [...refs].filter(r => validCharRefs.has(r));
    } catch (err) {
      this.log(`  extractSceneCharacterRefs(${sceneId}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Infer whether a character is human or animal by reading their
   * character.md file for animal-indicator keywords (cat, dog, feline,
   * canine, horse, etc.). Falls back to 'unknown' if the file is
   * unreadable or ambiguous.
   *
   * 'unknown' is treated like 'human' by the state tracker (preserving
   * the pre-fix schema). 'animal' unlocks the quadruped schema path —
   * no leftHand/rightHand/legs/headTilt fields.
   */
  private inferCharacterKind(refId: string): 'human' | 'animal' | 'unknown' {
    const charNode = this.executor.getNode(`character:${refId}`);
    if (!charNode?.outputPath) return 'unknown';
    try {
      const path = join(this.config.projectDir, charNode.outputPath);
      if (!existsSync(path)) return 'unknown';
      const text = readFileSync(path, 'utf-8').toLowerCase();

      // Animal indicators. Strong signal — checking for any of these near
      // the top of the profile or in the physical description is enough.
      const animalKeywords = [
        'synthetic cat', 'robotic cat', 'cybernetic cat',
        ' cat ', ' feline ', ' kitten ',
        ' dog ', ' puppy ', ' canine ',
        ' horse ', ' mare ', ' stallion ',
        'tortoiseshell', 'whisker',
      ];
      for (const kw of animalKeywords) {
        if (text.includes(kw)) return 'animal';
      }
      // Default: humanoid. Most profiles describe humans and don't need
      // an explicit "human" marker.
      return 'human';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Load skill guides and model-specific skills for a node.
   * Returns combined skill content or null if none found.
   */
  private loadSkillsForNode(node: ExecutionNode): { content: string | null; files: string[] } {
    const parts: string[] = [];
    const loadedFiles: string[] = [];

    // Map node types to guide names and content types for skill resolution
    const guideMap: Record<string, string> = {
      plot: 'plot_guide',
      story: 'screenplay_guide',
      character_image: 'character_image_guide',
      setting_image: 'setting_image_guide',
      shot_image_prompt: 'shot_composition_guide',
      scene_video_prompt: 'scene_breakdown_guide',
      shot_video: 'scene_video_guide',
      scene: 'scene_guide',
      world_style: 'world_style_guide',
      shot_motion_directive: 'motion_directive_guide',
    };

    // Content type names for skill file resolution
    const contentTypeMap: Record<string, string> = {
      character_image: 'character_image_prompt',
      setting_image: 'setting_image_prompt',
      shot_image_prompt: 'shot_image_prompt',
      scene_video_prompt: 'scene_video_prompt',
      shot_video: 'scene_video_prompt',
    };

    // 1. Load default guide (universal rules)
    const guideName = guideMap[node.typeId];
    if (guideName) {
      try {
        const guide = resolveGuide(guideName, contentTypeMap[node.typeId] ?? node.typeId);
        if (guide.content) {
          parts.push(guide.content);
          loadedFiles.push(guide.source);
          this.log(`  Loaded guide: ${guide.source}`);
        }
      } catch {
        // Guide not found — non-fatal
      }
    }

    // 2. Load model-specific skills (layered on top of guide)
    const contentType = contentTypeMap[node.typeId];
    if (contentType) {
      // Map node types to their expected workflow for skill file resolution
      // character/setting images → zimage (text-to-image generation)
      // scene/shot images → flux2_klein_edit (image editing with references)
      // video → ltx23
      const workflowMap: Record<string, string> = {
        character_image: 'zimage',
        setting_image: 'zimage',
        shot_image_prompt: 'flux2_klein_edit',
        // scene_video_prompt does NOT need a workflow-specific skill — it plans shots, not video
        shot_video: 'ltx23',
      };

      let skillContext: SkillResolutionContext | undefined;
      const workflowName = workflowMap[node.typeId];

      // Try provider registry first, fall back to hardcoded defaults
      try {
        const config = getProviderRegistry().getConfig();
        const isVideo = node.typeId.includes('video');
        const providerId = isVideo ? config.videoGeneration : config.imageGeneration;
        if (providerId) {
          skillContext = { providerId, workflowName };
        }
      } catch {
        // Provider registry not available — use comfyui as default
        if (workflowName) {
          skillContext = { providerId: 'comfyui', workflowName };
        }
      }

      const skills = loadContentTypeSkills(contentType, skillContext);
      if (skills.content) {
        parts.push(skills.content);
        loadedFiles.push(...skills.loadedFiles);
        this.log(`  Loaded skills: ${skills.loadedFiles.join(', ')}`);
      }
    }

    // Substitute dynamic placeholders in loaded content
    let combined = parts.length > 0 ? parts.join('\n\n') : null;
    if (combined) {
      combined = this.substituteDynamicPlaceholders(combined);
    }

    return {
      content: combined,
      files: loadedFiles,
    };
  }

  /**
   * Replace {{PLACEHOLDER}} tokens in guide/skill content with dynamic values
   * from the WorkflowModeRegistry. This ensures the LLM only sees modes
   * available for the currently active provider.
   */
  private substituteDynamicPlaceholders(content: string): string {
    if (!content.includes('{{')) return content;

    try {
      const modeRegistry = getWorkflowModeRegistry();

      // Determine the active video provider
      let providerId = 'comfyui';
      try {
        const config = getProviderRegistry().getConfig();
        providerId = config.videoGeneration || 'comfyui';
      } catch { /* default to comfyui */ }

      content = content.replace('{{AVAILABLE_VIDEO_MODES}}', modeRegistry.generateVideoModesSection(providerId));
      content = content.replace('{{AVAILABLE_PROCESSING_MODES}}', modeRegistry.generateProcessingModesSection(providerId));
      content = content.replace('{{FRAME_GENERATION_GUIDE}}', modeRegistry.generateFrameGuideSection(providerId));
    } catch (err) {
      // Registry not available — leave placeholders as-is (they'll be visible but harmless)
      this.log(`  Warning: could not substitute dynamic placeholders: ${err}`);
    }

    return content;
  }

  // ===========================================================================
  // Private: Tool display helpers
  // ===========================================================================

  /**
   * Check if a prompt file already exists on disk for a media node.
   * Returns the relative path if found, null otherwise.
   */
  /**
   * Repair missing nodes in the graph. If a node references a dependency
   * that doesn't exist, recreate it from the template definition.
   * This fixes graph corruption from manual resets or incomplete expansions.
   */
  private repairMissingNodes(): void {
    const allNodes = this.executor.getAllNodes();
    let repaired = 0;

    for (const node of allNodes) {
      const newDeps = [...node.dependencies];
      let changed = false;

      for (let i = 0; i < newDeps.length; i++) {
        const depId = newDeps[i]!;
        if (this.executor.getNode(depId)) continue; // dependency exists, fine

        // Missing dependency — check if per-item nodes exist (expanded in previous session)
        const colonIdx = depId.indexOf(':');
        const typeId = colonIdx >= 0 ? depId.slice(0, colonIdx) : depId;
        const itemId: string | undefined = colonIdx >= 0 ? depId.slice(colonIdx + 1) : undefined;

        // Look for per-item nodes that match this type+item prefix
        const expandedNodes = allNodes.filter(n =>
          n.typeId === typeId && n.itemId && itemId && n.itemId.startsWith(itemId + '_'),
        );

        if (expandedNodes.length > 0) {
          // The type-level node was expanded into per-item nodes in a previous session.
          // Rewire: replace the stale dep with all per-item nodes.
          this.log(`  Rewiring ${node.id}: ${depId} → ${expandedNodes.map(n => n.id).join(', ')}`);
          newDeps.splice(i, 1, ...expandedNodes.map(n => n.id));
          i += expandedNodes.length - 1; // adjust index

          // Wire dependents on the per-item nodes
          for (const en of expandedNodes) {
            if (!en.dependents.includes(node.id)) {
              en.dependents.push(node.id);
            }
          }

          changed = true;
          repaired++;
        } else {
          // No expanded nodes found — recreate the missing node from template
          const typeDef = this.config.template.artifactTypes[typeId];
          if (typeDef) {
            const templateDeps = typeDef.dependencies
              .filter((d: { required: boolean }) => d.required)
              .map((d: { artifactTypeId: string; scope?: string }) => {
                if (d.scope === 'matching' && itemId) {
                  return `${d.artifactTypeId}:${itemId}`;
                }
                return d.artifactTypeId;
              })
              .filter((d: string) => this.executor.getNode(d));

            this.executor.addNode({
              id: depId,
              typeId,
              itemId: itemId ?? typeId,
              status: 'pending',
              displayName: `${typeDef.displayName}${itemId ? ': ' + itemId : ''}`,
              isExpensive: typeDef.isExpensive,
              isCollection: typeDef.isCollection,
              dependencies: templateDeps,
              dependents: [node.id],
            });

            for (const td of templateDeps) {
              const tdNode = this.executor.getNode(td);
              if (tdNode && !tdNode.dependents.includes(depId)) {
                tdNode.dependents.push(depId);
              }
            }

            this.log(`  Repaired missing node: ${depId} (needed by ${node.id})`);
            repaired++;
          }
        }
      }

      if (changed) {
        node.dependencies = newDeps;
      }
    }

    if (repaired > 0) {
      this.log(`Repaired ${repaired} missing/stale reference(s)`);
      this.persistState();
    }
  }

  /**
   * Expand any pending collection nodes whose dependencies are already completed.
   * This handles session resume where e.g. scene_video_prompt completed in a prior
   * run but shot_image_prompt wasn't expanded into per-shot nodes.
   */
  /**
   * Expand pending type-level collection nodes into per-item nodes.
   *
   * This handles two cases:
   * 1. Scene-level expansion: type-level `scene_video_prompt` → per-scene nodes
   *    (by finding completed per-item nodes of the matching-scope dependency type)
   * 2. Shot-level expansion: per-scene `shot_image_prompt:scene_N` → per-shot nodes
   *    (by reading the scene_video_prompt output to extract shots)
   *
   * Called at startup and during the execution loop to handle post-reset state
   * where type-level collections exist but haven't been expanded yet.
   */
  private async expandPendingCollections(): Promise<void> {
    // Load saved scene summaries from disk (survive restarts)
    if (this.sceneSummaries.size === 0) {
      const summaryPath = join(this.config.projectDir, 'prompts', 'scene_summaries.json');
      if (existsSync(summaryPath)) {
        try {
          const saved = JSON.parse(readFileSync(summaryPath, 'utf-8'));
          for (const [k, v] of Object.entries(saved)) {
            this.sceneSummaries.set(k, v as string);
          }
          this.log(`  Loaded ${this.sceneSummaries.size} scene summaries from disk`);
        } catch { /* ignore */ }
      }
    }

    const allNodes = this.executor.getAllNodes();
    let expanded = true;

    // Keep expanding until no more expansions happen (handles cascading: scene → SVP → shot)
    while (expanded) {
      expanded = false;

      for (const node of this.executor.getAllNodes()) {
        // Strategy B2: Scene-level → shot-level re-expansion (runs for completed OR pending nodes with itemId)
        // Template is authoritative for isCollection — stale saved state (e.g. noir_detective_story_setup-3
        // persisted shot_motion_directive:scene_1 with isCollection=false) must not block expansion.
        if (shouldExpandSceneCollectionToShots(node, this.config.template)) {
          const sceneId = node.itemId!;
          const svpNode = this.executor.getNode(`scene_video_prompt:${sceneId}`);
          if (svpNode?.status === 'completed' && svpNode.outputPath) {
            const hasChildren = this.executor.getAllNodes().some(
              n => n.typeId === node.typeId && n.itemId?.startsWith(`${sceneId}_shot_`),
            );
            if (!hasChildren) {
              try {
                const fullPath = join(this.config.projectDir, svpNode.outputPath);
                let content = readFileSync(fullPath, 'utf-8').trim();
                if (content.startsWith('```')) content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
                const parsed = JSON.parse(content);
                const shots = parsed.shots ?? (Array.isArray(parsed) ? parsed : []);
                if (shots.length > 0) {
                  const sceneLabel = sceneId.replace('scene_', 'S');
                  const shotItems = shots.map((s: any) => ({
                    itemId: `${sceneId}_shot_${s.shotNumber}`,
                    name: `${sceneLabel} Shot ${s.shotNumber}: ${s.cameraWork?.split(',')[0] || 'shot'}`,
                  }));
                  this.log(`  Re-expanding ${node.id} → ${shotItems.length} per-shot nodes`);
                  this.executor.expandCollection(node.id, shotItems);

                  // For shot_image_prompt: also create shot_image and shot_video per-shot nodes
                  if (node.typeId === 'shot_image_prompt') {
                    const allCharImages = this.executor.getAllNodes()
                      .filter(n => n.typeId === 'character_image' && n.itemId).map(n => n.id);
                    const allSettingImages = this.executor.getAllNodes()
                      .filter(n => n.typeId === 'setting_image' && n.itemId).map(n => n.id);
                    let prevShotImageId: string | null = null;
                    let prevShotVideoId2: string | null = null;
                    for (const shot of shotItems) {
                      const shotImageId = `shot_image:${shot.itemId}`;
                      const shotVideoId = `shot_video:${shot.itemId}`;
                      const motionId = `shot_motion_directive:${shot.itemId}`;
                      const promptId = `shot_image_prompt:${shot.itemId}`;
                      if (!this.executor.getNode(shotImageId)) {
                        const deps = [promptId, ...allCharImages, ...allSettingImages];
                        if (prevShotImageId) deps.push(prevShotImageId);
                        this.executor.addNode({
                          id: shotImageId, typeId: 'shot_image', itemId: shot.itemId,
                          status: 'pending', displayName: `Shot Images: ${shot.name}`,
                          isExpensive: true, isCollection: false, dependencies: deps, dependents: [shotVideoId],
                        });
                        for (const depId of deps) {
                          const depNode = this.executor.getNode(depId);
                          if (depNode && !depNode.dependents.includes(shotImageId)) depNode.dependents.push(shotImageId);
                        }
                      }
                      if (!this.executor.getNode(shotVideoId)) {
                        const videoDeps = [shotImageId, motionId];
                        if (prevShotVideoId2) videoDeps.push(prevShotVideoId2);
                        this.executor.addNode({
                          id: shotVideoId, typeId: 'shot_video', itemId: shot.itemId,
                          status: 'pending', displayName: `Shot Videos: ${shot.name}`,
                          isExpensive: true, isCollection: false, dependencies: videoDeps, dependents: [],
                        });
                        for (const depId of videoDeps) {
                          const depNode = this.executor.getNode(depId);
                          if (depNode && !depNode.dependents.includes(shotVideoId)) depNode.dependents.push(shotVideoId);
                        }
                      }
                      prevShotImageId = shotImageId;
                      prevShotVideoId2 = shotVideoId;
                    }
                  }

                  expanded = true;
                  continue;
                }
              } catch (err) {
                this.log(`  Failed to re-expand ${node.id}: ${err}`);
              }
            }
          }
        }

        if (!node.isCollection || node.status !== 'pending') continue;
        if (node.itemId) continue; // Already a per-item node — skip (only expand type-level)

        // Strategy 1: Find upstream per-item nodes to determine item set
        // Look at the template to find which dependency has 'matching' scope
        const typeDef = this.config.template.artifactTypes[node.typeId];
        if (!typeDef) {
          this.log(`  expandPendingCollections: no typeDef for ${node.typeId}`);
          continue;
        }

        let didExpand = false;
        this.log(`  expandPendingCollections: checking ${node.id} (${typeDef.dependencies.length} deps)`);

        for (const dep of typeDef.dependencies) {
          if (dep.scope !== 'matching') continue;
          this.log(`    dep ${dep.artifactTypeId} scope=matching`);

          // Strategy A: Find completed per-item nodes of this dependency type
          const upstreamItems = allNodes
            .filter(n => n.typeId === dep.artifactTypeId && n.itemId &&
              (n.status === 'completed' || n.status === 'pending'))
            .map(n => ({ itemId: n.itemId!, name: n.displayName.split(': ').pop() ?? n.itemId! }));

          if (upstreamItems.length > 0) {
            this.log(`  Expanding type-level ${node.id} → ${upstreamItems.length} items from ${dep.artifactTypeId} per-item nodes`);
            this.executor.expandCollection(node.id, upstreamItems);
            this.emit({
              type: 'notification',
              level: 'info',
              message: `Expanded ${node.displayName}: ${upstreamItems.map(i => i.name).join(', ')}`,
            });
            didExpand = true;
            expanded = true;
            break;
          }

          // Strategy B: No per-item nodes exist (post-reset collapsed state).
          // Scan the output content for item patterns (SCENE 1, SCENE 2, etc.)
          const upstreamTypeLevel = allNodes.find(
            n => n.typeId === dep.artifactTypeId && !n.itemId && n.status === 'completed' && n.outputPath
          );
          if (upstreamTypeLevel?.outputPath) {
            const fullPath = join(this.config.projectDir, upstreamTypeLevel.outputPath);
            if (existsSync(fullPath)) {
              try {
                const content = readFileSync(fullPath, 'utf-8');
                let itemList: Array<{ itemId: string; name: string }> = [];

                // Parse scene numbers from content patterns like "SCENE 1:", "## Scene 2", etc.
                if (dep.artifactTypeId === 'scene' || dep.artifactTypeId === 'story') {
                  const sceneMatches = content.matchAll(/\bSCENE\s+(\d+)[:\s—–-]+([^\n*]+)/gi);
                  const seen = new Set<number>();
                  for (const m of sceneMatches) {
                    const num = parseInt(m[1]!, 10);
                    if (!seen.has(num)) {
                      seen.add(num);
                      itemList.push({ itemId: `scene_${num}`, name: m[2]!.trim().substring(0, 60) });
                    }
                  }
                }

                // Parse character names from content
                if (dep.artifactTypeId === 'character' && itemList.length === 0) {
                  const charMatches = content.matchAll(/^##\s+(.+)/gm);
                  for (const m of charMatches) {
                    const name = m[1]!.trim();
                    if (name.length > 2 && !name.startsWith('#')) {
                      itemList.push({ itemId: name.toLowerCase().replace(/\s+/g, '_'), name });
                    }
                  }
                }

                // Parse setting names from content
                if (dep.artifactTypeId === 'setting' && itemList.length === 0) {
                  const settingMatches = content.matchAll(/^#\s+(.+)/gm);
                  for (const m of settingMatches) {
                    const name = m[1]!.trim();
                    if (name.length > 2) {
                      itemList.push({ itemId: name.toLowerCase().replace(/\s+/g, '_'), name });
                    }
                  }
                }

                // Parse object names from content
                if (dep.artifactTypeId === 'object' && itemList.length === 0) {
                  const objectMatches = content.matchAll(/^##\s+(.+)/gm);
                  for (const m of objectMatches) {
                    const name = m[1]!.trim();
                    if (name.length > 2 && !name.startsWith('#')) {
                      itemList.push({ itemId: name.toLowerCase().replace(/\s+/g, '_'), name });
                    }
                  }
                }

                if (itemList.length > 0) {
                  this.log(`  Expanding type-level ${node.id} → ${itemList.length} items from ${dep.artifactTypeId} output: ${itemList.map(i => i.itemId).join(', ')}`);
                  this.executor.expandCollection(node.id, itemList);
                  this.emit({
                    type: 'notification',
                    level: 'info',
                    message: `Expanded ${node.displayName}: ${itemList.map(i => i.name).join(', ')}`,
                  });
                  didExpand = true;
                  expanded = true;
                  break;
                } else {
                  this.log(`  Strategy B: no items found in ${dep.artifactTypeId} output (${content.length} chars)`);
                }
              } catch (err) {
                this.log(`  Failed to parse items from ${upstreamTypeLevel.outputPath}: ${err}`);
              }
            }
          } else {
            this.log(`    No type-level ${dep.artifactTypeId} node with output found`);
          }
        }

        if (didExpand) continue;

        // Strategy B2: Scene-level → shot-level expansion for shot_image_prompt, shot_motion_directive, shot_image, shot_video
        // After reset, these scene-level collection nodes may be completed/pending but have no per-shot children.
        // Re-read the scene_video_prompt output to determine shot items and expand.
        if (!didExpand && shouldExpandSceneCollectionToShots(node, this.config.template)) {
          const sceneId = node.itemId!;
          const svpNode = this.executor.getNode(`scene_video_prompt:${sceneId}`);
          if (svpNode?.status === 'completed' && svpNode.outputPath) {
            // Check if per-shot children already exist
            const hasChildren = this.executor.getAllNodes().some(
              n => n.typeId === node.typeId && n.itemId?.startsWith(`${sceneId}_shot_`),
            );
            if (!hasChildren) {
              try {
                const fullPath = join(this.config.projectDir, svpNode.outputPath);
                let content = readFileSync(fullPath, 'utf-8').trim();
                if (content.startsWith('```')) content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
                const parsed = JSON.parse(content);
                const shots = parsed.shots ?? (Array.isArray(parsed) ? parsed : []);
                if (shots.length > 0) {
                  const sceneLabel = sceneId.replace('scene_', 'S');
                  const shotItems = shots.map((s: any) => ({
                    itemId: `${sceneId}_shot_${s.shotNumber}`,
                    name: `${sceneLabel} Shot ${s.shotNumber}: ${s.cameraWork?.split(',')[0] || 'shot'}`,
                  }));
                  this.log(`  Re-expanding ${node.id} → ${shotItems.length} per-shot nodes from scene_video_prompt`);
                  this.executor.expandCollection(node.id, shotItems);

                  // For shot_image_prompt: also create shot_image and shot_video per-shot nodes
                  if (node.typeId === 'shot_image_prompt') {
                    const allCharImages = this.executor.getAllNodes()
                      .filter(n => n.typeId === 'character_image' && n.itemId).map(n => n.id);
                    const allSettingImages = this.executor.getAllNodes()
                      .filter(n => n.typeId === 'setting_image' && n.itemId).map(n => n.id);
                    let prevShotImageId: string | null = null;
                    let prevShotVideoId2: string | null = null;
                    for (const shot of shotItems) {
                      const shotImageId = `shot_image:${shot.itemId}`;
                      const shotVideoId = `shot_video:${shot.itemId}`;
                      const motionId = `shot_motion_directive:${shot.itemId}`;
                      const promptId = `shot_image_prompt:${shot.itemId}`;
                      if (!this.executor.getNode(shotImageId)) {
                        const deps = [promptId, ...allCharImages, ...allSettingImages];
                        if (prevShotImageId) deps.push(prevShotImageId);
                        this.executor.addNode({
                          id: shotImageId, typeId: 'shot_image', itemId: shot.itemId,
                          status: 'pending', displayName: `Shot Images: ${shot.name}`,
                          isExpensive: true, isCollection: false, dependencies: deps, dependents: [shotVideoId],
                        });
                        for (const depId of deps) {
                          const depNode = this.executor.getNode(depId);
                          if (depNode && !depNode.dependents.includes(shotImageId)) depNode.dependents.push(shotImageId);
                        }
                      }
                      if (!this.executor.getNode(shotVideoId)) {
                        this.executor.addNode({
                          id: shotVideoId, typeId: 'shot_video', itemId: shot.itemId,
                          status: 'pending', displayName: `Shot Videos: ${shot.name}`,
                          isExpensive: true, isCollection: false, dependencies: [shotImageId, motionId], dependents: [],
                        });
                        const imgNode = this.executor.getNode(shotImageId);
                        if (imgNode && !imgNode.dependents.includes(shotVideoId)) imgNode.dependents.push(shotVideoId);
                        const motNode = this.executor.getNode(motionId);
                        if (motNode && !motNode.dependents.includes(shotVideoId)) motNode.dependents.push(shotVideoId);
                      }
                      prevShotImageId = shotImageId;
                    }
                  }

                  didExpand = true;
                  expanded = true;
                }
              } catch (err) {
                this.log(`  Failed to re-expand ${node.id}: ${err}`);
              }
            }
          }
        }

        if (didExpand) continue;

        // Strategy C: For collections that depend on 'story' (scene, character, setting),
        // run extractCollectionItems on the story output to determine items.
        // This handles post-reset state where story is completed but per-item nodes don't exist.
        if (!didExpand) {
          const storyNode = allNodes.find(n => n.typeId === 'story' && n.status === 'completed' && n.outputPath);
          if (storyNode?.outputPath && typeDef.dependencies.some(d => d.artifactTypeId === 'story')) {
            const storyPath = join(this.config.projectDir, storyNode.outputPath);
            if (existsSync(storyPath)) {
              try {
                const storyContent = readFileSync(storyPath, 'utf-8');
                const extracted = await extractCollectionItems(
                  storyNode, storyContent, this.llmFor('structured.collection_extraction'),
                  this.config.goal.preferences.duration as number | undefined,
                );
                let itemList: Array<{ itemId: string; name: string }> = [];

                if (node.typeId === 'scene' && extracted?.scenes?.length) {
                  itemList = extracted.scenes.map((s: any) => ({
                    itemId: `scene_${s.sceneNumber}`,
                    name: s.title || `Scene ${s.sceneNumber}`,
                  }));
                } else if (node.typeId === 'character' && extracted?.characters?.length) {
                  itemList = extracted.characters.map((c: string) => ({
                    itemId: c.toLowerCase().replace(/\s+/g, '_'),
                    name: c,
                  }));
                } else if (node.typeId === 'setting' && extracted?.settings?.length) {
                  itemList = extracted.settings.map((s: string) => ({
                    itemId: s.toLowerCase().replace(/\s+/g, '_'),
                    name: s,
                  }));
                } else if (node.typeId === 'object' && extracted?.objects?.length) {
                  itemList = extracted.objects.map((o: string) => ({
                    itemId: o.toLowerCase().replace(/\s+/g, '_'),
                    name: o,
                  }));
                }

                if (itemList.length > 0) {
                  this.log(`  Strategy C: Expanding ${node.id} → ${itemList.length} items from story extraction`);
                  this.executor.expandCollection(node.id, itemList);
                  this.emit({
                    type: 'notification',
                    level: 'info',
                    message: `Expanded ${node.displayName}: ${itemList.map(i => i.name).join(', ')}`,
                  });
                  didExpand = true;
                  expanded = true;
                } else {
                  this.log(`  Strategy C: no ${node.typeId} items found in story`);
                }
              } catch (err) {
                this.log(`  Strategy C failed: ${err}`);
              }
            }
          }
        }

        if (didExpand) continue;

        // Strategy 2: For per-scene shot nodes, read scene_video_prompt output to extract shots
        for (const depId of node.dependencies) {
          const dep = this.executor.getNode(depId);
          if (!dep?.outputPath || dep.typeId !== 'scene_video_prompt') continue;

          const fullPath = join(this.config.projectDir, dep.outputPath);
          if (!existsSync(fullPath)) continue;

          const content = readFileSync(fullPath, 'utf-8');
          const items = await extractCollectionItems(dep, content, this.llmFor('structured.collection_extraction'), this.config.goal.preferences.duration as number | undefined);
          if (!items?.shots?.length) continue;

          const sceneId = dep.itemId;
          if (!sceneId) continue;

          const shotItems = items.shots.map(s => ({
            itemId: `${sceneId}_shot_${s.shotNumber}`,
            name: `Shot ${s.shotNumber}: ${s.shotType}`,
          }));

          this.log(`  Startup expansion: ${node.id} → ${shotItems.map(i => i.name).join(', ')}`);
          this.executor.expandCollection(node.id, shotItems);
          this.emit({
            type: 'notification',
            level: 'info',
            message: `Expanded ${node.displayName}: ${shotItems.map(i => i.name).join(', ')}`,
          });
          expanded = true;
          break;
        }
      }
    }

    // Post-expansion: fix dangling dependencies (type-level refs to expanded nodes)
    // e.g., scene_video_prompt:scene_1 depends on 'scene' (type-level, gone after expansion)
    // → rewire to 'scene:scene_1' (per-item, matching scope)
    //
    // CRITICAL: do NOT strip deps from type-level collection nodes that are
    // still waiting to be expanded. If scene_video_prompt (type-level, no
    // itemId) has a dep on `scene` that was expanded away, we CANNOT rewire
    // here (no itemId to key off of) and we MUST NOT strip — those deps are
    // carried into the per-item nodes when this collection finally gets
    // expanded. Stripping here caused every downstream per-item node to
    // inherit a broken dep list with no parent content. (See dep-propagation
    // regression suite.)
    for (const node of this.executor.getAllNodes()) {
      const newDeps: string[] = [];
      let fixed = false;
      const isUnexpandedTypeLevel = !node.itemId && node.isCollection;
      for (const depId of node.dependencies) {
        if (this.executor.getNode(depId)) {
          newDeps.push(depId);
        } else {
          // Try to find a per-item version: depId + ':' + node.itemId's scene prefix
          // e.g., 'scene' → 'scene:scene_1' when node is 'scene_video_prompt:scene_1'
          const itemId = node.itemId;
          if (itemId) {
            const perItemId = `${depId}:${itemId}`;
            if (this.executor.getNode(perItemId)) {
              newDeps.push(perItemId);
              this.log(`  Fixed dangling dep: ${node.id} → ${depId} rewired to ${perItemId}`);
              fixed = true;
              continue;
            }
          }
          if (isUnexpandedTypeLevel) {
            // Keep the dep so it'll be rewired during expansion. Stripping
            // it would blind every per-item node this collection produces.
            newDeps.push(depId);
            continue;
          }
          // Per-item node with a genuinely unresolvable dep — drop it to
          // prevent deadlock. (Type-level collection nodes preserve deps
          // above; per-item deps failing to resolve are rarer and usually
          // indicate template/plan drift.)
          this.log(`  Removed dangling dep from ${node.id}: ${depId} (node doesn't exist)`);
          fixed = true;
        }
      }
      if (fixed) {
        node.dependencies = newDeps;
      }
    }
  }

  /**
   * Validate that LLM output is valid JSON with required fields.
   */
  /**
   * Attempt to repair common JSON issues from LLM output:
   * - Two arrays/objects concatenated (] [ or } {) → take the last one
   * - Trailing commas before ] or }
   * - Truncated JSON → close open brackets/braces
   */
  /**
   * Check if a cached prompt file is stale — i.e., any dependency node was
   * completed more recently than the prompt file was written.
   * This detects prompts from before a reset that need regeneration.
   */
  /**
   * Whether a node represents an LLM call (as opposed to ComfyUI /
   * FFmpeg / deterministic work). These are the nodes we fan out
   * concurrently when `LLM_MODE=cloud` enables parallelism.
   *
   * Rule: anything with category `visual_ref`, `clip`, or `final` is
   * NOT an LLM node — those go through ComfyUI or FFmpeg and have their
   * own concurrency controls. Everything else (content, structure,
   * concept, etc.) is an LLM node.
   *
   * Exception: a media node whose prompt has not yet been generated
   * still issues an LLM call for the prompt in the SAME pass. That
   * case is fine to parallelize — the outer `runOneNode` will write
   * the prompt, then either kick off ComfyUI (parallel media mode) or
   * block on it (serial media mode). We keep the node classification
   * stable for simplicity; if the per-node path hits the ComfyUI
   * block, it's the same as today and unaffected by LLM concurrency.
   */
  private isLLMEligibleNode(node: ExecutionNode): boolean {
    const typeDef = this.config.template.artifactTypes[node.typeId];
    const cat = typeDef?.category;
    return cat !== 'visual_ref' && cat !== 'clip' && cat !== 'final';
  }

  /**
   * Resolve the concurrency cap for LLM calls from env.
   *
   * Config:
   *   - `LLM_MODE=cloud|local` (default `local`)
   *   - `LLM_PARALLELISM_CLOUD` (default `4` when mode=cloud)
   *   - `LLM_PARALLELISM_LOCAL` (default `1` when mode=local)
   *
   * Local mode defaults to 1 because a single local model server (LM
   * Studio, llama.cpp) serializes requests anyway — the value just
   * fights the server's own queue. Cloud defaults to 4 as a
   * conservative starting point that fits inside most provider rate
   * limits; users can tune via the `LLM_PARALLELISM_CLOUD` var.
   *
   * Read lazily per-call (no caching) so `.env` edits and test
   * overrides via `process.env` take effect without a restart of the
   * orchestrator.
   */
  private getLLMConcurrency(): number {
    const mode = (process.env['LLM_MODE'] ?? 'local').toLowerCase();
    const key = mode === 'cloud' ? 'LLM_PARALLELISM_CLOUD' : 'LLM_PARALLELISM_LOCAL';
    const fallback = mode === 'cloud' ? 4 : 1;
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
  }

  /**
   * Check if any completed dependency has a missing output file.
   * Returns the list of dependency IDs whose output files don't exist.
   */
  private validateDependencyOutputs(node: ExecutionNode): string[] {
    const missing: string[] = [];
    for (const depId of node.dependencies) {
      const dep = this.executor.getNode(depId);
      if (!dep || dep.status !== 'completed') continue;
      if (!dep.outputPath) continue;
      const fullPath = join(this.config.projectDir, dep.outputPath);
      if (!existsSync(fullPath)) {
        missing.push(depId);
      }
    }
    return missing;
  }

  private isPromptStale(node: ExecutionNode, promptPath: string): boolean {
    try {
      const { statSync } = require('fs') as typeof import('fs');
      const promptMtime = statSync(promptPath).mtimeMs;

      for (const depId of node.dependencies) {
        const depNode = this.executor.getNode(depId);
        if (depNode?.completedAt && depNode.completedAt > promptMtime) {
          this.log(`  Prompt file is stale: ${depId} completed at ${new Date(depNode.completedAt).toISOString()} > prompt mtime ${new Date(promptMtime).toISOString()}`);
          return true;
        }
      }
      return false;
    } catch {
      return false; // if we can't stat, assume not stale
    }
  }

  private repairJson(text: string): string {
    let s = text.trim();

    // Strategy 1: Extract first valid JSON object/array from the text.
    // Handles thinking preamble before JSON (common with Nemotron, local models).
    // Scans for { or [ and tries to parse from that position.
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '{' || s[i] === '[') {
        // Find the matching closing bracket by trying progressively longer substrings
        const openChar = s[i]!;
        const closeChar = openChar === '{' ? '}' : ']';
        let depth = 0;
        let inString = false;
        let escape = false;

        for (let j = i; j < s.length; j++) {
          const ch = s[j]!;
          if (escape) { escape = false; continue; }
          if (ch === '\\' && inString) { escape = true; continue; }
          if (ch === '"' && !escape) { inString = !inString; continue; }
          if (inString) continue;
          if (ch === openChar) depth++;
          if (ch === closeChar) depth--;
          if (depth === 0) {
            const candidate = s.substring(i, j + 1);
            try {
              JSON.parse(candidate);
              if (i > 0) {
                this.log(`  JSON repair: extracted JSON from position ${i} (skipped ${i} chars of preamble)`);
              }
              return candidate;
            } catch {
              break; // This bracket pair didn't produce valid JSON, try next
            }
          }
        }
      }
    }

    // Strategy 2: Take the last complete JSON object (for concatenated outputs)
    const lastObjStart = s.lastIndexOf('{');
    if (lastObjStart > 0) {
      const candidate = s.substring(lastObjStart);
      try {
        JSON.parse(candidate);
        this.log(`  JSON repair: using last object from position ${lastObjStart}`);
        return candidate;
      } catch { /* try other repairs */ }
    }

    const lastArrayStart = s.lastIndexOf('[');
    if (lastArrayStart > 0) {
      const candidate = s.substring(lastArrayStart);
      try {
        JSON.parse(candidate);
        this.log(`  JSON repair: using last array from position ${lastArrayStart}`);
        return candidate;
      } catch { /* try other repairs */ }
    }

    // Strategy 3: Trailing commas
    s = s.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');

    return s;
  }

  private validateJsonOutput(content: string, node: ExecutionNode): { valid: boolean; error?: string; normalizedContent?: string } {
    // Strip markdown code fences if the LLM wrapped the JSON
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    // Attempt JSON repair before parsing
    cleaned = this.repairJson(cleaned);

    try {
      const parsed = JSON.parse(cleaned);

      // Validate against Zod schema
      const result = validateWithSchema(node.typeId, parsed);
      if (!result.valid) {
        return { valid: false, error: result.error };
      }

      let mutated = false;

      // Auto-normalize scene_video_prompt fields
      if (node.typeId === 'scene_video_prompt') {
        normalizeSceneVideoPrompt(parsed);
        this.runContinuitySequenceCheck(parsed, node.id);
        // Dialogue-fit pass: bump any shot whose declared `duration` is
        // shorter than the dialogue in its `audio` field. Without this
        // the video model generates the exact requested duration and
        // clips long speeches mid-sentence. Capped at 15s (LTX 2.3's
        // practical ceiling).
        if (Array.isArray(parsed?.shots)) {
          const adjustments = fitShotDurations(parsed.shots as Array<Record<string, unknown>>);
          if (adjustments.length > 0) {
            this.log(`  [dialogue-fit] ${node.id}: adjusted ${adjustments.length} shot(s): ${adjustments.map(a => `shot${a.shotNumber} ${a.from}s→${a.to}s (dialogue=${a.dialogueSeconds}s)`).join(', ')}`);
          }
          // Soft-warn: flag any shot with 2+ speakers in its audio
          // field. See scene_breakdown_guide.md "Step 2a: One speaker
          // per shot" — video models mis-attribute dialogue when one
          // shot tries to carry two speakers. Warning only; not a
          // validation failure, to avoid blocking legacy projects.
          const multiSpeaker = scanMultiSpeakerShots(parsed.shots as Array<Record<string, unknown>>);
          if (multiSpeaker.length > 0) {
            this.log(`  [multi-speaker] ${node.id}: ${multiSpeaker.length} shot(s) carry 2+ speakers — video model will likely mis-attribute: ${multiSpeaker.map(w => `shot${w.shotNumber}(${w.speakers.join('+')})`).join(', ')}`);
          }
        }
        mutated = true;
      }

      // Per-frame normalization for shot_image_prompt. Order matters:
      //
      //   (1) Normalize first_frame (inject missing refs + reorder so
      //       settings sit at index 0). This establishes canonical
      //       (refId → imageNumber) numbering for the shot.
      //
      //   (2) alignFramesToFirstFrame propagates first_frame's mapping
      //       to every non-first frame — inheriting dropped refs and
      //       rewriting `from image N` tags where the LLM renumbered.
      //       Must run AFTER (1) so the canonical numbering is stable,
      //       and BEFORE (3) so the per-frame injector sees aligned
      //       numbering and doesn't duplicate "from image N" tags.
      //
      //   (3) Normalize the remaining frames (last_frame, mid_frame).
      //       Now safe to inject any missing tags / rerun reorder.
      //
      //   (4) OTS-with-single-char hard gate — reject the prompt if any
      //       frame combines OTS framing with fewer than two character
      //       refs. Forces regen against the strengthened guide.
      if (node.typeId === 'shot_image_prompt' && parsed?.frames && typeof parsed.frames === 'object') {
        const availableRefs = this.buildAvailableRefsForShot(node);
        const allInjected: Array<{ frame: string; label: string; imageNumber: number; kind: string }> = [];

        // (1) first_frame normalization.
        const ffKey = 'first_frame';
        const ff = parsed.frames[ffKey];
        if (ff && typeof ff === 'object' && typeof ff.imagePrompt === 'string' && Array.isArray(ff.references)) {
          const result = normalizeShotImagePromptWithRefs(ff, availableRefs);
          parsed.frames[ffKey] = result.frame;
          for (const ev of result.injected) {
            allInjected.push({ frame: ffKey, ...ev });
          }
        }

        // (2) Align other frames to first_frame's canonical mapping.
        alignFramesToFirstFrame(parsed, availableRefs);

        // (3) Per-frame normalization for non-first frames.
        for (const frameKey of Object.keys(parsed.frames)) {
          if (frameKey === ffKey) continue;
          const f = parsed.frames[frameKey];
          if (f && typeof f === 'object' && typeof f.imagePrompt === 'string' && Array.isArray(f.references)) {
            const result = normalizeShotImagePromptWithRefs(f, availableRefs);
            parsed.frames[frameKey] = result.frame;
            for (const ev of result.injected) {
              allInjected.push({ frame: frameKey, ...ev });
            }
          }
        }

        if (allInjected.length > 0) {
          this.log(`  [ref-inject] ${node.id}: injected ${allInjected.length} ref(s): ${allInjected.map(i => `${i.frame}/${i.label}#${i.imageNumber}(${i.kind})`).join(', ')}`);
        }

        // (4) Hard gate: OTS prose + <2 character refs ⇒ reject.
        const otsIssues = scanOTSWithSingleChar(parsed);
        if (otsIssues.length > 0) {
          const detail = otsIssues
            .map(i => `${i.frame}: ${i.reason}`)
            .join(' | ');
          return { valid: false, error: `OTS-with-single-character violation. ${detail}` };
        }

        mutated = true;
      }

      return {
        valid: true,
        normalizedContent: mutated ? JSON.stringify(parsed, null, 2) : undefined,
      };
    } catch (e) {
      return { valid: false, error: `JSON parse error: ${String(e)}` };
    }
  }

  /**
   * Option 1 continuity check — sync JSON walk of scene_video_prompt shot list.
   * Logs warnings; does not reject.
   */
  private runContinuitySequenceCheck(svp: unknown, nodeId: string): void {
    try {
      const warnings = validateContinuitySequence(svp as Parameters<typeof validateContinuitySequence>[0]);
      if (warnings.length > 0) {
        this.log(`  [Continuity sequence] ${warnings.length} warning(s) for ${nodeId}:\n${formatContinuityWarnings(warnings)}`);
      }
    } catch (err) {
      this.log(`  [Continuity sequence] skipped: ${(err as Error).message}`);
    }
  }

  /**
   * Execute media generation with retry. Retries up to maxRetries times
   * with a delay between attempts for transient ComfyUI failures.
   */
  private async executeMediaGenerationWithRetry(
    node: ExecutionNode,
    promptPath: string,
    toolCallId: string,
    maxRetries = 2,
  ): Promise<string | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.executeMediaGeneration(node, promptPath, toolCallId);
      if (result) return result;

      if (attempt < maxRetries) {
        const delay = (attempt + 1) * 5000; // 5s, 10s
        this.log(`  Media gen failed for ${node.id}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
        this.emit({
          type: 'notification',
          level: 'warning',
          message: `Retrying ${node.displayName} in ${delay / 1000}s...`,
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return null;
  }

  /**
   * Build the full project reference list for normalizer injection.
   *
   * NOTE (Option B, 2026-04-24): this used to mirror the `generateForNode`
   * path (filter by shot purpose) so the numbers we inject match what
   * the LLM saw. But the filter excludes characters from shots with
   * purposes like `show_passage` and `set_the_world` — and the LLM
   * frequently names those filtered-out characters in its prose anyway
   * ("Isha mid-stride, Parvati lingering at the gate"). Without their
   * refs the image generator hallucinates what those characters look
   * like instead of loading their consistent reference images.
   *
   * Switching to UNFILTERED refs here means: if a character is named
   * in prose, we tag it with its canonical project-wide image number
   * and add it to the refs array, regardless of the purpose filter.
   * The reorder pass then renumbers the whole frame to a contiguous
   * 1..N so the final JSON is internally consistent. This preserves
   * character consistency at image-gen time without requiring the LLM
   * to respect the filter perfectly.
   *
   * Synchronous by design — called from validateJsonOutput. Returns an
   * empty array if anything is missing; callers treat that as "nothing
   * to inject."
   */

  /**
   * Scan a freshly-generated motion directive for ambiguous speaker
   * tags (bare "She says", "The woman says", etc.) when 2+ characters
   * are in the shot. Pure soft warning — logged to help diagnose
   * dialogue-to-mouth mis-attribution but does not block the run.
   *
   * Char list comes from the matching shot_image_prompt JSON's
   * references array. If the shot_image_prompt isn't readable yet we
   * skip silently — the scanner is best-effort.
   */
  private scanMotionDirectiveForAmbiguousSpeaker(node: ExecutionNode, content: string): void {
    if (!node.itemId) return;
    let motionDirective = '';
    try {
      const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, ''));
      motionDirective = typeof parsed?.motionDirective === 'string' ? parsed.motionDirective : '';
    } catch {
      return; // LLM output wasn't parseable JSON; nothing to scan
    }
    if (!motionDirective) return;

    const shotPromptNode = this.executor.getNode(`shot_image_prompt:${node.itemId}`);
    if (!shotPromptNode?.outputPath) return;
    const promptPath = join(this.config.projectDir, shotPromptNode.outputPath);
    if (!existsSync(promptPath)) return;

    const charsInShot: string[] = [];
    try {
      let raw = readFileSync(promptPath, 'utf-8').trim();
      if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      const shotJson = JSON.parse(raw);
      const seen = new Set<string>();
      for (const f of Object.values(shotJson.frames ?? {}) as Array<{ references?: Array<{ type?: string; refId?: string }> }>) {
        for (const r of f?.references ?? []) {
          if (r?.type === 'character' && typeof r.refId === 'string') {
            const label = r.refId.replace(/^character_image:/, '');
            if (label && !seen.has(label)) {
              seen.add(label);
              charsInShot.push(label);
            }
          }
        }
      }
    } catch {
      return;
    }

    const warnings = scanAmbiguousSpeakerTag(motionDirective, charsInShot);
    if (warnings.length > 0) {
      this.log(`  [ambiguous-speaker] ${node.id}: ${warnings.length} ambiguous tag(s) with ${charsInShot.length} chars in frame (${charsInShot.join(', ')}):`);
      for (const w of warnings) {
        this.log(`    - "${w.match}" → dialogue: "${w.quotedDialogue}"`);
      }
    }
  }

  private buildAvailableRefsForShot(node: ExecutionNode): AvailableRefMinimal[] {
    if (node.typeId !== 'shot_image_prompt' || !node.itemId) return [];

    const REF_TYPE_IDS = new Set(['character_image', 'setting_image', 'object_image']);
    const typeIdToRefType = (typeId: string): 'character' | 'setting' | 'object' => {
      if (typeId === 'character_image') return 'character';
      if (typeId === 'setting_image') return 'setting';
      return 'object';
    };
    const nodes = this.executor.getAllNodes().filter((n: any) =>
      REF_TYPE_IDS.has(n.typeId) && n.itemId,
    );
    return nodes.map((n: any, i: number) => ({
      imageNumber: i + 1,
      type: typeIdToRefType(n.typeId),
      refId: n.id,
      label: n.itemId ?? n.id.split(':')[1] ?? n.id,
    }));
  }

  /**
   * Build reference image mapping for a shot_image_prompt node.
   * Reads the scene_video_prompt JSON to find which characters/setting are in this shot,
   * then tells the LLM which image N maps to what. Actual file resolution happens at
   * image generation time, not prompt generation time.
   */
  private buildShotReferenceMapping(node: ExecutionNode): string {
    if (!node.itemId) return '';

    // Extract scene ID and shot number: "scene_1_shot_2" → sceneId="scene_1", shotNum=2
    const sceneMatch = node.itemId.match(/(scene_\d+)/);
    const shotMatch = node.itemId.match(/shot_(\d+)/);
    if (!sceneMatch) return '';

    const sceneId = sceneMatch[1];
    const shotNum = shotMatch?.[1] ? parseInt(shotMatch[1], 10) : 1;

    // Find the scene_video_prompt output and read the JSON
    const svpNode = this.executor.getNode(`scene_video_prompt:${sceneId}`);
    if (!svpNode?.outputPath) return '';

    const fullPath = join(this.config.projectDir, svpNode.outputPath);
    if (!existsSync(fullPath)) return '';

    try {
      let content = readFileSync(fullPath, 'utf-8').trim();
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const parsed = JSON.parse(content);
      const shot = parsed.shots?.find((s: { shotNumber: number }) => s.shotNumber === shotNum);
      if (!shot) return '';

      // Build reference image list from the scene_video_prompt JSON.
      // The refIds are deterministic (character_image:{charId}, setting_image:{settingId}).
      // Actual .png resolution happens at ComfyUI generation time, not here.
      // This allows shot prompts to be generated before/in parallel with image generation.
      const availableRefs: Array<{ imageNumber: number; type: string; refId: string; label: string }> = [];
      let imageNum = 1;

      // Support both new (firstFrame) and legacy (top-level) formats
      const characters: string[] = shot.firstFrame?.characters ?? shot.characters ?? [];
      for (const charId of characters) {
        availableRefs.push({ imageNumber: imageNum, type: 'character', refId: `character_image:${charId}`, label: charId });
        imageNum++;
      }

      const setting = shot.firstFrame?.setting ?? shot.setting;
      if (setting) {
        availableRefs.push({ imageNumber: imageNum, type: 'setting', refId: `setting_image:${setting}`, label: setting });
        imageNum++;
      }

      if (availableRefs.length === 0) {
        return '\n\n<available_references>\nNo reference images available. Set generationMode to "text_to_image" and references to [].\n</available_references>';
      }

      const refList = availableRefs.map(r =>
        `- image ${r.imageNumber}: ${r.type} "${r.label}" (ref_id: "${r.refId}")`
      ).join('\n');

      return `\n\n<available_references>\nAvailable reference images for this shot:\n${refList}\n\nUse "from image N" in your imagePrompt. Include each used reference in the "references" array with its ref_id.\n</available_references>`;
    } catch {
      return '';
    }
  }

  /**
   * Return the prompt JSON path IF the project.json says there's a valid
   * cached prompt for this node. Project.json is the source of truth —
   * orphan files on disk (e.g. left behind by a reset) do NOT count.
   *
   * Background: the executor has an optimization for media nodes — if
   * the prompt JSON is already on disk, skip the LLM and render only.
   * Previously this used pure filesystem existence, which meant
   * `/reset <stage>` → reset node to `pending` but keep file on disk
   * caused the next run to silently reuse the stale file. The reset's
   * intent was "regenerate," but the cache defeated it.
   *
   * Now: we only carry a prompt file across runs if `node.promptPath` is
   * explicitly set in project.json. Reset clears `promptPath`, so a
   * pending node with no `promptPath` ALWAYS regenerates — matching
   * the user's expectation of what "reset" means.
   */
  private findExistingPromptFile(node: ExecutionNode): string | null {
    // Source of truth: project.json must explicitly record a prompt path
    // before we trust any on-disk file. Orphan files are ignored.
    if (!node.promptPath) return null;

    const fullPath = join(this.config.projectDir, node.promptPath);
    if (!existsSync(fullPath)) {
      // project.json points at a file that's been deleted — also ignore.
      return null;
    }
    return node.promptPath;
  }

  /**
   * Get a clean, descriptive tool name for the UI based on node type and category.
   */
  private getToolDisplayName(node: ExecutionNode): string {
    const typeDef = this.config.template.artifactTypes[node.typeId];
    const category = typeDef?.category;

    // For visual_ref nodes, we're generating prompts not actual images
    if (category === 'visual_ref') {
      const base = node.typeId.replace(/_image$/, '').replace(/_/g, '_');
      return `gen_${base}_prompt`;
    }
    if (category === 'clip') {
      return `gen_${node.typeId.replace(/_/g, '_')}_prompt`;
    }

    // For text content, use a short descriptive name
    return `generate_${node.typeId}`;
  }

  /**
   * Build clean, human-readable arguments for the tool call display.
   * No JSON keys — just a descriptive summary.
   */
  private getToolDisplayArgs(
    node: ExecutionNode,
    inputs: ResolvedInputs,
  ): Record<string, unknown> {
    const args: Record<string, unknown> = {};

    // Show the item name prominently if it's a collection item
    if (node.itemId) {
      args['item'] = node.displayName;
    }

    // Show what context was loaded, as a simple list
    if (inputs.filesRead.length > 0) {
      args['context'] = inputs.filesRead.join(', ');
    }

    // Show reference images if any
    if (inputs.referenceImages.length > 0) {
      args['references'] = inputs.referenceImages.map(r => `${r.name} (${r.type})`).join(', ');
    }

    return args;
  }

  // ===========================================================================
  // Private: LLM generation
  // ===========================================================================

  /**
   * Call the LLM to generate content for a node.
   * Pure completion — no tools, no agent loop.
   */
  private async generateForNode(
    node: ExecutionNode,
    system: string,
    user: string,
    toolCallId?: string,
    toolDisplayName?: string,
    purposeOverride?: LLMPurpose,
  ): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    // Use lower temperature and suppress thinking for formulaic tasks (prompts)
    const typeDef = this.config.template.artifactTypes[node.typeId];
    const isFormulaic = typeDef?.category === 'visual_ref' || typeDef?.category === 'clip'
      || node.typeId === 'shot_image_prompt';

    const options: GenerateOptions = {
      messages,
      temperature: isFormulaic ? 0.3 : 0.7,
    };

    // Force JSON output for all structured/image prompt nodes
    const jsonNodeTypes = ['scene_video_prompt', 'shot_image_prompt', 'character_image', 'setting_image'];
    const isJsonNode = jsonNodeTypes.includes(node.typeId) || typeDef?.outputFormat === 'json';
    if (isJsonNode) {
      options.responseFormat = { type: 'json_object' };
    }

    // Inject JSON schema into the system prompt so the LLM sees the exact expected structure.
    // Schema text is generated from the same source (schemas.ts) that validates the output.
    if (isJsonNode) {
      const schema = getPromptSchema(node.typeId);
      if (schema) {
        messages[0]!.content += `\n\nCRITICAL: Your response MUST be a single valid JSON object. No markdown fences, no backticks, no commentary before or after the JSON. Output ONLY the JSON.\n\n${schema}`;
      }
    }

    const agentName = this.config.name ?? 'kshana-executor';
    const effectiveToolName = toolDisplayName ?? `generate_${node.typeId}`;
    // Think-tag parsing path — always active.
    // Separates <think> blocks from content and emits them separately.
    // Uses incremental flush to avoid unbounded buffer growth
    const contentChunks: string[] = [];
    let buffer = '';
    let insideThink = false;

    const purpose = purposeOverride ?? this.purposeForNode(node);
    const client = this.llmFor(purpose);
    for await (const chunk of client.generateStream(options)) {
      // Handle reasoning_content from llama.cpp (separate field, not in-band)
      if (chunk.thinking && toolCallId) {
        this.emit({
          type: 'tool_streaming',
          toolCallId, chunk: `<thinking>${chunk.thinking}</thinking>`, done: false,
          agentName, toolName: effectiveToolName,
        });
        continue; // Don't process as regular content
      }

      if (!chunk.content) continue;

      buffer += chunk.content;

      // Process buffer — flush as much as possible each iteration
      while (buffer.length > 0) {
        if (insideThink) {
          const closeIdx = buffer.indexOf('</think>');
          if (closeIdx !== -1) {
            const thinkContent = buffer.slice(0, closeIdx);
            if (thinkContent && toolCallId) {
              // Send thinking content to the tool card with a marker prefix
              this.emit({
                type: 'tool_streaming',
                toolCallId, chunk: `\n<thinking>${thinkContent}</thinking>\n`, done: false,
                agentName, toolName: effectiveToolName,
              });
            }
            buffer = buffer.slice(closeIdx + '</think>'.length);
            insideThink = false;
          } else {
            // Flush all but the last 8 chars (potential partial </think>)
            if (buffer.length > 8) {
              const flushContent = buffer.slice(0, -8);
              if (toolCallId) {
                this.emit({
                  type: 'tool_streaming',
                  toolCallId, chunk: `<thinking>${flushContent}</thinking>`, done: false,
                  agentName, toolName: effectiveToolName,
                });
              }
              buffer = buffer.slice(-8);
            }
            break;
          }
        } else {
          const openIdx = buffer.indexOf('<think>');
          if (openIdx !== -1) {
            const content = buffer.slice(0, openIdx);
            if (content) {
              contentChunks.push(content);
              if (toolCallId) {
                this.emit({
                  type: 'tool_streaming',
                  toolCallId, chunk: content, done: false,
                  agentName, toolName: effectiveToolName,
                });
              }
            }
            buffer = buffer.slice(openIdx + '<think>'.length);
            insideThink = true;
          } else {
            // Flush all but the last 7 chars (potential partial <think>)
            if (buffer.length > 7) {
              const safe = buffer.slice(0, -7);
              contentChunks.push(safe);
              if (toolCallId) {
                this.emit({
                  type: 'tool_streaming',
                  toolCallId, chunk: safe, done: false,
                  agentName, toolName: effectiveToolName,
                });
              }
              buffer = buffer.slice(-7);
            }
            break;
          }
        }
      }
    }

    // Flush remaining buffer
    if (buffer.length > 0 && !insideThink) {
      contentChunks.push(buffer);
      if (toolCallId) {
        this.emit({
          type: 'tool_streaming',
          toolCallId, chunk: buffer, done: false,
          agentName, toolName: effectiveToolName,
        });
      }
    }
    if (toolCallId) {
      this.emit({
        type: 'tool_streaming',
        toolCallId, chunk: '', done: true,
        agentName, toolName: effectiveToolName,
      });
    }

    return contentChunks.join('');
  }

  // ===========================================================================
  // Private: Collection expansion
  // ===========================================================================

  /**
   * After a node completes, extract collection items and expand dependent nodes.
   */
  private async handleCollectionExpansion(
    node: ExecutionNode,
    content: string,
  ): Promise<void> {
    const agentName = this.config.name ?? 'kshana-executor';

    // Determine what we're extracting based on node type
    const isShotExtraction = node.typeId === 'scene_video_prompt';
    const extractingLabel = isShotExtraction ? 'shots' : 'characters, settings, scenes';

    // Show the extraction in the UI as a tool call
    const extractCallId = `extract_${node.id}_${Date.now()}`;
    this.emit({
      type: 'tool_call',
      toolCallId: extractCallId,
      toolName: 'extract_collections',
      arguments: {
        source: node.displayName,
        extracting: extractingLabel,
        model: this.modelFor('structured.collection_extraction'),
      },
      agentName,
    });
    this.emit({
      type: 'tool_streaming',
      toolCallId: extractCallId,
      chunk: `Analyzing ${node.displayName} to extract ${extractingLabel}...`,
      done: false,
      agentName,
      toolName: 'extract_collections',
    });

    const items = await extractCollectionItems(node, content, this.llmFor('structured.collection_extraction'), this.config.goal.preferences.duration as number | undefined);

    if (!items) {
      this.log(`  No collection items extracted from ${node.id}`);
      this.emit({
        type: 'tool_result',
        toolCallId: extractCallId,
        toolName: 'extract_collections',
        result: { status: 'no items found' },
        agentName,
      });
      return;
    }
    this.log(`  Extracted: characters=${items.characters?.length ?? 0}, settings=${items.settings?.length ?? 0}, scenes=${items.scenes?.length ?? 0}, shots=${items.shots?.length ?? 0}`);

    // Stream the results
    const parts: string[] = [];
    if (items.characters?.length) parts.push(`**Characters:** ${items.characters.join(', ')}`);
    if (items.settings?.length) parts.push(`**Settings:** ${items.settings.join(', ')}`);
    if (items.scenes?.length) parts.push(`**Scenes:** ${items.scenes.map(s => `${s.sceneNumber}. ${s.title}`).join(', ')}`);
    if (items.shots?.length) parts.push(`**Shots:** ${items.shots.map(s => `${s.shotNumber}. ${s.shotType}`).join(', ')}`);

    this.emit({
      type: 'tool_streaming',
      toolCallId: extractCallId,
      chunk: `\n\n${parts.join('\n')}`,
      done: true,
      agentName,
      toolName: 'extract_collections',
    });
    this.emit({
      type: 'tool_result',
      toolCallId: extractCallId,
      toolName: 'extract_collections',
      result: {
        characters: items.characters,
        settings: items.settings,
        scenes: items.scenes?.map(s => s.title),
        shots: items.shots?.map(s => `${s.shotNumber}: ${s.shotType}`),
      },
      agentName,
    });

    // Handle shot-level expansion: scene_video_prompt:scene_N → shot_image_prompt per shot
    if (isShotExtraction && items.shots?.length && node.itemId) {
      const sceneId = node.itemId; // e.g., "scene_1"
      const sceneLabel = sceneId.replace('scene_', 'S');
      const shotItems = items.shots.map(s => ({
        itemId: `${sceneId}_shot_${s.shotNumber}`,
        name: `${sceneLabel} Shot ${s.shotNumber}: ${s.shotType}`,
      }));

      // Find the shot_image_prompt and shot_motion_directive nodes for this scene and expand them.
      // If per-scene nodes don't exist (e.g., after reset), create them from the type-level collection.
      let shotPromptNode = this.executor.getNode(`shot_image_prompt:${sceneId}`);
      let motionDirectiveNode = this.executor.getNode(`shot_motion_directive:${sceneId}`);

      // If per-scene nodes don't exist, expand the type-level collection into per-scene first
      if (!shotPromptNode) {
        const typeLevelPrompt = this.executor.getNode('shot_image_prompt');
        if (typeLevelPrompt && typeLevelPrompt.isCollection) {
          this.log(`  Creating per-scene node shot_image_prompt:${sceneId} from type-level collection`);
          this.executor.expandCollection('shot_image_prompt', [{ itemId: sceneId, name: `Scene ${sceneId.replace('scene_', '')}` }]);
          shotPromptNode = this.executor.getNode(`shot_image_prompt:${sceneId}`);
        }
      }
      if (!motionDirectiveNode) {
        const typeLevelMotion = this.executor.getNode('shot_motion_directive');
        if (typeLevelMotion && typeLevelMotion.isCollection) {
          this.log(`  Creating per-scene node shot_motion_directive:${sceneId} from type-level collection`);
          this.executor.expandCollection('shot_motion_directive', [{ itemId: sceneId, name: `Scene ${sceneId.replace('scene_', '')}` }]);
          motionDirectiveNode = this.executor.getNode(`shot_motion_directive:${sceneId}`);
        }
      }

      if (shotPromptNode || motionDirectiveNode) {
        this.log(`  Expanding shots for ${sceneId}: ${shotItems.map(i => i.name).join(', ')}`);
        if (shotPromptNode) {
          this.executor.expandCollection(`shot_image_prompt:${sceneId}`, shotItems);
        }
        if (motionDirectiveNode) {
          this.executor.expandCollection(`shot_motion_directive:${sceneId}`, shotItems);
        }

        // Wire sequential deps for shot_image_prompt nodes (scene state tracking)
        // Each shot_image_prompt depends on the previous one so state accumulates in order
        let prevShotPromptId: string | null = null;
        for (const shot of shotItems) {
          const promptId = `shot_image_prompt:${shot.itemId}`;
          const promptNode = this.executor.getNode(promptId);
          if (promptNode && prevShotPromptId) {
            if (!promptNode.dependencies.includes(prevShotPromptId)) {
              promptNode.dependencies.push(prevShotPromptId);
              const prevNode = this.executor.getNode(prevShotPromptId);
              if (prevNode && !prevNode.dependents.includes(promptId)) {
                prevNode.dependents.push(promptId);
              }
            }
          }
          prevShotPromptId = promptId;
        }

        // Also create shot_image and shot_video per-shot nodes with proper dependencies.
        // These can't rely on expandCollection's dependency inheritance because the
        // type-level node's deps don't include per-item refs.
        const allCharImages = this.executor.getAllNodes()
          .filter(n => n.typeId === 'character_image' && n.itemId)
          .map(n => n.id);
        const allSettingImages = this.executor.getAllNodes()
          .filter(n => n.typeId === 'setting_image' && n.itemId)
          .map(n => n.id);

        let prevShotImageId: string | null = null;
        let prevShotVideoId: string | null = null;
        for (const shot of shotItems) {
          const shotPromptId = `shot_image_prompt:${shot.itemId}`;
          const motionId = `shot_motion_directive:${shot.itemId}`;
          const shotImageId = `shot_image:${shot.itemId}`;
          const shotVideoId = `shot_video:${shot.itemId}`;

          // Create shot_image node if it doesn't exist
          if (!this.executor.getNode(shotImageId)) {
            const shotImageDeps = [shotPromptId, ...allCharImages, ...allSettingImages];
            // Cross-shot chaining: each shot depends on the previous shot in the scene
            // so the executor processes them sequentially and edit_previous_shot can access the last frame
            if (prevShotImageId) {
              shotImageDeps.push(prevShotImageId);
            }
            this.executor.addNode({
              id: shotImageId,
              typeId: 'shot_image',
              itemId: shot.itemId,
              status: 'pending',
              displayName: `Shot Images: ${shot.name}`,
              isExpensive: true,
              isCollection: false,
              dependencies: shotImageDeps,
              dependents: [shotVideoId],
            });
            // Wire dependents on upstream nodes
            for (const depId of shotImageDeps) {
              const depNode = this.executor.getNode(depId);
              if (depNode && !depNode.dependents.includes(shotImageId)) {
                depNode.dependents.push(shotImageId);
              }
            }
          }

          // Create or fix shot_video node (sequential — each depends on previous for V2V extend)
          if (!this.executor.getNode(shotVideoId)) {
            const shotVideoDeps = [shotImageId, motionId];
            if (prevShotVideoId) shotVideoDeps.push(prevShotVideoId);
            this.executor.addNode({
              id: shotVideoId,
              typeId: 'shot_video',
              itemId: shot.itemId,
              status: 'pending',
              displayName: `Shot Videos: ${shot.name}`,
              isExpensive: true,
              isCollection: false,
              dependencies: shotVideoDeps,
              dependents: [],
            });
            // Wire dependents
            for (const depId of shotVideoDeps) {
              const depNode = this.executor.getNode(depId);
              if (depNode && !depNode.dependents.includes(shotVideoId)) {
                depNode.dependents.push(shotVideoId);
              }
            }
          } else {
            // Node exists — fix stale type-level dependencies → per-item
            const existing = this.executor.getNode(shotVideoId)!;
            const fixDeps: Array<[string, string]> = [
              ['shot_motion_directive', motionId],
              ['shot_image', shotImageId],
            ];
            for (const [stale, correct] of fixDeps) {
              const idx = existing.dependencies.indexOf(stale);
              if (idx >= 0) {
                existing.dependencies[idx] = correct;
                this.log(`  Rewired ${shotVideoId}: ${stale} → ${correct}`);
              }
            }
            // Wire final_video to depend on this shot_video
            const finalNode = this.executor.getNode('final_video');
            if (finalNode && !finalNode.dependencies.includes(shotVideoId)) {
              finalNode.dependencies.push(shotVideoId);
            }
          }
          prevShotImageId = shotImageId;
          prevShotVideoId = shotVideoId;
        }
        this.log(`  Created ${shotItems.length} shot_image + shot_video nodes for ${sceneId} with proper deps (sequential video chaining for V2V extend)`);

        this.emit({
          type: 'notification',
          level: 'info',
          message: `Expanded shots for ${sceneId}: ${shotItems.map(i => i.name).join(', ')}`,
        });
      } else {
        this.log(`  No shot_image_prompt or shot_motion_directive node found for ${sceneId}`);
      }
      this.emitTodoUpdate();

      // Timeline: create/recreate skeleton on first scene expansion, then split into shots.
      // Always recreate if the timeline has per-shot segments from a previous run
      // (stale after reset — scene_1 segments don't exist, only scene_1_shot_N).
      const needsReinit = !this.timeline ||
        !this.timeline.segments.some(s => s.id === sceneId);
      if (needsReinit) {
        this.initializeTimelineFromScenes();
      }
      if (this.timeline && items.shots?.length) {
        const shotDescriptors = items.shots.map(s => ({
          label: `Shot ${s.shotNumber}: ${s.shotType}`,
          duration: s.duration || 5,
        }));
        this.timeline = splitSegmentIntoShots(this.timeline, sceneId, shotDescriptors);

        // Propagate transitions from scene_video_prompt JSON (if available)
        try {
          if (node.outputPath) {
            const svpPath = join(this.config.projectDir, node.outputPath);
            if (existsSync(svpPath)) {
              let svpContent = readFileSync(svpPath, 'utf-8').trim();
              if (svpContent.startsWith('```')) svpContent = svpContent.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
              const parsed = JSON.parse(svpContent);
              if (parsed.shots) {
                for (const shot of parsed.shots as Array<{ shotNumber: number; transition?: string }>) {
                  if (shot.transition && shot.transition !== 'cut') {
                    const segId = `${sceneId}_shot_${shot.shotNumber}`;
                    this.timeline = setSegmentTransition(this.timeline, segId, {
                      type: shot.transition as import('../timeline/types.js').TransitionType,
                      durationMs: shot.transition === 'flash_to_white' ? 200
                        : shot.transition === 'dip_to_black' ? 800 : 500,
                    });
                  }
                }
              }
            }
          }
        } catch { /* transitions are non-critical */ }

        saveTimeline(this.config.projectDir, this.timeline);
        this.emitTimelineUpdate();
      }

      return;
    }

    // Handle story/outline-level expansion: characters, settings, scenes
    const collectionDeps = this.executor.getCollectionDependents(node);

    for (const depTypeId of collectionDeps) {
      const depTypeDef = this.config.template.artifactTypes[depTypeId];
      if (!depTypeDef) continue;

      // Determine which items apply to this dependent type
      let applicableItems: Array<{ itemId: string; name: string }> = [];

      if (depTypeId === 'character' || depTypeId.includes('character')) {
        applicableItems = (items.characters ?? []).map(name => ({
          itemId: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          name,
        }));
      } else if (depTypeId === 'setting' || depTypeId.includes('setting')) {
        applicableItems = (items.settings ?? []).map(name => ({
          itemId: name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
          name,
        }));
      } else if (depTypeId === 'scene' || depTypeId.includes('scene')) {
        applicableItems = (items.scenes ?? []).map(s => ({
          itemId: `scene_${s.sceneNumber}`,
          name: s.title,
        }));
        // Store scene summaries for injection into scene writer prompts
        // Save to disk so they survive restarts
        for (const s of items.scenes ?? []) {
          if (s.summary) {
            this.sceneSummaries.set(`scene_${s.sceneNumber}`, s.summary);
            this.log(`  Stored summary for scene_${s.sceneNumber}: ${s.summary.substring(0, 60)}...`);
          }
        }
        if (this.sceneSummaries.size > 0) {
          const summaryPath = join(this.config.projectDir, 'prompts', 'scene_summaries.json');
          if (!existsSync(join(this.config.projectDir, 'prompts'))) mkdirSync(join(this.config.projectDir, 'prompts'), { recursive: true });
          writeFileSync(summaryPath, JSON.stringify(Object.fromEntries(this.sceneSummaries), null, 2));
        }
      }

      if (applicableItems.length > 0) {
        this.log(`  Expanding ${depTypeId}: ${applicableItems.map(i => i.name).join(', ')}`);
        this.executor.expandCollection(depTypeId, applicableItems);
        this.emit({
          type: 'notification',
          level: 'info',
          message: `Expanded ${depTypeDef.displayName}: ${applicableItems.map(i => i.name).join(', ')}`,
        });
      }
    }
  }

  // ===========================================================================
  // Private: User approval
  // ===========================================================================

  /**
   * Ask the user for approval before an expensive operation.
   * Returns true if approved, false if skipped.
   *
   * For now, auto-approves. Full implementation will use the question event
   * and wait for user input injection.
   */
  private async askApproval(
    _node: ExecutionNode,
    _inputs: ResolvedInputs,
  ): Promise<boolean> {
    // TODO: Implement user approval flow via question event + input injection
    // For now, auto-approve all operations
    return true;
  }

  // ===========================================================================
  // Private: State persistence
  // ===========================================================================

  /**
   * Persist executor state to project.json.
   */
  // ===========================================================================
  // Private: Deterministic media generation
  // ===========================================================================

  /**
   * Execute actual media generation after the LLM has written a prompt file.
   * This is deterministic — reads the prompt file, calls the provider, saves the result.
   * Returns the actual media file path, or null if generation fails.
   */
  private async executeMediaGeneration(
    node: ExecutionNode,
    promptFilePath: string,
    toolCallId: string,
  ): Promise<string | null> {
    const agentName = this.config.name ?? 'kshana-executor';
    const projectDir = this.config.projectDir;
    const fullPromptPath = join(projectDir, promptFilePath);

    if (!existsSync(fullPromptPath)) {
      this.log(`  Media gen: prompt file not found: ${fullPromptPath}`);
      return null;
    }

    // Check if image generation provider is available
    try {
      const provider = getProviderRegistry().getImageGenerator();
      if (!provider) {
        this.log(`  Media gen: no image generation provider configured`);
        this.emit({
          type: 'notification',
          level: 'warning',
          message: `No image provider available — skipping media gen for ${node.displayName}. Prompt saved.`,
        });
        return null;
      }
    } catch (err) {
      this.log(`  Media gen: provider check failed: ${String(err)}`);
      this.emit({
        type: 'notification',
        level: 'warning',
        message: `Image provider not reachable — skipping media gen for ${node.displayName}. Prompt saved.`,
      });
      return null;
    }

    const typeDef = this.config.template.artifactTypes[node.typeId];
    const category = typeDef?.category;

    if (category === 'visual_ref') {
      return this.executeImageGeneration(node, fullPromptPath, toolCallId, agentName);
    } else if (category === 'clip') {
      return this.executeVideoGeneration(node, fullPromptPath, toolCallId, agentName);
    }

    return null;
  }

  /**
   * Read the generationStrategy for a shot node.
   * Checks shot_image_prompt first (preferred — slim scene breakdown),
   * then falls back to scene_video_prompt (legacy).
   */
  private getGenerationStrategy(node: ExecutionNode): string {
    if (!node.itemId) return 'i2v';

    // 1. Check shot_image_prompt output (preferred source in slim scene breakdown)
    const sipNode = this.executor.getNode(`shot_image_prompt:${node.itemId}`);
    if (sipNode?.outputPath) {
      const sipPath = join(this.config.projectDir, sipNode.outputPath);
      if (existsSync(sipPath)) {
        try {
          let content = readFileSync(sipPath, 'utf-8').trim();
          if (content.startsWith('```')) {
            content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
          }
          const parsed = JSON.parse(content);
          if (parsed.generationStrategy) {
            return parsed.generationStrategy;
          }
        } catch { /* fall through */ }
      }
    }

    // 2. Fallback: check scene_video_prompt (legacy format with generationStrategy on shots)
    const sceneMatch = node.itemId.match(/scene_(\d+)/);
    const shotMatch = node.itemId.match(/shot_(\d+)/);
    if (!sceneMatch) return 'i2v';

    const sceneNum = parseInt(sceneMatch[1]!, 10);
    const shotNum = shotMatch?.[1] ? parseInt(shotMatch[1], 10) : 1;

    const svpNode = this.executor.getNode(`scene_video_prompt:scene_${sceneNum}`);
    if (!svpNode?.outputPath) return 'i2v';

    const fullPath = join(this.config.projectDir, svpNode.outputPath);
    if (!existsSync(fullPath)) return 'i2v';

    try {
      let content = readFileSync(fullPath, 'utf-8').trim();
      if (content.startsWith('```')) {
        content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const parsed = JSON.parse(content);
      const shot = parsed.shots?.find((s: { shotNumber: number }) => s.shotNumber === shotNum);
      return shot?.videoGenerationMode || shot?.generationStrategy || 'i2v';
    } catch {
      return 'i2v';
    }
  }

  /**
   * Execute a shot_image node: read the prompt JSON from the shot_image_prompt dependency,
   * resolve reference image paths, and submit to ComfyUI.
   */
  private async executeShotImage(
    node: ExecutionNode,
    toolCallId: string,
  ): Promise<string | null> {
    // Find the MATCHING shot_image_prompt dependency (same itemId) and read its JSON output
    const matchingPromptId = `shot_image_prompt:${node.itemId}`;
    let promptDep = this.executor.getNode(matchingPromptId);
    if (!promptDep || promptDep.status !== 'completed') {
      // Fallback: find any shot_image_prompt dep with matching itemId
      promptDep = node.dependencies
        .map(depId => this.executor.getNode(depId))
        .find(n => n?.typeId === 'shot_image_prompt' && n.itemId === node.itemId && n.status === 'completed') ?? undefined;
    }

    if (!promptDep?.outputPath) {
      this.log(`  No completed shot_image_prompt dependency for ${node.id}`);
      return null;
    }

    const jsonPath = join(this.config.projectDir, promptDep.outputPath);
    if (!existsSync(jsonPath)) {
      this.log(`  Shot image prompt file not found: ${jsonPath}`);
      return null;
    }

    const jsonContent = readFileSync(jsonPath, 'utf-8');

    // Validate the prompt JSON — if corrupt, invalidate the prompt node and return null
    // so the executor regenerates it on next run
    let parsedJson: any;
    try {
      let cleaned = jsonContent.trim();
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      parsedJson = JSON.parse(cleaned);
    } catch (parseErr) {
      this.log(`  Shot image prompt JSON is corrupt: ${(parseErr as Error).message}`);
      this.log(`  Invalidating corrupt prompt → will regenerate on next run`);
      this.executor.invalidateNode(promptDep.id);
      this.persistState();
      return null;
    }

    // Validate structure: must have either frames.first_frame or imagePrompt
    const hasFrames = parsedJson?.frames && typeof parsedJson.frames === 'object';
    const hasImagePrompt = typeof parsedJson?.imagePrompt === 'string';
    if (!hasFrames && !hasImagePrompt) {
      this.log(`  Shot image prompt has no frames or imagePrompt — invalidating`);
      this.executor.invalidateNode(promptDep.id);
      this.persistState();
      return null;
    }

    if (hasFrames && !parsedJson.frames['first_frame']?.imagePrompt) {
      this.log(`  Shot image prompt frames missing first_frame.imagePrompt — invalidating`);
      this.executor.invalidateNode(promptDep.id);
      this.persistState();
      return null;
    }

    if (hasFrames) {
      // New per-frame format: each frame has its own prompt and generation mode
      this.log(`  Per-frame format detected: ${Object.keys(parsedJson.frames).join(', ')}`);

      // Normalization (inject + reorder) happens upstream in
      // validateJsonOutput, so the JSON on disk is already normalized.
      // We still run a defensive reorder pass here for JSONs that
      // bypassed validation (e.g. hand-edited prompt files, legacy
      // fixtures). It's idempotent if already normalized.
      for (const frameKey of Object.keys(parsedJson.frames)) {
        const f = parsedJson.frames[frameKey];
        if (f && typeof f === 'object' && typeof f.imagePrompt === 'string' && Array.isArray(f.references)) {
          parsedJson.frames[frameKey] = normalizeShotImagePromptFrame(f);
        }
      }

      // Generate first_frame
      const firstFrameData = parsedJson.frames['first_frame'];
      if (!firstFrameData) {
        this.log(`  No first_frame in frames object`);
        return null;
      }

      let firstFramePath: string | null = null;
      const firstFrameMode = firstFrameData.generationMode || 'image_text_to_image';

      if (firstFrameMode === 'edit_previous_shot') {
        // Cross-shot chaining: edit the previous shot's last frame
        const { getPreviousShotId, getLastFramePath } = await import('./crossShotChaining.js');
        const prevShotItemId = node.itemId ? getPreviousShotId(node.itemId) : null;
        const prevShotNode = prevShotItemId ? this.executor.getNode(`shot_image:${prevShotItemId}`) : null;
        const prevLastFrame = prevShotNode ? getLastFramePath(prevShotNode) : null;

        if (prevLastFrame) {
          const prevLastFrameAbs = join(this.config.projectDir, prevLastFrame);
          this.log(`  Cross-shot chaining: editing previous shot's last frame (${prevLastFrame})`);
          const provider = getProviderRegistry().getImageEditor();
          if (provider?.editImage) {
            const assetsDir = join(this.config.projectDir, 'assets', 'images');
            if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
            // Resolve character/setting refs — layered editing handles >4 refs
            const editRefPaths = this.resolveRefIds(firstFrameData.references ?? []);
            this.log(`  edit_previous_shot: ${editRefPaths.length} refs (layered if >4)`);
            const editFilePath = await this.editImageLayered(
              firstFrameData.imagePrompt,
              prevLastFrameAbs,
              editRefPaths,
              assetsDir,
              `${node.itemId}_first_frame`,
            );
            firstFramePath = relative(this.config.projectDir, editFilePath);
            this.log(`  first_frame (edit_previous_shot): ${firstFramePath}`);
          } else {
            this.log(`  No image editor — falling back to image_text_to_image`);
          }
        } else {
          this.log(`  No previous shot last frame found — falling back to image_text_to_image`);
        }
      }

      // Check if first_frame was already generated in a previous attempt (incremental retry)
      if (!firstFramePath && node.outputPaths?.['first_frame']) {
        const existingFirst = join(this.config.projectDir, node.outputPaths['first_frame']);
        if (existsSync(existingFirst)) {
          firstFramePath = node.outputPaths['first_frame'];
          this.log(`  first_frame already exists (incremental retry): ${firstFramePath}`);
        }
      }

      // Fallback: generate from refs if edit_previous_shot didn't produce a result
      if (!firstFramePath) {
        const firstFrameJson = JSON.stringify({
          imagePrompt: firstFrameData.imagePrompt,
          negativePrompt: parsedJson.negativePrompt || '',
          aspectRatio: parsedJson.aspectRatio || '16:9',
          generationMode: firstFrameMode === 'edit_previous_shot' ? 'image_text_to_image' : firstFrameMode,
          references: firstFrameData.references || [],
        });
        firstFramePath = await this.executeShotImageGeneration(node, firstFrameJson, toolCallId, 'first_frame');
        if (!firstFramePath) return null;
      }

      // Generate additional frames
      const additionalFrames = Object.keys(parsedJson.frames).filter(k => k !== 'first_frame');
      if (additionalFrames.length > 0) {
        node.outputPaths = { ...node.outputPaths, first_frame: firstFramePath };

        const agentName = this.config.name ?? 'kshana-executor';

        for (const frameId of additionalFrames) {
          const frameData = parsedJson.frames[frameId];
          if (!frameData?.imagePrompt) continue;

          // Check if this frame was already generated (incremental retry)
          if (node.outputPaths?.[frameId]) {
            const existingFrame = join(this.config.projectDir, node.outputPaths[frameId]);
            if (existsSync(existingFrame)) {
              this.log(`  ${frameId} already exists (incremental retry): ${node.outputPaths[frameId]}`);
              continue;
            }
          }

          const mode = frameData.generationMode || 'edit_first_frame';
          this.log(`  Generating ${frameId} (mode: ${mode})`);

          // Emit tool_call so the frame shows as its own card in the UI
          const frameCallId = `frame_${node.itemId}_${frameId}_${Date.now()}`;
          const frameToolName = 'generate_frame_image';
          this.emit({
            type: 'tool_call',
            toolCallId: frameCallId,
            toolName: frameToolName,
            arguments: {
              item: `${node.displayName} — ${frameId.replace('_', ' ')}`,
              mode,
              prompt: frameData.imagePrompt.substring(0, 150) + '...',
            },
            agentName,
          });
          this.emit({
            type: 'tool_streaming',
            toolCallId: frameCallId,
            chunk: `Generating ${frameId} (${mode})...`,
            done: false,
            agentName,
            toolName: frameToolName,
          });

          let frameRelPath: string | null = null;

          if (mode === 'edit_first_frame') {
            const firstFrameAbsPath = join(this.config.projectDir, firstFramePath);
            const provider = getProviderRegistry().getImageEditor();
            if (provider?.editImage) {
              const assetsDir = join(this.config.projectDir, 'assets', 'images');
              if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
              // Resolve refs — use first_frame refs if last_frame has none; layered if >4
              const frameRefs = frameData.references?.length > 0
                ? frameData.references
                : (firstFrameData.references ?? []);
              const editRefPaths = this.resolveRefIds(frameRefs);
              this.log(`  ${frameId} (edit_first_frame): ${editRefPaths.length} refs (layered if >4)`);
              const editFilePath = await this.editImageLayered(
                frameData.imagePrompt,
                firstFrameAbsPath,
                editRefPaths,
                assetsDir,
                `${node.itemId}_${frameId}`,
              );
              frameRelPath = relative(this.config.projectDir, editFilePath);
              node.outputPaths[frameId] = frameRelPath;
              this.log(`  ${frameId} (edit_first_frame): ${frameRelPath}`);
            } else {
              this.log(`  No image editor available — falling back to independent generation for ${frameId}`);
              const frameJson = JSON.stringify({
                imagePrompt: frameData.imagePrompt,
                negativePrompt: parsedJson.negativePrompt || '',
                aspectRatio: parsedJson.aspectRatio || '16:9',
                generationMode: 'image_text_to_image',
                references: frameData.references || firstFrameData.references || [],
              });
              const framePath = await this.executeShotImageGeneration(node, frameJson, toolCallId, frameId);
              if (framePath) {
                frameRelPath = framePath;
                node.outputPaths[frameId] = framePath;
                this.log(`  ${frameId} (fallback): ${framePath}`);
              }
            }
          } else {
            const frameJson = JSON.stringify({
              imagePrompt: frameData.imagePrompt,
              negativePrompt: parsedJson.negativePrompt || '',
              aspectRatio: parsedJson.aspectRatio || '16:9',
              generationMode: mode,
              references: frameData.references || [],
            });
            const framePath = await this.executeShotImageGeneration(node, frameJson, toolCallId, frameId);
            if (framePath) {
              frameRelPath = framePath;
              node.outputPaths[frameId] = framePath;
              this.log(`  ${frameId} (${mode}): ${framePath}`);
            }
          }

          // Emit result and register asset
          if (frameRelPath) {
            this.emit({
              type: 'tool_streaming',
              toolCallId: frameCallId,
              chunk: `${frameId} saved: ${frameRelPath}`,
              done: true,
              agentName,
              toolName: frameToolName,
            });
            this.emit({
              type: 'tool_result',
              toolCallId: frameCallId,
              toolName: frameToolName,
              result: { status: 'completed', file_path: frameRelPath, frame: frameId },
              agentName,
            });
            // Register as asset so it shows in sidebar
            try {
              addAsset({
                id: `frame_${node.itemId}_${frameId}_${Date.now()}`,
                type: 'scene_image',
                path: frameRelPath,
                createdAt: Date.now(),
                nodeId: node.id,
              });
            } catch { /* non-fatal */ }
          } else {
            this.emit({
              type: 'tool_result',
              toolCallId: frameCallId,
              toolName: frameToolName,
              result: { status: 'failed', frame: frameId },
              agentName,
            });
          }
        }
        this.log(`  Multi-frame: ${Object.keys(node.outputPaths).length} frames generated`);
      }

      return firstFramePath;
    }

    // Legacy single-prompt format (i2v, t2v, or old-style shots)
    const firstFramePath = await this.executeShotImageGeneration(node, jsonContent, toolCallId, 'first_frame');
    if (!firstFramePath) return null;

    // Check if the video generation mode requires additional frame images
    const strategy = this.getGenerationStrategy(node);
    try {
      const modeRegistry = getWorkflowModeRegistry();
      const mode = modeRegistry.getWorkflowForStrategy(strategy, 'comfyui');
      if (mode) {
        const frameInputs = mode.inputRequirements.filter(
          r => r.type === 'image' && r.source === 'shot_image' && r.id !== 'first_frame'
        );

        if (frameInputs.length > 0) {
          node.outputPaths = { first_frame: firstFramePath };

          for (const frameReq of frameInputs) {
            const frameDesc = this.getFrameDescription(node, frameReq.id);
            if (frameDesc) {
              this.log(`  Generating additional frame (legacy): ${frameReq.id}`);
              const modifiedJson = this.buildFramePromptJson(jsonContent, frameDesc, frameReq.id);
              const framePath = await this.executeShotImageGeneration(node, modifiedJson, toolCallId, frameReq.id);
              if (framePath) {
                node.outputPaths[frameReq.id] = framePath;
                this.log(`  ${frameReq.id} generated: ${framePath}`);
              }
            }
          }
          this.log(`  Multi-frame: ${Object.keys(node.outputPaths).length} frames generated`);
        }
      }
    } catch {
      // Mode registry not available or mode not found — single frame is fine
    }

    return firstFramePath;
  }

  /**
   * Get frame description (firstFrame/lastFrame/midFrame) from scene_video_prompt JSON.
   */
  private getFrameDescription(node: ExecutionNode, frameId: string): string | null {
    const sceneMatch = node.itemId?.match(/scene_(\d+)/);
    const shotMatch = node.itemId?.match(/shot_(\d+)/);
    if (!sceneMatch) return null;
    const sceneNum = parseInt(sceneMatch[1]!, 10);
    const shotNum = shotMatch?.[1] ? parseInt(shotMatch[1], 10) : 1;

    const svpNode = this.executor.getNode(`scene_video_prompt:scene_${sceneNum}`);
    if (!svpNode?.outputPath) return null;

    try {
      const svpPath = join(this.config.projectDir, svpNode.outputPath);
      let content = readFileSync(svpPath, 'utf-8').trim();
      if (content.startsWith('```')) content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      const parsed = JSON.parse(content);
      const shot = parsed.shots?.find((s: { shotNumber: number }) => s.shotNumber === shotNum);
      if (!shot) return null;

      // Map frameId to the SVP field
      const frameMap: Record<string, string> = {
        last_frame: 'lastFrame',
        mid_frame: 'midFrame',
        first_frame: 'firstFrame',
      };
      const fieldName = frameMap[frameId];
      if (!fieldName) return null;

      const frame = shot[fieldName];
      return frame?.description || null;
    } catch {
      return null;
    }
  }

  /**
   * Build a modified shot_image_prompt JSON for a specific frame,
   * replacing the image prompt with the frame's description.
   */
  private buildFramePromptJson(originalJson: string, frameDescription: string, frameId: string): string {
    try {
      let cleaned = originalJson.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const parsed = JSON.parse(cleaned);
      // Replace the image prompt with the frame description
      parsed.imagePrompt = `${frameDescription} — ${frameId.replace('_', ' ')} of the shot`;
      return JSON.stringify(parsed);
    } catch {
      return originalJson;
    }
  }

  /**
   * Generate a shot image from structured JSON prompt.
   * Reads the JSON, resolves refIds to actual image paths, calls ComfyUI with FLUX Klein.
   */
  private async executeShotImageGeneration(
    node: ExecutionNode,
    jsonContent: string,
    toolCallId: string,
    frameId?: string,
  ): Promise<string | null> {
    const agentName = this.config.name ?? 'kshana-executor';

    try {
      // Parse the structured JSON
      let cleaned = jsonContent.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }
      const shotJson = JSON.parse(cleaned) as {
        imagePrompt: string;
        negativePrompt?: string;
        aspectRatio?: string;
        generationMode: string;
        references: Array<{ imageNumber: number; type: string; refId: string }>;
      };

      if (!shotJson.imagePrompt) {
        this.log(`  No imagePrompt in shot JSON`);
        return null;
      }

      // Resolve refIds to actual file paths from the executor graph
      const resolvedRefs = shotJson.references
        .map(ref => {
          const refNode = this.executor.getNode(ref.refId);
          if (!refNode?.outputPath?.endsWith('.png')) {
            this.log(`  Reference ${ref.refId} not resolved (node: ${refNode?.status}, path: ${refNode?.outputPath})`);
            return null;
          }
          return {
            image_id: join(this.config.projectDir, refNode.outputPath),
            type: ref.type as 'character' | 'setting',
            name: ref.refId.split(':')[1] ?? ref.refId,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      this.log(`  Shot image: ${resolvedRefs.length}/${shotJson.references.length} refs resolved`);

      // Auto-repair: scan prompt for "from image N" refs that weren't in the references array
      // and inject them from the scene's character/setting metadata
      const imageRefPattern = /from image (\d+)/gi;
      const promptImageNums = new Set<number>();
      let match: RegExpExecArray | null;
      while ((match = imageRefPattern.exec(shotJson.imagePrompt)) !== null) {
        promptImageNums.add(parseInt(match[1], 10));
      }

      if (promptImageNums.size > resolvedRefs.length) {
        this.log(`  Prompt references ${promptImageNums.size} images but only ${resolvedRefs.length} resolved — auto-injecting missing refs`);

        // Find all available character/setting/object image nodes
        const allRefNodes = this.executor.getAllNodes().filter(
          n => ['character_image', 'setting_image', 'object_image'].includes(n.typeId)
            && n.status === 'completed' && n.outputPath?.endsWith('.png'),
        );

        // Inject any that aren't already in resolvedRefs
        for (const refNode of allRefNodes) {
          const alreadyIncluded = resolvedRefs.some(r => r.name === (refNode.itemId ?? ''));
          if (!alreadyIncluded && resolvedRefs.length < promptImageNums.size) {
            resolvedRefs.push({
              image_id: join(this.config.projectDir, refNode.outputPath ?? ''),
              type: refNode.typeId.replace('_image', '') as 'character' | 'setting',
              name: refNode.itemId ?? refNode.id.split(':')[1] ?? refNode.id,
            });
            this.log(`  Auto-injected ref: ${refNode.id} (${refNode.outputPath})`);
          }
        }
      }

      // Determine generation mode based on resolved references
      const hasRefs = resolvedRefs.length > 0;
      const generationMode = hasRefs ? 'image_text_to_image' : 'text_to_image';

      // Resolve active workflow name for display
      let shotImgWorkflowName = hasRefs ? 'FLUX 2 Klein Edit (built-in)' : 'Z-Image (built-in)';
      try {
        const modeRegistry = getWorkflowModeRegistry();
        const pipeline = hasRefs ? 'image_editing' as const : 'image_generation' as const;
        const mode = modeRegistry.getActiveForPipeline(pipeline, 'comfyui');
        if (mode) shotImgWorkflowName = mode.displayName;
      } catch { /* ignore */ }

      // Emit tool_call for the image generation
      const genCallId = `shotimg_${node.id}_${Date.now()}`;
      const toolName = 'generate_shot_image';
      this.emit({
        type: 'tool_call',
        toolCallId: genCallId,
        toolName,
        arguments: {
          item: node.displayName,
          workflow: shotImgWorkflowName,
          mode: generationMode,
          prompt: shotJson.imagePrompt,
          ...Object.fromEntries(resolvedRefs.map((r, i) => [
            `ref_${i + 1}_${r.type}`,
            r.image_id.replace(this.config.projectDir + '/', ''),
          ])),
        },
        agentName,
      });

      // Subscribe to ComfyUI progress
      let progressHandler: ComfyProgressHandler | null = null;
      progressHandler = (event) => {
        this.emit({
          type: 'tool_streaming',
          toolCallId: genCallId,
          chunk: event.message,
          done: false,
          agentName,
          toolName,
          reset: true,
        });
      };
      comfyProgressBus.onProgress(progressHandler);

      this.emit({
        type: 'tool_streaming',
        toolCallId: genCallId,
        chunk: `Generating shot image (${generationMode})...`,
        done: false,
        agentName,
        toolName,
      });

      const sceneNumber = parseInt(node.itemId?.match(/scene_(\d+)/)?.[1] ?? '1', 10);
      const shotNumber = parseInt(node.itemId?.match(/shot_(\d+)/)?.[1] ?? '0', 10) || undefined;

      // Shot images match the project's video resolution
      const shotWidth = this.config.project.resolutionWidth;
      const shotHeight = this.config.project.resolutionHeight;

      const result = await submitImageGeneration({
        scene_number: sceneNumber,
        shot_number: shotNumber,
        frame_id: frameId,
        prompt: shotJson.imagePrompt,
        negative_prompt: shotJson.negativePrompt,
        aspect_ratio: shotJson.aspectRatio ?? '16:9',
        width: shotWidth,
        height: shotHeight,
        image_type: 'scene',
        generation_mode: generationMode,
        reference_images: hasRefs ? resolvedRefs : undefined,
      });

      if (progressHandler) comfyProgressBus.offProgress(progressHandler!);

      const job = mediaJobs.get(result.jobId);
      let filePath = job?.result?.path;
      const artifactId = job?.result?.artifactId;

      if (result.status === 'completed' && filePath) {
        this.log(`  Shot image generated: ${filePath}`);

        // Image quality gate: validate the generated image
        try {
          const { validateGeneratedImage } = await import('./imageValidator.js');
          const absPath = filePath.startsWith('/') ? filePath : join(this.config.projectDir, filePath);
          const expectedDims = (shotWidth && shotHeight) ? { width: shotWidth, height: shotHeight } : undefined;
          const validation = await validateGeneratedImage(absPath, shotJson.imagePrompt, expectedDims);
          if (!validation.valid) {
            this.log(`  Image validation warning: ${validation.error}`);
            // Log but don't block — basic validation failures are warnings, not hard stops
          } else {
            this.log(`  Image validation passed`);

            // VLM review — send image to vision model for quality check
            // Skipped entirely if VLM was unavailable on first attempt (404)
            const vlmCallId = `vlm_${node.id}_${Date.now()}`;
            const vlmToolName = 'vlm_image_review';
            if (this.vlmDisabled) {
              this.log(`  VLM review skipped (disabled after previous 404)`);
            } else try {
              const { reviewImageWithVLM } = await import('./imageValidator.js');

              this.emit({
                type: 'tool_call',
                toolCallId: vlmCallId,
                toolName: vlmToolName,
                arguments: { image: filePath, prompt: shotJson.imagePrompt.substring(0, 100) + '...' },
                agentName,
              });
              this.emit({
                type: 'tool_streaming',
                toolCallId: vlmCallId,
                chunk: 'Reviewing generated image with vision model...',
                done: false,
                agentName,
                toolName: vlmToolName,
              });

              const vlmResult = await reviewImageWithVLM(absPath, shotJson.imagePrompt, this.llmFor('utility.image_review'));

              // Check if VLM endpoint doesn't exist — disable for rest of session
              if (!vlmResult.pass && vlmResult.issues.some(i => i.includes('404') || i.includes('No endpoints'))) {
                this.vlmDisabled = true;
                this.log(`  VLM disabled for session — endpoint not available`);
                // Skip the retry — image is fine, just no VLM to review it
                this.emit({
                  type: 'tool_streaming',
                  toolCallId: vlmCallId,
                  chunk: 'VLM not available — skipping review for all remaining images',
                  done: true,
                  agentName,
                  toolName: vlmToolName,
                });
                this.emit({
                  type: 'tool_result',
                  toolCallId: vlmCallId,
                  toolName: vlmToolName,
                  result: { status: 'skipped', reason: 'VLM endpoint not available' },
                  agentName,
                });
              } else if (!vlmResult.pass) {
                this.log(`  VLM review FAILED (attempt 1): ${vlmResult.issues.join('; ')}`);
                this.emit({
                  type: 'tool_streaming',
                  toolCallId: vlmCallId,
                  chunk: `REJECTED: ${vlmResult.issues.join('; ')}\nRegenerating image...`,
                  done: false,
                  agentName,
                  toolName: vlmToolName,
                });

                // Retry: regenerate the image once
                const retryResult = await submitImageGeneration({
                  scene_number: sceneNumber,
                  prompt: shotJson.imagePrompt,
                  negative_prompt: shotJson.negativePrompt,
                  aspect_ratio: shotJson.aspectRatio ?? '16:9',
                  width: shotWidth,
                  height: shotHeight,
                  image_type: 'scene',
                  generation_mode: generationMode,
                  reference_images: hasRefs ? resolvedRefs : undefined,
                });

                const retryJob = mediaJobs.get(retryResult.jobId);
                const retryPath = retryJob?.result?.path;

                if (retryResult.status === 'completed' && retryPath) {
                  this.log(`  Retry image generated: ${retryPath}`);
                  const retryAbsPath = retryPath.startsWith('/') ? retryPath : join(this.config.projectDir, retryPath);

                  const retryVlm = await reviewImageWithVLM(retryAbsPath, shotJson.imagePrompt, this.llmFor('utility.image_review'));
                  if (retryVlm.pass) {
                    this.log(`  VLM review passed on retry`);
                    filePath = retryPath;
                    this.emit({
                      type: 'tool_streaming',
                      toolCallId: vlmCallId,
                      chunk: 'Retry image PASSED review',
                      done: true,
                      agentName,
                      toolName: vlmToolName,
                    });
                  } else {
                    this.log(`  VLM review FAILED again: ${retryVlm.issues.join('; ')} — accepting with warning`);
                    this.emit({
                      type: 'tool_streaming',
                      toolCallId: vlmCallId,
                      chunk: `Retry also rejected: ${retryVlm.issues.join('; ')}\nProceeding anyway`,
                      done: true,
                      agentName,
                      toolName: vlmToolName,
                    });
                  }
                } else {
                  this.emit({
                    type: 'tool_streaming',
                    toolCallId: vlmCallId,
                    chunk: 'Retry generation failed — proceeding with original',
                    done: true,
                    agentName,
                    toolName: vlmToolName,
                  });
                }

                this.emit({
                  type: 'tool_result',
                  toolCallId: vlmCallId,
                  toolName: vlmToolName,
                  result: { status: 'rejected_then_retried', issues: vlmResult.issues },
                  agentName,
                });
              } else {
                this.log(`  VLM review passed`);
                this.emit({
                  type: 'tool_streaming',
                  toolCallId: vlmCallId,
                  chunk: 'PASSED — image matches prompt',
                  done: true,
                  agentName,
                  toolName: vlmToolName,
                });
                this.emit({
                  type: 'tool_result',
                  toolCallId: vlmCallId,
                  toolName: vlmToolName,
                  result: { status: 'passed' },
                  agentName,
                });
              }
            } catch (vlmErr) {
              const vlmErrMsg = (vlmErr as Error).message;
              this.log(`  VLM review skipped: ${vlmErrMsg}`);
              // Disable VLM for rest of session if endpoint doesn't exist
              if (vlmErrMsg.includes('404') || vlmErrMsg.includes('No endpoints') || vlmErrMsg.includes('not found')) {
                this.vlmDisabled = true;
                this.log(`  VLM disabled for this session (endpoint not available)`);
              }
              this.emit({
                type: 'tool_result',
                toolCallId: vlmCallId,
                toolName: vlmToolName,
                result: { status: 'skipped', error: (vlmErr as Error).message },
                agentName,
              });
            }
          }
        } catch (valErr) {
          this.log(`  Image validation skipped: ${(valErr as Error).message}`);
        }

        this.emit({
          type: 'tool_streaming',
          toolCallId: genCallId,
          chunk: `Image saved to ${filePath}`,
          done: true,
          agentName,
          toolName,
        });
        this.emit({
          type: 'tool_result',
          toolCallId: genCallId,
          toolName,
          result: { status: 'completed', file_path: filePath, artifact_id: artifactId },
          agentName,
        });
        return filePath;
      } else {
        if (progressHandler) comfyProgressBus.offProgress(progressHandler!);
        this.log(`  Shot image failed: ${result.error ?? job?.error}`);
        this.emit({
          type: 'tool_result',
          toolCallId: genCallId,
          toolName,
          result: { status: 'error', error: result.error ?? job?.error },
          agentName,
          isError: true,
        });
        return null;
      }
    } catch (error) {
      this.log(`  Shot image error: ${String(error)}`);
      return null;
    }
  }

  /**
   * Generate an actual image from a prompt file via the provider.
   */
  private async executeImageGeneration(
    node: ExecutionNode,
    promptFilePath: string,
    toolCallId: string,
    agentName: string,
  ): Promise<string | null> {
    this.log(`  Generating image from prompt: ${promptFilePath}`);

    // Resolve active workflow name for display
    let imgWorkflowName = 'Z-Image (built-in)';
    try {
      const modeRegistry = getWorkflowModeRegistry();
      const mode = modeRegistry.getActiveForPipeline('image_generation', 'comfyui');
      if (mode) imgWorkflowName = mode.displayName;
    } catch { /* ignore */ }

    // Emit a tool_call for the actual image generation
    const genCallId = `img_${node.id}_${Date.now()}`;
    const toolName = `generate_image`;
    this.emit({
      type: 'tool_call',
      toolCallId: genCallId,
      toolName,
      arguments: { item: node.displayName, workflow: imgWorkflowName },
      agentName,
    });

    // Subscribe to ComfyUI progress and forward to tool_streaming
    let progressHandler: ComfyProgressHandler | null = null;

    try {
      // Read and parse the JSON prompt file
      const rawContent = readFileSync(promptFilePath, 'utf-8');
      let cleaned = rawContent.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      }

      let parsed: { imagePrompt?: string; prompt?: string; negativePrompt?: string; aspectRatio?: string; generationMode?: string; references?: Array<{ refId?: string; path?: string; name: string; type: string }> };
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // Fallback: try legacy markdown parsing
        parsed = parsePromptFile(rawContent);
        if (parsed.prompt) {
          parsed.imagePrompt = parsed.prompt;
        }
      }

      const prompt = parsed.imagePrompt ?? parsed.prompt;
      if (!prompt) {
        this.log(`  No prompt found in file`);
        return null;
      }

      // Determine image type from node type
      let imageType: 'character_ref' | 'setting_ref' | 'scene' = 'scene';
      let characterName: string | undefined;
      let settingName: string | undefined;
      const sceneNumber = parseInt(node.itemId?.match(/(\d+)/)?.[1] ?? '1', 10);

      if (node.typeId === 'character_image') {
        imageType = 'character_ref';
        characterName = node.itemId;
      } else if (node.typeId === 'setting_image') {
        imageType = 'setting_ref';
        settingName = node.itemId;
      }
      progressHandler = (event) => {
        // Use reset: true so each progress update REPLACES the previous one
        // Format matches webui.ts progress bar detector: "Step N/M (X%)"
        this.emit({
          type: 'tool_streaming',
          toolCallId: genCallId,
          chunk: event.message,
          done: false,
          agentName,
          toolName,
          reset: true,  // Replace previous content instead of appending
        });
      };
      comfyProgressBus.onProgress(progressHandler);

      // Emit progress start
      this.emit({
        type: 'tool_streaming',
        toolCallId: genCallId,
        chunk: `Generating ${node.displayName}...`,
        done: false,
        agentName,
        toolName,
      });

      // Call the actual image generation (blocks until done)
      // Character/setting images are always text_to_image (no references)
      const result = await submitImageGeneration({
        scene_number: sceneNumber,
        prompt,
        negative_prompt: parsed.negativePrompt,
        aspect_ratio: parsed.aspectRatio ?? '1:1',
        image_type: imageType,
        character_name: characterName,
        setting_name: settingName,
        generation_mode: 'text_to_image',
      });

      // Unsubscribe from progress
      if (progressHandler) comfyProgressBus.offProgress(progressHandler!);

      // Get the result from the job store
      const job = mediaJobs.get(result.jobId);
      const artifactId = job?.result?.artifactId;
      const filePath = job?.result?.path;

      if (result.status === 'completed' && filePath) {
        this.log(`  Image generated: ${filePath} (artifact: ${artifactId})`);
        this.emit({
          type: 'tool_streaming',
          toolCallId: genCallId,
          chunk: `Image saved to ${filePath}`,
          done: true,
          agentName,
          toolName,
        });
        this.emit({
          type: 'tool_result',
          toolCallId: genCallId,
          toolName,
          result: { status: 'completed', file_path: filePath, artifact_id: artifactId },
          agentName,
        });
        return filePath;
      } else {
        const error = result.error ?? job?.error ?? 'Unknown error';
        this.log(`  Image generation failed: ${error}`);
        this.emit({
          type: 'tool_result',
          toolCallId: genCallId,
          toolName,
          result: { status: 'error', error },
          agentName,
          isError: true,
        });
        return null;
      }
    } catch (error) {
      if (progressHandler) comfyProgressBus.offProgress(progressHandler!);
      this.log(`  Image generation error: ${String(error)}`);
      this.emit({
        type: 'tool_result',
        toolCallId: genCallId,
        toolName,
        result: { status: 'error', error: String(error) },
        agentName,
        isError: true,
      });
      return null;
    }
  }

  /**
   * Generate a shot video — purely deterministic, no LLM.
   * Takes: shot image (from shot_image_prompt dep) + motion description (from scene_video_prompt JSON)
   * Calls video provider to generate the clip.
   */
  private async executeShotVideo(
    node: ExecutionNode,
    toolCallId: string,
  ): Promise<string | null> {
    const agentName = this.config.name ?? 'kshana-executor';

    // 1. Find the MATCHING shot image (same itemId)
    let shotImagePath: string | undefined;
    const matchingImageId = `shot_image:${node.itemId}`;
    const matchingImageNode = this.executor.getNode(matchingImageId);
    if (matchingImageNode?.status === 'completed' && matchingImageNode.outputPath) {
      shotImagePath = matchingImageNode.outputPath;
    }
    if (!shotImagePath) {
      // Fallback: find matching by itemId in dependencies
      for (const depId of node.dependencies) {
        const dep = this.executor.getNode(depId);
        if (dep && dep.itemId === node.itemId && dep.outputPath &&
            (dep.outputPath.endsWith('.png') || dep.outputPath.endsWith('.jpg'))) {
          shotImagePath = dep.outputPath;
          break;
        }
      }
    }

    if (!shotImagePath) {
      this.log(`  No shot image found for ${node.id}`);
      return null;
    }

    // 2. Get motion description from scene_video_prompt JSON
    // Extract scene and shot number from itemId: "scene_1_shot_2"
    const sceneMatch = node.itemId?.match(/scene_(\d+)/);
    const shotMatch = node.itemId?.match(/shot_(\d+)/);
    const sceneNum = sceneMatch?.[1] ? parseInt(sceneMatch[1], 10) : 1;
    const shotNum = shotMatch?.[1] ? parseInt(shotMatch[1], 10) : 1;

    const svpNode = this.executor.getNode(`scene_video_prompt:scene_${sceneNum}`);
    let motionPrompt = '';
    let shotDuration = 5;
    let generationStrategy = 'i2v';

    // 1. Try to use shot_motion_directive (preferred — LTX-optimized)
    const motionDirectiveNode = this.executor.getNode(`shot_motion_directive:${node.itemId}`);
    if (motionDirectiveNode?.status === 'completed' && motionDirectiveNode.outputPath) {
      const mdPath = join(this.config.projectDir, motionDirectiveNode.outputPath);
      if (existsSync(mdPath)) {
        let rawContent = readFileSync(mdPath, 'utf-8').trim();
        // Strip markdown code fences if present
        if (rawContent.startsWith('```')) {
          rawContent = rawContent.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        // Parse JSON format ({"motionDirective": "..."}) or fall back to raw text
        try {
          const parsed = JSON.parse(rawContent);
          motionPrompt = parsed.motionDirective || rawContent;
        } catch {
          // Legacy plain-text format — use as-is
          motionPrompt = rawContent;
        }
        this.log(`  Using motion directive: ${motionPrompt.substring(0, 80)}...`);
      }
    }

    // 2. Read shot metadata from scene_video_prompt JSON
    if (svpNode?.outputPath) {
      const svpPath = join(this.config.projectDir, svpNode.outputPath);
      if (existsSync(svpPath)) {
        try {
          let content = readFileSync(svpPath, 'utf-8').trim();
          if (content.startsWith('```')) {
            content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
          }
          const parsed = JSON.parse(content);
          const shot = parsed.shots?.find((s: { shotNumber: number }) => s.shotNumber === shotNum);
          if (shot) {
            shotDuration = shot.duration || 5;
            // Legacy: read strategy from scene_video_prompt if present
            if (shot.videoGenerationMode || shot.generationStrategy) {
              generationStrategy = shot.videoGenerationMode || shot.generationStrategy || 'i2v';
            }

            // Fallback: if no motion directive, use description + cameraWork + audio
            if (!motionPrompt) {
              const { buildFallbackMotionPrompt } = await import('./shotReferenceMapping.js');
              motionPrompt = buildFallbackMotionPrompt(shot);
            }
          }
        } catch {
          this.log(`  Failed to parse scene_video_prompt JSON for motion`);
        }
      }
    }

    // 3. Check shot_image_prompt for generationStrategy (preferred in slim scene breakdown)
    const sipNode = this.executor.getNode(`shot_image_prompt:${node.itemId}`);
    if (sipNode?.outputPath) {
      const sipPath = join(this.config.projectDir, sipNode.outputPath);
      if (existsSync(sipPath)) {
        try {
          let sipContent = readFileSync(sipPath, 'utf-8').trim();
          if (sipContent.startsWith('```')) {
            sipContent = sipContent.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
          }
          const sipParsed = JSON.parse(sipContent);
          if (sipParsed.generationStrategy) {
            generationStrategy = sipParsed.generationStrategy;
          }
        } catch { /* ignore */ }
      }
    }

    if (!motionPrompt) {
      motionPrompt = `Cinematic shot with subtle camera movement, scene ${sceneNum} shot ${shotNum}`;
    }

    // Determine video strategy: v2v_extend for continuation shots, flfv for fresh
    const { getVideoStrategy, getPreviousVideoPath } = await import('./crossShotChaining.js');
    const shotPurpose = (() => {
      try {
        if (!svpNode?.outputPath) return '';
        const svpPath = join(this.config.projectDir, svpNode.outputPath);
        let c = readFileSync(svpPath, 'utf-8').trim();
        if (c.startsWith('```')) c = c.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        const p = JSON.parse(c);
        const s = (p.shots ?? p)?.find?.((s: any) => s.shotNumber === shotNum);
        return s?.purpose || '';
      } catch { return ''; }
    })();

    const v2vEnabled = this.config.project.useV2V !== false; // default: enabled
    const videoStrategy = v2vEnabled
      ? getVideoStrategy(node.itemId ?? '', shotPurpose)
      : 'flfv';
    let previousVideoPath: string | null = null;
    if (videoStrategy === 'v2v_extend') {
      previousVideoPath = getPreviousVideoPath(node.itemId ?? '', this.executor);
      if (previousVideoPath) {
        generationStrategy = 'v2v_extend';
        this.log(`  V2V Extend: will extend ${previousVideoPath}`);
      } else {
        this.log(`  V2V Extend: no previous video found — falling back to flfv`);
        generationStrategy = generationStrategy || 'flfv';
      }
    }
    if (!v2vEnabled) {
      this.log(`  V2V disabled (useV2V=false) — using flfv for all shots`);
    }

    // t2v is no longer a valid strategy — every shot uses a first frame image
    const isT2V = false;
    if (!shotImagePath) {
      this.log(`  No shot image found for ${node.id}`);
      return null;
    }

    // 3. Resolve active workflow name for display — use strategy-aware routing
    let activeWorkflowName = 'LTX-2.3 (built-in)';
    try {
      const modeRegistry = getWorkflowModeRegistry();
      const resolved = modeRegistry.getWorkflowForStrategy(generationStrategy, 'comfyui');
      if (resolved) {
        activeWorkflowName = resolved.displayName;
      }
    } catch { /* ignore */ }

    // 4. Emit tool_call
    const genCallId = `shotvid_${node.id}_${Date.now()}`;
    const toolName = 'generate_shot_video';
    this.emit({
      type: 'tool_call',
      toolCallId: genCallId,
      toolName,
      arguments: { item: node.displayName, workflow: activeWorkflowName, source_image: isT2V ? '(text-to-video)' : shotImagePath, duration: shotDuration, prompt: motionPrompt },
      agentName,
    });

    // 5. Subscribe to progress
    let progressHandler: ComfyProgressHandler | null = null;
    progressHandler = (event) => {
      this.emit({
        type: 'tool_streaming',
        toolCallId: genCallId,
        chunk: event.message,
        done: false,
        agentName,
        toolName,
        reset: true,
      });
    };
    comfyProgressBus.onProgress(progressHandler);

    this.emit({
      type: 'tool_streaming',
      toolCallId: genCallId,
      chunk: `Generating shot video (${shotDuration}s)...`,
      done: false,
      agentName,
      toolName,
    });

    try {
      // 5. Call video provider
      const provider = getProviderRegistry().getVideoGenerator();
      if (!provider?.generateVideo) {
        this.log(`  No video generation provider available`);
        if (progressHandler) comfyProgressBus.offProgress(progressHandler!);
        return null;
      }

      const assetsDir = join(this.config.projectDir, 'assets', 'videos', 'shots');
      if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

      // Video resolution from project settings (defaults to 480p)
      const videoWidth = this.config.project.resolutionWidth ?? 848;
      const videoHeight = this.config.project.resolutionHeight ?? 480;

      // Collect additional frame images from the shot_image node's outputPaths
      const frameImages: Record<string, string> = {};
      if (matchingImageNode?.outputPaths) {
        for (const [frameId, framePath] of Object.entries(matchingImageNode.outputPaths)) {
          if (frameId !== 'first_frame') {
            frameImages[frameId] = join(this.config.projectDir, framePath);
          }
        }
      }

      const result = await provider.generateVideo(
        {
          sourceImagePath: isT2V ? '' : join(this.config.projectDir, shotImagePath),
          sourceVideoPath: previousVideoPath ? join(this.config.projectDir, previousVideoPath) : undefined,
          prompt: motionPrompt,
          durationSeconds: shotDuration,
          width: videoWidth,
          height: videoHeight,
          outputDir: assetsDir,
          filenamePrefix: `scene_${sceneNum}_shot_${shotNum}`,
          modeId: generationStrategy,
          frameImages: Object.keys(frameImages).length > 0 ? frameImages : undefined,
        },
        (info) => {
          this.emit({
            type: 'tool_streaming',
            toolCallId: genCallId,
            chunk: info.message,
            done: false,
            agentName,
            toolName,
            reset: true,
          });
        },
      );

      if (progressHandler) comfyProgressBus.offProgress(progressHandler!);

      const relPath = relative(this.config.projectDir, result.filePath);
      const workflowUsed = (result.metadata as Record<string, unknown>)?.['workflowName'] as string | undefined;
      this.log(`  Shot video generated: ${relPath} (${shotDuration}s) [workflow: ${workflowUsed ?? 'unknown'}]`);

      try {
        addAsset({
          id: `shotvid_${Date.now()}`,
          type: 'scene_video',
          path: relPath,
          createdAt: Date.now(),
          metadata: { sceneNumber: sceneNum, shotNumber: shotNum, duration: shotDuration, generationStrategy },
          nodeId: node.id,
        });
      } catch { /* non-fatal */ }

      this.emit({
        type: 'tool_streaming',
        toolCallId: genCallId,
        chunk: `Video saved to ${relPath}`,
        done: true,
        agentName,
        toolName,
      });
      this.emit({
        type: 'tool_result',
        toolCallId: genCallId,
        toolName,
        result: { status: 'completed', file_path: relPath },
        agentName,
      });
      return relPath;
    } catch (error) {
      if (progressHandler) comfyProgressBus.offProgress(progressHandler!);
      this.log(`  Shot video error: ${String(error)}`);
      this.emit({
        type: 'tool_result',
        toolCallId: genCallId,
        toolName,
        result: { status: 'error', error: String(error) },
        agentName,
        isError: true,
      });
      return null;
    }
  }

  /**
   * Generate an actual video from a motion prompt file + scene image.
   */
  private async executeVideoGeneration(
    node: ExecutionNode,
    promptFilePath: string,
    toolCallId: string,
    agentName: string,
  ): Promise<string | null> {
    this.log(`  Generating video from prompt: ${promptFilePath}`);

    const genCallId = `vid_${node.id}_${Date.now()}`;
    const toolName = `generate_video`;
    this.emit({
      type: 'tool_call',
      toolCallId: genCallId,
      toolName,
      arguments: { item: node.displayName },
      agentName,
    });

    try {
      // Find the source image from completed dependencies
      // For shot_video: the source image comes from shot_image_prompt (which generates the shot image)
      // For legacy scene_video: would come from scene_image
      let sourceImagePath: string | undefined;
      for (const depId of node.dependencies) {
        const dep = this.executor.getNode(depId);
        if (dep?.outputPath?.endsWith('.png') || dep?.outputPath?.endsWith('.jpg')) {
          sourceImagePath = dep.outputPath;
          break;
        }
      }

      if (!sourceImagePath) {
        this.log(`  No source image found in dependencies for video gen`);
        this.log(`  Dependencies: ${node.dependencies.join(', ')}`);
        for (const depId of node.dependencies) {
          const dep = this.executor.getNode(depId);
          this.log(`    ${depId}: status=${dep?.status}, outputPath=${dep?.outputPath}`);
        }
        return null;
      }

      // Read motion prompt
      const motionContent = readFileSync(promptFilePath, 'utf-8');
      const sceneNumber = parseInt(node.itemId?.match(/(\d+)/)?.[1] ?? '1', 10);
      const shotNumber = parseInt(node.itemId?.match(/shot_(\d+)/)?.[1] ?? '1', 10);

      this.emit({
        type: 'tool_streaming',
        toolCallId: genCallId,
        chunk: `Generating video for ${node.displayName}...\n`,
        done: false,
        agentName,
        toolName,
      });

      // Call video generation via provider
      const provider = getProviderRegistry().getVideoGenerator();
      if (!provider?.generateVideo) {
        this.log(`  No video generation provider available`);
        return null;
      }

      const assetsDir = join(this.config.projectDir, 'assets', 'videos');
      if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

      const result = await provider.generateVideo(
        {
          sourceImagePath: join(this.config.projectDir, sourceImagePath),
          prompt: motionContent,
          outputDir: assetsDir,
          filenamePrefix: `scene_${sceneNumber}_shot_${shotNumber}`,
        },
        (info) => {
          this.emit({
            type: 'tool_streaming',
            toolCallId: genCallId,
            chunk: `Step ${info.step ?? 0}/${info.maxSteps ?? 0} (${info.percentage}%)`,
            done: info.done,
            agentName,
            toolName,
          });
        },
      );

      const relPath = relative(this.config.projectDir, result.filePath);
      this.log(`  Video generated: ${relPath}`);

      // Register asset
      const artifactId = `vid_${Date.now()}`;
      try {
        addAsset({
          id: artifactId,
          type: 'scene_video',
          path: relPath,
          createdAt: Date.now(),
          nodeId: node.id,
        });
      } catch { /* non-fatal */ }

      this.emit({
        type: 'tool_result',
        toolCallId: genCallId,
        toolName,
        result: { status: 'completed', file_path: relPath },
        agentName,
      });
      return relPath;
    } catch (error) {
      this.log(`  Video generation error: ${String(error)}`);
      this.emit({
        type: 'tool_result',
        toolCallId: genCallId,
        toolName,
        result: { status: 'error', error: String(error) },
        agentName,
        isError: true,
      });
      return null;
    }
  }

  /**
   * Execute final video assembly from timeline. Purely deterministic — no LLM.
   * Creates timeline skeleton if needed, validates, and runs FFmpeg.
   */
  private async executeFinalAssembly(
    node: ExecutionNode,
    toolCallId: string,
  ): Promise<string | null> {
    const agentName = this.config.name ?? 'kshana-executor';
    const projectDir = this.config.projectDir;

    this.log(`  Starting final assembly`);
    this.emit({
      type: 'tool_call',
      toolCallId,
      toolName: 'assemble_final_video',
      arguments: { item: node.displayName },
      agentName,
    });
    this.emit({
      type: 'tool_streaming',
      toolCallId,
      chunk: 'Assembling final video from timeline...\n',
      done: false,
      agentName,
      toolName: 'assemble_final_video',
    });

    try {
      let resolvedSegments: import('../timeline/FFmpegAssembler.js').ResolvedSegment[];

      // Use timeline if available — it has proper durations, transitions, and segment data
      if (this.timeline) {
        const validation = validateTimeline(this.timeline);
        this.log(`  Timeline: ${validation.filledDuration}/${this.timeline.totalDuration}s filled, ${validation.warnings.length} warnings`);

        const { resolved, errors } = resolveSegmentFilePaths(this.timeline, projectDir);
        if (errors.length > 0) {
          this.log(`  Timeline resolution errors: ${errors.join('; ')}`);
        }
        if (resolved.length === 0) {
          this.log(`  No resolved segments from timeline — cannot assemble`);
          return null;
        }
        resolvedSegments = resolved;

        this.emit({
          type: 'tool_streaming',
          toolCallId,
          chunk: `Timeline: ${resolved.length} segments resolved (${Math.round(validation.filledDuration)}s filled)\n`,
          done: false,
          agentName,
          toolName: 'assemble_final_video',
        });
      } else {
        // Fallback: build from shot_video nodes directly (no timeline.json)
        const shotVideoNodes = this.executor.getAllNodes()
          .filter(n => n.typeId === 'shot_video' && n.status === 'completed' && n.outputPath)
          .sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''));

        if (shotVideoNodes.length === 0) {
          this.log(`  No completed shot videos found — cannot assemble`);
          return null;
        }

        let currentTime = 0;
        resolvedSegments = shotVideoNodes.map(vn => {
          const filePath = join(projectDir, vn.outputPath!);
          const sceneMatch = vn.itemId?.match(/scene_(\d+)/);
          const shotMatch = vn.itemId?.match(/shot_(\d+)/);
          const sceneNum = sceneMatch?.[1] ? parseInt(sceneMatch[1], 10) : 1;
          const shotNum = shotMatch?.[1] ? parseInt(shotMatch[1], 10) : 1;

          let duration = 5;
          let transition: string | undefined;
          let transitionDuration: number | undefined;
          const svpNode = this.executor.getNode(`scene_video_prompt:scene_${sceneNum}`);
          if (svpNode?.outputPath) {
            try {
              const svpPath = join(projectDir, svpNode.outputPath);
              if (existsSync(svpPath)) {
                let content = readFileSync(svpPath, 'utf-8').trim();
                if (content.startsWith('```')) content = content.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
                const parsed = JSON.parse(content);
                const shot = parsed.shots?.find((s: { shotNumber: number }) => s.shotNumber === shotNum);
                if (shot?.duration) duration = shot.duration;
                if (shot?.transition) {
                  transition = shot.transition;
                  transitionDuration = transition === 'cut' ? undefined
                    : transition === 'flash_to_white' ? 0.2
                    : transition === 'dip_to_black' ? 0.8
                    : 0.5;
                }
              }
            } catch { /* use default */ }
          }

          const segment = {
            segmentId: vn.id,
            label: vn.displayName,
            startTime: currentTime,
            endTime: currentTime + duration,
            duration,
            filePath,
            mediaType: 'video' as const,
            transition,
            transitionDuration,
          };
          currentTime += duration;
          return segment;
        });

        this.emit({
          type: 'tool_streaming',
          toolCallId,
          chunk: `Fallback mode: ${resolvedSegments.length} shot videos found\n`,
          done: false,
          agentName,
          toolName: 'assemble_final_video',
        });
      }

      // Filter out shots subsumed by v2v_extend successors.
      // A v2v_extend video already contains the previous shot's frames — including both
      // in the assembly would duplicate content.
      // Only uses explicit generationStrategy from manifest metadata — never guesses.
      {
        const { filterSubsumedShots } = await import('./crossShotChaining.js');
        const manifestPath = join(projectDir, 'assets', 'manifest.json');
        let manifest: Array<{ path: string; metadata?: Record<string, unknown> }> = [];
        try {
          if (existsSync(manifestPath)) {
            manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')).assets ?? [];
          }
        } catch { /* no manifest */ }

        // Build path→strategy lookup from manifest metadata (only explicit, never inferred)
        const strategyByPath = new Map<string, string>();
        for (const asset of manifest) {
          const strategy = asset.metadata?.['generationStrategy'] as string | undefined;
          if (strategy && asset.path) {
            strategyByPath.set(join(projectDir, asset.path), strategy);
          }
        }

        const enriched = resolvedSegments.map(s => ({
          ...s,
          strategy: strategyByPath.get(s.filePath),
        }));

        const filtered = filterSubsumedShots(enriched);
        const removedCount = resolvedSegments.length - filtered.length;
        if (removedCount > 0) {
          this.log(`  V2V dedup: removed ${removedCount} shot(s) subsumed by v2v_extend successors`);
          this.emit({
            type: 'tool_streaming',
            toolCallId,
            chunk: `V2V dedup: ${removedCount} shot(s) subsumed by v2v_extend — skipped to avoid duplicate frames\n`,
            done: false,
            agentName,
            toolName: 'assemble_final_video',
          });
        }
        resolvedSegments = filtered;
      }

      // Log transition data for debugging
      const transitionSummary = resolvedSegments
        .filter(s => s.transition && s.transition !== 'cut')
        .map(s => `${s.segmentId}:${s.transition}(${s.transitionDuration}s)`);
      this.log(`  Transitions: ${transitionSummary.length > 0 ? transitionSummary.join(', ') : 'none (all cuts)'}`);
      const totalDuration = resolvedSegments.reduce((sum, s) => sum + s.duration, 0);

      this.emit({
        type: 'tool_streaming',
        toolCallId,
        chunk: `Total duration: ${Math.round(totalDuration)}s from ${resolvedSegments.length} shots (${transitionSummary.length} transitions)\n`,
        done: false,
        agentName,
        toolName: 'assemble_final_video',
      });

      // Run FFmpeg assembly
      const outputDir = join(projectDir, 'assets', 'videos', 'final');
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
      // Don't overwrite existing final videos — find next available version
      let outputPath = join(outputDir, 'final_video.mp4');
      if (existsSync(outputPath)) {
        let version = 2;
        while (existsSync(join(outputDir, `final_video${version}.mp4`))) {
          version++;
        }
        outputPath = join(outputDir, `final_video${version}.mp4`);
        this.log(`  Previous final video exists — writing to final_video${version}.mp4`);
      }

      this.emit({
        type: 'tool_streaming',
        toolCallId,
        chunk: `Running FFmpeg assembly...\n`,
        done: false,
        agentName,
        toolName: 'assemble_final_video',
      });

      const result = await assembleVideos(resolvedSegments, outputPath);

      if (result.success) {
        const relPath = relative(projectDir, result.outputPath);
        this.log(`  Final video assembled: ${relPath} (${result.duration}s, ${result.fileSize} bytes)`);

        // Register asset
        try {
          addAsset({
            id: `final-video-${Date.now()}`,
            type: 'final_video',
            path: relPath,
            createdAt: Date.now(),
            metadata: { duration: result.duration, fileSize: result.fileSize },
            nodeId: node.id,
          });
        } catch { /* non-fatal */ }

        this.emit({
          type: 'tool_streaming',
          toolCallId,
          chunk: `Final video: ${relPath} (${Math.round(result.duration)}s)`,
          done: true,
          agentName,
          toolName: 'assemble_final_video',
        });

        // Emit tool_result so the UI can render the video in the timeline
        this.emit({
          type: 'tool_result',
          toolCallId,
          toolName: 'assemble_final_video',
          result: { status: 'completed', file_path: relPath, duration: result.duration, fileSize: result.fileSize },
          agentName,
        });

        return relPath;
      } else {
        this.log(`  Assembly failed`);
        return null;
      }
    } catch (error) {
      this.log(`  Assembly error: ${String(error)}`);
      this.emit({
        type: 'tool_result',
        toolCallId,
        toolName: 'assemble_final_video',
        result: { status: 'error', error: String(error) },
        agentName,
        isError: true,
      });
      return null;
    }
  }

  private persistState(): void {
    try {
      this.config.project.executorState = this.executor.getState();
      this.config.project.updatedAt = Date.now();
      const dir = this.config.projectDir;
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const filePath = join(dir, 'project.json');
      writeFileSync(filePath, JSON.stringify(this.config.project, null, 2), 'utf-8');
    } catch (error) {
      // Non-fatal — execution can continue without persistence
      this.emit({
        type: 'notification',
        level: 'warning',
        message: `Failed to persist state: ${String(error)}`,
      });
    }
  }
}

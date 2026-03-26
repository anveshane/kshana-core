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

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { TypedEventEmitter } from '../../events/EventEmitter.js';
import { LLMClient } from '../llm/index.js';
import type { Message, GenerateOptions } from '../llm/types.js';
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
import { resolveInputs, writeOutput, getOutputPath as getOutputPathFn } from './contentResolver.js';
import { extractCollectionItems } from './collectionExtractor.js';
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
  validateTimeline,
} from '../timeline/TimelineManager.js';
import { assembleVideos, resolveSegmentFilePaths } from '../timeline/FFmpegAssembler.js';
import { getProviderRegistry } from '../../services/providers/index.js';
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
Output ONLY the content — no explanations, no tool calls, no meta-commentary.`,

  structure: `You are a creative writer. Generate a detailed narrative or structural document.
Write rich, engaging prose with dialogue, description, and pacing.
Output ONLY the content — no explanations, no tool calls, no meta-commentary.`,

  entity: `You are a creative writer specializing in character and entity profiles.
Create a detailed profile including physical description, personality, motivations, and background.
Output ONLY the profile content — no explanations, no tool calls, no meta-commentary.`,

  environment: `You are a creative writer specializing in setting and environment descriptions.
Create a vivid, detailed description of the location including atmosphere, key features, and sensory details.
Output ONLY the description — no explanations, no tool calls, no meta-commentary.`,

  segment: `You are a creative writer specializing in scene descriptions.
Create a detailed scene description including action, dialogue, character positions, and visual details.
Output ONLY the scene content — no explanations, no tool calls, no meta-commentary.`,

  visual_ref: `You are an expert image prompt engineer. Do NOT think or reason — respond directly.
Output ONLY valid JSON — no markdown, no explanation, no thinking.

The JSON must follow this exact structure:
{
  "imagePrompt": "<detailed image generation prompt — flowing prose, 80-250 words>",
  "negativePrompt": "<things to avoid>",
  "aspectRatio": "<ratio like 16:9, 1:1, etc.>"
}

Rules:
- imagePrompt: descriptive flowing prose, NOT keywords. Include subject, composition, lighting, style.
- No generationMode or references fields — this is always text-to-image.`,

  clip: `You are a video direction expert. Do NOT think or reason — respond directly with the prompt.
Generate a detailed motion/animation prompt describing camera movement, character actions, and timing.
Output ONLY the motion prompt. No thinking, no explanations, no preamble.`,

  final: `You are a video assembly specialist.
Generate assembly instructions for combining video clips into a final video.
Output ONLY the assembly instructions — no explanations, no tool calls, no meta-commentary.`,
};

/**
 * ExecutorAgent — drives the dependency graph deterministically.
 *
 * Extends TypedEventEmitter so ConversationManager can listen to events
 * using the same pattern as GenericAgent.
 */
export class ExecutorAgent extends TypedEventEmitter {
  private llm: LLMClient;
  private executor: DependencyGraphExecutor;
  private config: ExecutorAgentConfig;
  private running = false;
  private stopped = false;
  private _initialized = false;
  private logPath: string;
  private currentPhase = '';
  private retriedNodes = new Set<string>();
  /** Pending media generation promises (parallel mode) */
  private pendingMedia = new Map<string, Promise<string | null>>();

  constructor(llm: LLMClient, config: ExecutorAgentConfig) {
    super();
    this.llm = llm;
    this.config = config;

    // Set up log file — try project dir first, fall back to cwd
    const projectLogsDir = join(config.projectDir, 'logs');
    const cwdLogsDir = join(process.cwd(), 'logs');
    const logsDir = existsSync(config.projectDir) ? projectLogsDir : cwdLogsDir;
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
    this.logPath = join(logsDir, 'executor.log');
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
    } else {
      const scanner = new AssetScanner(config.template);
      const scanResult = scanner.scan(config.projectDir, config.project);
      const planner = new BackwardPlanner(config.template);
      const plan = planner.buildPlan(config.goal, scanResult.registry);
      this.executor = DependencyGraphExecutor.fromPlan(plan, config.template);
    }
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
      character_image: 'Character Reference Images',
      setting_image: 'Setting Reference Images',
      scene_video_prompt: 'Shot Planning',
      shot_image_prompt: 'Shot Image Prompts',
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

    // Sort by: graph creation order (topological), then by typeId to group items
    const creationOrder = this.executor.getGraph().getCreationOrder();
    const typeOrder = new Map<string, number>();
    creationOrder.forEach((typeId, idx) => typeOrder.set(typeId, idx));

    const sorted = [...nodes].sort((a, b) => {
      const aOrder = typeOrder.get(a.typeId) ?? 999;
      const bOrder = typeOrder.get(b.typeId) ?? 999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Within same type, sort by itemId
      return (a.itemId ?? '').localeCompare(b.itemId ?? '');
    });

    const todos: ExpandableTodoItem[] = sorted.map(node => {
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

    this.emit({ type: 'todo_update', todos });
  }

  /**
   * Initialize the agent (matches GenericAgent interface).
   */
  async initialize(): Promise<void> {
    this._initialized = true;
  }

  /**
   * Stop the agent mid-execution.
   */
  stop(): void {
    this.stopped = true;
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
   * Run the dependency graph execution loop.
   *
   * This is the main entry point, matching GenericAgent.run() signature.
   * The `task` parameter is used for initial goal understanding only;
   * actual execution is driven by the graph.
   */
  async run(_task: string, _userResponse?: string): Promise<GenericAgentResult> {
    if (this.running) {
      this.log('run() called while already running — ignoring');
      return { status: 'completed', output: 'Already running', todos: [] };
    }
    this.running = true;
    this.stopped = false;

    const agentName = this.config.name ?? 'kshana-executor';

    this.log('=== Execution started ===');
    this.log(`Nodes: ${this.executor.getAllNodes().map(n => n.id).join(', ')}`);

    try {
      this.emit({ type: 'agent_status', status: 'thinking', agentName });

      // Expand any collection nodes whose dependencies are already completed
      // (handles session resume where scene_video_prompt completed in a prior run
      // but shot_image_prompt wasn't expanded into per-shot nodes)
      await this.expandPendingCollections();

      this.emitTodoUpdate();

      // Main execution loop
      let selfRepairCount = 0;
      const MAX_SELF_REPAIRS = 3;

      while (!this.executor.isComplete() && !this.stopped) {
        const readyNodes = this.executor.getNextReady();

        if (readyNodes.length === 0) {
          // In parallel mode, if we have pending media, await them and retry
          if (this.pendingMedia.size > 0) {
            this.log(`Awaiting ${this.pendingMedia.size} pending media generation(s)...`);
            await Promise.all(this.pendingMedia.values());
            this.pendingMedia.clear();
            continue;  // Re-check for ready nodes
          }

          // Limit self-repair attempts to prevent infinite loops
          if (selfRepairCount >= MAX_SELF_REPAIRS) {
            this.log(`STUCK: Max self-repair attempts (${MAX_SELF_REPAIRS}) reached. Stopping.`);
            break;
          }

          selfRepairCount++;
          this.log(`No ready nodes — attempting self-repair (${selfRepairCount}/${MAX_SELF_REPAIRS})...`);
          this.repairMissingNodes();
          await this.expandPendingCollections();

          // Also reset any failed nodes to give them another chance
          const failedNodes = this.executor.getAllNodes().filter(n => n.status === 'failed');
          for (const fn of failedNodes) {
            this.executor.invalidateNode(fn.id);
          }

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

        this.log(`Ready nodes: ${readyNodes.map(n => n.id).join(', ')}`);

        for (const node of readyNodes) {
          if (this.stopped) break;

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
                continue;
              }
              finalOutputPath = assemblyResult;
            } else if (nodeCategory === 'final' && this.config.skipMediaGeneration) {
              // Test mode: skip final assembly — mark completed so pipeline finishes
              this.log(`  Skipping final assembly (skipMediaGeneration=true)`);
              this.executor.markCompleted(node.id, 'skipped-test-mode');
              this.persistState();
              this.emitTodoUpdate();
              continue;
            } else if (node.typeId === 'shot_video' && !this.config.skipMediaGeneration) {
              // Shot video — purely deterministic: take shot image + motion → video provider
              const videoResult = await this.executeShotVideo(node, toolCallId);
              if (!videoResult) {
                this.executor.markFailed(node.id, 'Shot video generation failed');
                continue;
              }
              finalOutputPath = videoResult;
            } else if (node.typeId === 'shot_video' && this.config.skipMediaGeneration) {
              // Test mode: skip shot video — mark completed so downstream nodes aren't blocked
              this.log(`  Skipping shot_video (skipMediaGeneration=true)`);
              this.executor.markCompleted(node.id, 'skipped-test-mode');
              this.persistState();
              this.emitTodoUpdate();
              continue;
            } else {
              // Non-deterministic node — needs LLM (or skip-if-exists)
              // 1. Resolve inputs
              const inputs = resolveInputs(node, this.executor, this.config.projectDir);
              this.log(`  Inputs resolved: ${inputs.filesRead.length} files read: ${inputs.filesRead.join(', ') || '(none)'}`);
              this.log(`  Reference images: ${inputs.referenceImages.length}`);
              this.log(`  Context block length: ${inputs.contextBlock.length} chars`);

              // 2. Build prompt
              const { system, user, loadedSkills } = this.buildPromptForNode(node, inputs);
              this.log(`  Prompt built: system=${system.length} chars, user=${user.length} chars`);

              // 3. Emit tool_call
              const toolName = this.getToolDisplayName(node);
              const toolArgs = this.getToolDisplayArgs(node, inputs);
              if (loadedSkills.length > 0) {
                toolArgs['skills'] = loadedSkills.join(', ');
              }
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
                  continue;
                }
              }

              // Check if prompt/output file already exists on disk (from a previous run)
              const isMediaNode = nodeCategory === 'visual_ref' || nodeCategory === 'clip';
              const needsImageGen = node.typeId === 'shot_image_prompt';
              if (isMediaNode || needsImageGen) {
                const existingPromptPath = this.findExistingPromptFile(node);
                if (existingPromptPath) {
                  this.log(`  Prompt file already exists: ${existingPromptPath} — skipping LLM`);

                  if (needsImageGen) {
                    // Shot image prompt: skip LLM, generate shot image from JSON
                    this.emit({
                      type: 'notification',
                      level: 'info',
                      message: `Skipping LLM for ${node.displayName} — prompt exists, generating shot image`,
                    });
                    const jsonContent = readFileSync(join(this.config.projectDir, existingPromptPath), 'utf-8');
                    const shotImagePath = await this.executeShotImageGeneration(node, jsonContent, toolCallId);
                    if (shotImagePath) {
                      finalOutputPath = shotImagePath;
                    } else {
                      this.executor.markFailed(node.id, 'Shot image generation failed (prompt saved, will retry)');
                      this.emitTodoUpdate();
                      continue;
                    }
                  } else if (isMediaNode) {
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
                      continue;
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
                    this.stopped = true;
                  }
                  continue;
                }
              }

              // Generate content via LLM (pure completion, no tools)
              this.log(`  Calling LLM...`);
              let content = await this.generateForNode(node, system, user, toolCallId, toolName);
              this.log(`  LLM returned ${content.length} chars`);

              // Validate JSON output for nodes that require it
              const jsonValidatedTypes = ['scene_video_prompt', 'shot_image_prompt', 'character_image', 'setting_image'];
              if (jsonValidatedTypes.includes(node.typeId)) {
                const validation = this.validateJsonOutput(content, node);
                if (!validation.valid) {
                  this.log(`  JSON validation failed: ${validation.error} — retrying...`);
                  this.emit({
                    type: 'notification',
                    level: 'warning',
                    message: `Invalid JSON from LLM for ${node.displayName} — retrying`,
                  });
                  // Retry once with correction prompt
                  const retryContent = await this.generateForNode(
                    node,
                    system + '\n\nCRITICAL: Your output MUST be valid JSON. Do not include markdown, backticks, or any text outside the JSON object.',
                    user,
                    toolCallId,
                    toolName,
                  );
                  const retryValidation = this.validateJsonOutput(retryContent, node);
                  if (retryValidation.valid) {
                    content = retryContent;
                    this.log(`  Retry succeeded — valid JSON`);
                  } else {
                    this.log(`  Retry also failed: ${retryValidation.error}`);
                    this.executor.markFailed(node.id, `Invalid JSON output after retry: ${retryValidation.error}`);
                    this.emitTodoUpdate();
                    continue;
                  }
                }
              }

              // Write prompt/content to disk
              let outputPath = writeOutput(
                node, content, this.config.projectDir, this.config.template,
              );
              this.log(`  Written to: ${outputPath}`);

              // Emit tool_result for the prompt generation
              this.emit({
                type: 'tool_result',
                toolCallId,
                toolName,
                result: { status: 'completed', file: outputPath },
                agentName,
              });

              // For shot_image_prompt: generate the actual shot image from the structured JSON
              if (node.typeId === 'shot_image_prompt' && !this.config.skipMediaGeneration) {
                const shotImagePath = await this.executeShotImageGeneration(node, content, toolCallId);
                if (shotImagePath) {
                  outputPath = shotImagePath;
                } else {
                  // Image gen failed but prompt is saved — mark failed for retry
                  this.executor.markFailed(node.id, 'Shot image generation failed (prompt saved, will retry)');
                  this.emitTodoUpdate();
                  this.log(`  Shot image gen failed for ${node.id}`);
                  continue;
                }
              }

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
                  // Skip the markCompleted below by continuing
                  this.log(`  [parallel] Media generation queued for ${node.id}`);
                  continue; // Skip markCompleted — parallel handler owns the node status
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
                    continue;
                  }
                }
              }

              finalOutputPath = outputPath;
            }

            // 5. Emit human-readable summary
            this.emit({
              type: 'agent_text',
              text: `**${node.displayName}** generated → \`${finalOutputPath}\``,
              isFinal: false,
            });

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

            // Reset self-repair counter on successful completion
            selfRepairCount = 0;

            // Check if we should stop after this node type (test mode)
            if (this.config.stopAfterNodeType && node.typeId === this.config.stopAfterNodeType) {
              this.log(`  stopAfterNodeType matched: ${node.typeId} — stopping`);
              this.stopped = true;
            }

          } catch (error) {
            const errMsg = String(error);
            const isTransient = /premature close|timed? ?out|ECONNRESET|ECONNREFUSED|socket hang up|network|connection error/i.test(errMsg);

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
  private buildPromptForNode(
    node: ExecutionNode,
    inputs: ResolvedInputs,
  ): { system: string; user: string; loadedSkills: string[] } {
    const typeDef = this.config.template.artifactTypes[node.typeId];
    const category = typeDef?.category ?? 'concept';

    // Special handling for specific node types that need different prompts than their category
    // - shot_image_prompt: uses visual_ref treatment (FLUX Klein edit prompt)
    // - scene_video_prompt: uses structured JSON output for deterministic parsing
    const effectiveCategory = node.typeId === 'shot_image_prompt' ? 'visual_ref' : category;

    let systemPrompt: string;
    if (node.typeId === 'scene_video_prompt') {
      systemPrompt = `You are a cinematic shot planner. Break a scene into individual shots.
Output ONLY valid JSON — no markdown, no explanation, no thinking. Respond with the JSON object directly.

The JSON must follow this exact structure:
{
  "sceneNumber": <number>,
  "sceneTitle": "<title>",
  "totalDuration": <seconds>,
  "shots": [
    {
      "shotNumber": <number>,
      "shotType": "<establishing|wide|medium|close_up|extreme_close_up|over_shoulder|pov|tracking|reaction>",
      "duration": <seconds>,
      "description": "<what is visible in this shot — action, composition, atmosphere>",
      "cameraWork": "<camera movement and angle>",
      "characters": ["<character_item_id>", ...],
      "setting": "<setting_item_id or null>"
    }
  ]
}

Rules:
- Shot durations must sum to totalDuration
- Each shot should be 3-10 seconds
- characters array uses the item IDs (e.g., "elara_vance", "mr_halloway") — only characters present in this shot
- setting uses the item ID of the location (e.g., "the_dregs") or null if no specific setting
- description should be specific and visual — what a camera sees in this frozen/moving moment
- Vary shot types for cinematic interest (don't repeat the same type)`;
    } else if (node.typeId === 'shot_image_prompt') {
      systemPrompt = `You are an expert image prompt engineer for FLUX Klein image editing.
Output ONLY valid JSON — no markdown, no explanation, no thinking. Respond with the JSON object directly.

The JSON must follow this exact structure:
{
  "imagePrompt": "<flowing prose describing the composition — reference characters/settings as 'from image N'>",
  "negativePrompt": "<what to avoid>",
  "aspectRatio": "16:9",
  "generationMode": "image_text_to_image" or "text_to_image",
  "references": [
    { "imageNumber": 1, "type": "character", "refId": "<the ref_id from the available references>" },
    { "imageNumber": 2, "type": "setting", "refId": "<the ref_id from the available references>" }
  ]
}

Rules:
- imagePrompt: write flowing prose, NOT keywords. Describe composition, poses, spatial arrangement, lighting.
- Reference characters as "the [description] from image N" where N matches the imageNumber
- Reference settings as "the [location] from image N"
- Only reference images listed in the available references — do NOT fabricate image numbers
- If no references are available, set generationMode to "text_to_image" and references to []
- The references array MUST match exactly which image N you used in the imagePrompt
- Describe one frozen instant — no motion verbs, no narrative commentary`;
    } else {
      systemPrompt = CATEGORY_PROMPTS[effectiveCategory] ?? CATEGORY_PROMPTS.concept;
    }

    // Inject model-specific skills for image/video prompt generation
    const loadedSkills: string[] = [];
    const needsSkills = effectiveCategory === 'visual_ref' || effectiveCategory === 'clip';
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
        parts.push(`**Shot planning:** Break this scene into shots that total ~${perSceneDuration}s. Each shot should be 3-10 seconds.`);
      }
      if (sceneCount > 0) {
        // Figure out which scene number this is
        const sceneNum = node.itemId?.match(/(\d+)/)?.[1] ?? '?';
        parts.push(`**Scene ${sceneNum} of ${sceneCount}**`);
      }
    }

    // Shot-level: inject this shot's duration based on scene allocation and shot count
    if (node.typeId === 'shot_image_prompt' || node.typeId === 'scene_video' || node.typeId === 'scene_image') {
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

    // For shot_image_prompt: tell the LLM which image N maps to which character/setting
    // Actual file resolution happens later at shot image generation time, not prompt time
    let referenceImageContext = '';
    if (node.typeId === 'shot_image_prompt' && node.itemId) {
      referenceImageContext = this.buildShotReferenceMapping(node);
    }

    const user = inputs.contextBlock
      ? `${task}${projectContext}${referenceImageContext}\n\n${inputs.contextBlock}`
      : `${task}${projectContext}${referenceImageContext}`;

    return { system: systemPrompt, user, loadedSkills };
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
      character_image: 'character_image_guide',
      setting_image: 'setting_image_guide',
      shot_image_prompt: 'shot_image_guide',
      scene_video_prompt: 'scene_video_guide',
      shot_video: 'scene_video_guide',
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
        scene_video_prompt: 'ltx23',
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

    return {
      content: parts.length > 0 ? parts.join('\n\n') : null,
      files: loadedFiles,
    };
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
  private async expandPendingCollections(): Promise<void> {
    const allNodes = this.executor.getAllNodes();

    for (const node of allNodes) {
      if (!node.isCollection || node.status !== 'pending') continue;

      // Check if all dependencies are completed
      const allDepsComplete = node.dependencies.every(depId => {
        const dep = this.executor.getNode(depId);
        return dep && (dep.status === 'completed' || dep.status === 'skipped');
      });
      if (!allDepsComplete) continue;

      // This collection node is ready but not expanded.
      // Find the dependency that produces collection items and extract from it.
      for (const depId of node.dependencies) {
        const dep = this.executor.getNode(depId);
        if (!dep?.outputPath || dep.typeId !== 'scene_video_prompt') continue;

        const fullPath = join(this.config.projectDir, dep.outputPath);
        if (!existsSync(fullPath)) continue;

        const content = readFileSync(fullPath, 'utf-8');
        const items = await extractCollectionItems(dep, content, this.llm);
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
        break; // Only need one dependency to trigger expansion
      }
    }
  }

  /**
   * Validate that LLM output is valid JSON with required fields.
   */
  private validateJsonOutput(content: string, node: ExecutionNode): { valid: boolean; error?: string } {
    // Strip markdown code fences if the LLM wrapped the JSON
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    try {
      const parsed = JSON.parse(cleaned);

      if (node.typeId === 'scene_video_prompt') {
        if (!parsed.shots || !Array.isArray(parsed.shots)) {
          return { valid: false, error: 'Missing "shots" array' };
        }
        if (parsed.shots.length === 0) {
          return { valid: false, error: '"shots" array is empty' };
        }
        for (const shot of parsed.shots) {
          if (typeof shot.shotNumber !== 'number') {
            return { valid: false, error: 'Shot missing "shotNumber"' };
          }
          if (!shot.description) {
            return { valid: false, error: `Shot ${shot.shotNumber} missing "description"` };
          }
        }
      }

      if (node.typeId === 'shot_image_prompt') {
        if (!parsed.imagePrompt || typeof parsed.imagePrompt !== 'string') {
          return { valid: false, error: 'Missing "imagePrompt" string' };
        }
        if (!parsed.generationMode) {
          return { valid: false, error: 'Missing "generationMode"' };
        }
        if (!Array.isArray(parsed.references)) {
          return { valid: false, error: 'Missing "references" array' };
        }
      }

      if (node.typeId === 'character_image' || node.typeId === 'setting_image') {
        if (!parsed.imagePrompt || typeof parsed.imagePrompt !== 'string') {
          return { valid: false, error: 'Missing "imagePrompt" string' };
        }
        if (typeof parsed.negativePrompt !== 'string') {
          return { valid: false, error: 'Missing "negativePrompt" string' };
        }
        if (typeof parsed.aspectRatio !== 'string') {
          return { valid: false, error: 'Missing "aspectRatio" string' };
        }
      }

      return { valid: true };
    } catch (e) {
      return { valid: false, error: `JSON parse error: ${String(e)}` };
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

      // Build available reference images list
      // The LLM will include the ref_id in its JSON output so we can resolve files later
      const availableRefs: Array<{ imageNumber: number; type: string; refId: string; label: string }> = [];
      let imageNum = 1;

      const characters: string[] = shot.characters ?? [];
      for (const charId of characters) {
        const charImageNode = this.executor.getNode(`character_image:${charId}`);
        if (charImageNode?.status === 'completed' && charImageNode.outputPath) {
          availableRefs.push({ imageNumber: imageNum, type: 'character', refId: `character_image:${charId}`, label: charId });
          imageNum++;
        }
      }

      if (shot.setting) {
        const settingImageNode = this.executor.getNode(`setting_image:${shot.setting}`);
        if (settingImageNode?.status === 'completed' && settingImageNode.outputPath) {
          availableRefs.push({ imageNumber: imageNum, type: 'setting', refId: `setting_image:${shot.setting}`, label: shot.setting });
          imageNum++;
        }
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

  private findExistingPromptFile(node: ExecutionNode): string | null {
    // Compute the expected prompt path using the same logic as writeOutput
    const expectedPath = getOutputPathFn(node, this.config.projectDir, this.config.template);
    const fullPath = join(this.config.projectDir, expectedPath);
    if (existsSync(fullPath)) {
      return expectedPath;
    }
    return null;
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
    if (jsonNodeTypes.includes(node.typeId) || typeDef?.outputFormat === 'json') {
      options.responseFormat = { type: 'json_object' };
    }

    const agentName = this.config.name ?? 'kshana-executor';
    const effectiveToolName = toolDisplayName ?? `generate_${node.typeId}`;
    const hasThinking = this.llm.hasImplicitThinking;

    // Simple streaming path (no think tags) — avoids memory-heavy buffer accumulation
    if (!hasThinking) {
      const chunks: string[] = [];
      for await (const chunk of this.llm.generateStream(options)) {
        if (chunk.content) {
          chunks.push(chunk.content);
          if (toolCallId) {
            this.emit({
              type: 'tool_streaming',
              toolCallId, chunk: chunk.content, done: false,
              agentName, toolName: effectiveToolName,
            });
          }
        }
      }
      if (toolCallId) {
        this.emit({
          type: 'tool_streaming',
          toolCallId, chunk: '', done: true,
          agentName, toolName: effectiveToolName,
        });
      }
      return chunks.join('');
    }

    // Think-tag parsing path — separates <think> blocks from content
    // Uses incremental flush to avoid unbounded buffer growth
    const contentChunks: string[] = [];
    let buffer = '';
    let insideThink = false;

    for await (const chunk of this.llm.generateStream(options)) {
      if (!chunk.content) continue;

      buffer += chunk.content;

      // Process buffer — flush as much as possible each iteration
      while (buffer.length > 0) {
        if (insideThink) {
          const closeIdx = buffer.indexOf('</think>');
          if (closeIdx !== -1) {
            const thinkContent = buffer.slice(0, closeIdx);
            if (thinkContent) {
              this.emit({ type: 'streaming_think', chunk: thinkContent, done: false });
            }
            buffer = buffer.slice(closeIdx + '</think>'.length);
            insideThink = false;
            this.emit({ type: 'streaming_think', chunk: '', done: true });
          } else {
            // Flush all but the last 8 chars (potential partial </think>)
            if (buffer.length > 8) {
              this.emit({ type: 'streaming_think', chunk: buffer.slice(0, -8), done: false });
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

    const items = await extractCollectionItems(node, content, this.llm);

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
      const shotItems = items.shots.map(s => ({
        itemId: `${sceneId}_shot_${s.shotNumber}`,
        name: `Shot ${s.shotNumber}: ${s.shotType}`,
      }));

      // Find the shot_image_prompt node for this scene and expand it
      const shotPromptNodeId = `shot_image_prompt:${sceneId}`;
      const shotPromptNode = this.executor.getNode(shotPromptNodeId);
      if (shotPromptNode) {
        this.log(`  Expanding shots for ${sceneId}: ${shotItems.map(i => i.name).join(', ')}`);
        this.executor.expandCollection(`shot_image_prompt:${sceneId}`, shotItems);
        this.emit({
          type: 'notification',
          level: 'info',
          message: `Expanded shots for ${sceneId}: ${shotItems.map(i => i.name).join(', ')}`,
        });
      } else {
        this.log(`  No shot_image_prompt node found for ${sceneId} — creating per-shot nodes directly`);
        // The shot_image_prompt might not have been expanded to per-scene yet,
        // or might use a different node ID pattern. Create shot nodes manually.
        for (const shot of shotItems) {
          const shotNodeId = `shot_image_prompt:${shot.itemId}`;
          if (!this.executor.getNode(shotNodeId)) {
            // We can't add arbitrary nodes to the executor without expandCollection.
            // Log it — this case means the graph structure doesn't support per-shot expansion yet.
            this.log(`  WARNING: Cannot create shot node ${shotNodeId} — no parent collection node to expand`);
          }
        }
      }
      this.emitTodoUpdate();
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
   * Generate a shot image from structured JSON prompt.
   * Reads the JSON, resolves refIds to actual image paths, calls ComfyUI with FLUX Klein.
   */
  private async executeShotImageGeneration(
    node: ExecutionNode,
    jsonContent: string,
    toolCallId: string,
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

      // Determine generation mode based on resolved references
      const hasRefs = resolvedRefs.length > 0;
      const generationMode = hasRefs ? 'image_text_to_image' : 'text_to_image';

      // Emit tool_call for the image generation
      const genCallId = `shotimg_${node.id}_${Date.now()}`;
      const toolName = 'generate_shot_image';
      this.emit({
        type: 'tool_call',
        toolCallId: genCallId,
        toolName,
        arguments: {
          item: node.displayName,
          mode: generationMode,
          references: resolvedRefs.map(r => `${r.name} (${r.type})`).join(', ') || 'none',
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

      const result = await submitImageGeneration({
        scene_number: sceneNumber,
        prompt: shotJson.imagePrompt,
        negative_prompt: shotJson.negativePrompt,
        aspect_ratio: shotJson.aspectRatio ?? '16:9',
        image_type: 'scene',
        generation_mode: generationMode,
        reference_images: hasRefs ? resolvedRefs : undefined,
      });

      if (progressHandler) comfyProgressBus.offProgress(progressHandler!);

      const job = mediaJobs.get(result.jobId);
      const filePath = job?.result?.path;
      const artifactId = job?.result?.artifactId;

      if (result.status === 'completed' && filePath) {
        this.log(`  Shot image generated: ${filePath}`);
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

    // Emit a tool_call for the actual image generation
    const genCallId = `img_${node.id}_${Date.now()}`;
    const toolName = `generate_image`;
    this.emit({
      type: 'tool_call',
      toolCallId: genCallId,
      toolName,
      arguments: { item: node.displayName },
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

    // 1. Find the shot image from shot_image_prompt dependency
    let shotImagePath: string | undefined;
    for (const depId of node.dependencies) {
      const dep = this.executor.getNode(depId);
      if (dep?.outputPath?.endsWith('.png') || dep?.outputPath?.endsWith('.jpg')) {
        shotImagePath = dep.outputPath;
        break;
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
            motionPrompt = shot.description || '';
            if (shot.cameraWork) motionPrompt += ' ' + shot.cameraWork;
            shotDuration = shot.duration || 5;
          }
        } catch {
          this.log(`  Failed to parse scene_video_prompt JSON for motion`);
        }
      }
    }

    if (!motionPrompt) {
      motionPrompt = `Cinematic shot with subtle camera movement, scene ${sceneNum} shot ${shotNum}`;
    }

    // 3. Emit tool_call
    const genCallId = `shotvid_${node.id}_${Date.now()}`;
    const toolName = 'generate_shot_video';
    this.emit({
      type: 'tool_call',
      toolCallId: genCallId,
      toolName,
      arguments: { item: node.displayName, source_image: shotImagePath, duration: shotDuration },
      agentName,
    });

    // 4. Subscribe to progress
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

      const result = await provider.generateVideo(
        {
          sourceImagePath: join(this.config.projectDir, shotImagePath),
          prompt: motionPrompt,
          durationSeconds: shotDuration,
          outputDir: assetsDir,
          filenamePrefix: `scene_${sceneNum}_shot_${shotNum}`,
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
      this.log(`  Shot video generated: ${relPath} (${shotDuration}s)`);

      try {
        addAsset({
          id: `shotvid_${Date.now()}`,
          type: 'scene_video',
          path: relPath,
          createdAt: Date.now(),
          metadata: { sceneNumber: sceneNum, shotNumber: shotNum, duration: shotDuration },
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
      type: 'tool_streaming',
      toolCallId,
      chunk: 'Assembling final video from timeline...\n',
      done: false,
      agentName,
      toolName: 'assemble_final_video',
    });

    try {
      // Collect all completed shot videos in order (scene_1_shot_1, scene_1_shot_2, ..., scene_2_shot_1, ...)
      const shotVideoNodes = this.executor.getAllNodes()
        .filter(n => n.typeId === 'shot_video' && n.status === 'completed' && n.outputPath)
        .sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''));

      if (shotVideoNodes.length === 0) {
        this.log(`  No completed shot videos found — cannot assemble`);
        return null;
      }

      this.log(`  Found ${shotVideoNodes.length} shot videos for assembly`);
      this.emit({
        type: 'tool_streaming',
        toolCallId,
        chunk: `Found ${shotVideoNodes.length} shot videos. Assembling...\n`,
        done: false,
        agentName,
        toolName: 'assemble_final_video',
      });

      // Build resolved segments directly from shot video nodes (skip timeline system)
      let currentTime = 0;
      const resolvedSegments = shotVideoNodes.map(vn => {
        const filePath = join(projectDir, vn.outputPath!);
        // Estimate duration from scene_video_prompt JSON or default to 5s
        const sceneMatch = vn.itemId?.match(/scene_(\d+)/);
        const shotMatch = vn.itemId?.match(/shot_(\d+)/);
        const sceneNum = sceneMatch?.[1] ? parseInt(sceneMatch[1], 10) : 1;
        const shotNum = shotMatch?.[1] ? parseInt(shotMatch[1], 10) : 1;

        let duration = 5;
        // Try to get actual duration from scene_video_prompt JSON
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
        };
        currentTime += duration;
        return segment;
      });

      this.emit({
        type: 'tool_streaming',
        toolCallId,
        chunk: `Total duration: ${currentTime}s from ${resolvedSegments.length} shots\n`,
        done: false,
        agentName,
        toolName: 'assemble_final_video',
      });

      // Run FFmpeg assembly
      const outputDir = join(projectDir, 'assets', 'videos', 'final');
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
      const outputPath = join(outputDir, 'final_video.mp4');

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

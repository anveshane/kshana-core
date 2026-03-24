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

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
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
import { resolveInputs, writeOutput } from './contentResolver.js';
import { extractCollectionItems } from './collectionExtractor.js';
import type { ArtifactCategory } from '../templates/types.js';
import { resolveGuide, loadContentTypeSkills, type SkillResolutionContext } from '../prompts/loader.js';

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

  visual_ref: `You are an expert image prompt engineer.
Create a detailed image generation prompt for the described subject.
Include: subject description, composition, lighting, style, and camera angle.
Format your output as:
**Image Prompt:** [detailed prompt]
**Negative Prompt:** [things to avoid]
**Aspect Ratio:** [ratio like 16:9, 1:1, etc.]
Output ONLY the prompt — no explanations, no tool calls, no meta-commentary.`,

  clip: `You are a video direction expert.
Generate a detailed motion/animation prompt describing camera movement, character actions, and timing.
Output ONLY the motion prompt — no explanations, no tool calls, no meta-commentary.`,

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
      // Auto-retry previously failed nodes (transient errors from last session)
      const failedNodes = this.executor.getAllNodes().filter(n => n.status === 'failed');
      if (failedNodes.length > 0) {
        this.log(`Resetting ${failedNodes.length} failed node(s) for retry: ${failedNodes.map(n => n.id).join(', ')}`);
        for (const node of failedNodes) {
          this.executor.invalidateNode(node.id);
        }
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

    // Map categories to user-friendly phase names
    const phaseNames: Record<string, string> = {
      concept: 'Plot Development',
      structure: 'Story Writing',
      entity: 'Character Development',
      environment: 'Setting Development',
      segment: 'Scene Breakdown',
      visual_ref: 'Image Generation',
      clip: 'Video Generation',
      final: 'Final Assembly',
    };

    const phaseName = phaseNames[category] ?? category;

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
   * Run the dependency graph execution loop.
   *
   * This is the main entry point, matching GenericAgent.run() signature.
   * The `task` parameter is used for initial goal understanding only;
   * actual execution is driven by the graph.
   */
  async run(_task: string, _userResponse?: string): Promise<GenericAgentResult> {
    this.running = true;
    this.stopped = false;

    const agentName = this.config.name ?? 'kshana-executor';

    this.log('=== Execution started ===');
    this.log(`Nodes: ${this.executor.getAllNodes().map(n => n.id).join(', ')}`);

    try {
      this.emit({ type: 'agent_status', status: 'thinking', agentName });
      this.emitTodoUpdate();

      // Main execution loop
      while (!this.executor.isComplete() && !this.stopped) {
        const readyNodes = this.executor.getNextReady();

        if (readyNodes.length === 0) {
          this.log('STUCK: No ready nodes but not complete. Failed deps?');
          break;
        }

        this.log(`Ready nodes: ${readyNodes.map(n => n.id).join(', ')}`);

        for (const node of readyNodes) {
          if (this.stopped) break;

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
            // 1. Resolve inputs — code reads all dependency files
            const inputs = resolveInputs(node, this.executor, this.config.projectDir);
            this.log(`  Inputs resolved: ${inputs.filesRead.length} files read: ${inputs.filesRead.join(', ') || '(none)'}`);
            this.log(`  Reference images: ${inputs.referenceImages.length}`);
            this.log(`  Context block length: ${inputs.contextBlock.length} chars`);

            // 2. Build prompt based on node type (also loads skills)
            const { system, user, loadedSkills } = this.buildPromptForNode(node, inputs);
            this.log(`  Prompt built: system=${system.length} chars, user=${user.length} chars`);

            // Emit tool_call so the UI shows what we're generating and its inputs
            const toolCallId = `exec_${node.id}_${Date.now()}`;
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

            // 3. For expensive ops, ask user approval
            if (node.isExpensive) {
              this.log(`  Expensive op — requesting approval`);
              const approved = await this.askApproval(node, inputs);
              if (!approved) {
                this.log(`  Skipped by user`);
                this.executor.markFailed(node.id, 'Skipped by user');
                continue;
              }
            }

            // 4. Generate content via LLM (pure completion, no tools)
            this.log(`  Calling LLM...`);
            const content = await this.generateForNode(node, system, user, toolCallId, toolName);
            this.log(`  LLM returned ${content.length} chars`);

            // 5. Write output to disk
            const outputPath = writeOutput(
              node, content, this.config.projectDir, this.config.template,
            );
            this.log(`  Written to: ${outputPath}`);

            // Emit tool_result so the UI shows the output
            this.emit({
              type: 'tool_result',
              toolCallId,
              toolName,
              result: {
                status: 'completed',
                file: outputPath,
              },
              agentName,
            });

            // 6. Emit human-readable summary
            this.emit({
              type: 'agent_text',
              text: `**${node.displayName}** generated → \`${outputPath}\``,
              isFinal: false,
            });

            // 7. Extract collection items if this node produces them
            // Check both: (a) has collection dependents, (b) is a known expansion-producing type
            const needsExpansion = this.executor.producesCollectionItems(node)
              || node.typeId === 'scene_video_prompt';  // produces shots
            if (needsExpansion) {
              this.log(`  Extracting collection items...`);
              await this.handleCollectionExpansion(node, content);
            }

            // 8. Mark completed and persist state
            this.executor.markCompleted(node.id, outputPath);
            this.persistState();
            this.emitTodoUpdate();
            this.log(`  COMPLETED: ${node.id}`);

          } catch (error) {
            const errMsg = String(error);
            const isTransient = /premature close|timed? ?out|ECONNRESET|ECONNREFUSED|socket hang up|network/i.test(errMsg);

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
    let systemPrompt = CATEGORY_PROMPTS[category] ?? CATEGORY_PROMPTS.concept;

    // Inject model-specific skills for image/video prompt generation
    const loadedSkills: string[] = [];
    const skillTypes = ['visual_ref', 'clip'] as const;
    if (skillTypes.includes(category as typeof skillTypes[number])) {
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

    const user = inputs.contextBlock
      ? `${task}${projectContext}\n\n${inputs.contextBlock}`
      : `${task}${projectContext}`;

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
      scene_image: 'scene_image_guide',
      shot_image_prompt: 'shot_image_guide',
      scene_video_prompt: 'scene_video_guide',
      scene_video: 'scene_video_guide',
    };

    // Content type names for skill file resolution
    const contentTypeMap: Record<string, string> = {
      character_image: 'character_image_prompt',
      setting_image: 'setting_image_prompt',
      scene_image: 'scene_image_prompt',
      shot_image_prompt: 'shot_image_prompt',
      scene_video_prompt: 'scene_video_prompt',
      scene_video: 'scene_video_prompt',
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
        scene_image: 'flux2_klein_edit',
        shot_image_prompt: 'flux2_klein_edit',
        scene_video_prompt: 'ltx23',
        scene_video: 'ltx23',
      };

      let skillContext: SkillResolutionContext | undefined;
      const workflowName = workflowMap[node.typeId];

      // Try provider registry first, fall back to hardcoded defaults
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { getProviderRegistry } = require('../../services/providers/index.js');
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

    const options: GenerateOptions = {
      messages,
      temperature: 0.7,
    };

    // For content types that need structured output (scene_video_prompt), use JSON
    const typeDef = this.config.template.artifactTypes[node.typeId];
    if (typeDef?.outputFormat === 'json') {
      options.responseFormat = { type: 'json_object' };
    }

    // Stream the generation with <think> tag separation:
    // - Thinking content → streaming_think events (shown in UI, not saved)
    // - Actual content → tool_streaming events (shown in UI AND saved to file)
    const contentChunks: string[] = [];
    const agentName = this.config.name ?? 'kshana-executor';
    const effectiveToolName = toolDisplayName ?? `generate_${node.typeId}`;

    // State machine for parsing <think> tags across chunk boundaries
    let buffer = '';
    let insideThink = false;

    for await (const chunk of this.llm.generateStream(options)) {
      if (!chunk.content) continue;

      buffer += chunk.content;

      // Process buffer for <think> tags
      while (buffer.length > 0) {
        if (insideThink) {
          const closeIdx = buffer.indexOf('</think>');
          if (closeIdx !== -1) {
            // Emit thinking content up to the close tag
            const thinkContent = buffer.slice(0, closeIdx);
            if (thinkContent) {
              this.emit({ type: 'streaming_think', chunk: thinkContent, done: false });
            }
            buffer = buffer.slice(closeIdx + '</think>'.length);
            insideThink = false;
            // Signal thinking done
            this.emit({ type: 'streaming_think', chunk: '', done: true });
          } else {
            // No close tag yet — emit what we have as thinking, keep potential partial tag
            const keepLen = '</think>'.length - 1;
            if (buffer.length > keepLen) {
              const safe = buffer.slice(0, buffer.length - keepLen);
              this.emit({ type: 'streaming_think', chunk: safe, done: false });
              buffer = buffer.slice(buffer.length - keepLen);
            }
            break;
          }
        } else {
          const openIdx = buffer.indexOf('<think>');
          if (openIdx !== -1) {
            // Emit content before the think tag
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
            // No think tag — check for potential partial <think> at the end
            const keepLen = '<think>'.length - 1;
            if (buffer.length > keepLen) {
              const safe = buffer.slice(0, buffer.length - keepLen);
              contentChunks.push(safe);
              if (toolCallId) {
                this.emit({
                  type: 'tool_streaming',
                  toolCallId, chunk: safe, done: false,
                  agentName, toolName: effectiveToolName,
                });
              }
              buffer = buffer.slice(buffer.length - keepLen);
            }
            break;
          }
        }
      }
    }

    // Flush remaining buffer as content
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

    // Signal streaming done
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

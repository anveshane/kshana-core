/**
 * Generic Agent with hierarchical todo management.
 *
 * Features:
 * - while(tool_use) loop for autonomous task completion
 * - Framework-enforced confirmation for complex tools
 * - Hierarchical todo management with expand capability
 * - Sub-agent dispatch with isolated state
 */
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as path from 'path';
import { TypedEventEmitter } from '../../events/index.js';
import type { LLMClient, Message, ToolCall, ToolDefinition, LLMResponse } from '../llm/index.js';
import { ExpandableTodoManager, type ExpandableTodoItem } from '../todo/index.js';
import {
  buildSystemMessage,
  buildPlanningPrompt,
  buildExplorePrompt,
  buildContentPrompt,
  buildImageGenerationPrompt,
  buildTranscriptParserPrompt,
  buildPlacementPlannerPrompt,
  buildImagePlacerPrompt,
  buildVideoPlacerPrompt,
  buildInfographicsPlacerPrompt,
  buildVideoReplacerPrompt,
  wrapUserTask,
  type ContentType,
} from '../prompts/index.js';
import { loadAndRenderMarkdown } from '../prompts/loader.js';
import type { AgentConfig, AgentStatus, GenericAgentResult } from './AgentResult.js';
import { contextStore, condenseUserInput, generateContentLabel, shouldCondense, LONG_CONTENT_THRESHOLD } from '../context/index.js';
import { CONTENT_TYPE_CONTEXTS, CONTENT_TYPE_OUTPUT_FILES } from '../tools/builtin/generateContentTool.js';
import { buildContextVariablesSection, type ContextVariable } from '../prompts/index.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';
import { writeProjectFile, getCurrentProjectBasePath, loadProject } from '../../tasks/video/workflow/ProjectManager.js';
import { WorkflowPhase } from '../../tasks/video/workflow/types.js';
import { isYouTubeWorkflow } from '../../tasks/video/workflow/workflows/workflow-manager.js';

// Get the phase logger instance
const phaseLogger = getPhaseLogger();

// Legacy debug logging (wraps phaseLogger for backward compatibility during migration)
function debugLog(message: string) {
  // Parse the message to extract component and content
  const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match && match[1] && match[2] !== undefined) {
    const component: string = match[1];
    const content: string = match[2];
    phaseLogger.debug(component, 'legacy', content);
  } else {
    phaseLogger.debug('GenericAgent', 'legacy', message);
  }
}

/**
 * Tool categories - simple tools execute immediately, complex require confirmation.
 */
const SIMPLE_TOOLS = new Set([
  'think',
  'AskUserQuestion',
  'ask_user', // back-compat during migration
  'dispatch_agent',
  'dispatch_content_agent',
  'dispatch_image_agent',
  'dispatch_video_agent',
  'generate_content', // Deterministic content generation
  'wait_for_job',
  'TodoWrite',
  'todo_write', // back-compat during migration
]);

const COMPLEX_TOOLS = new Set(['generate_image', 'generate_video', 'edit_image']);

function isComplexTool(name: string): boolean {
  return COMPLEX_TOOLS.has(name);
}

function isBuiltinTodoTool(name: string): boolean {
  return name === 'TodoWrite' || name === 'todo_write';
}

function isTaskTool(name: string): boolean {
  return name === 'Task';
}

function isPlanModeTool(name: string): boolean {
  return name === 'EnterPlanMode' || name === 'ExitPlanMode';
}

export class GenericAgent extends TypedEventEmitter {
  private tools: Map<string, ToolDefinition>;
  private llm: LLMClient;
  private isSubAgent: boolean;
  private maxIterations: number;
  private name: string;
  private customPrompt?: string;

  /**
   * Safely check if customPrompt includes a string.
   * Returns false if customPrompt is not a string.
   */
  private customPromptIncludes(searchString: string): boolean {
    return typeof this.customPrompt === 'string' && this.customPrompt.includes(searchString);
  }

  // State
  private todoManager = new ExpandableTodoManager();
  private messages: Message[] = [];
  private iteration = 0;
  private waitingForUser = false;
  private pendingQuestion?: string;
  private pendingConfirmations = new Map<string, Record<string, unknown>>();

  // Interruption state
  private aborted = false;
  private pendingUserInput: string | null = null;

  // Active context variables for this session
  private activeContextVariables: ContextVariable[] = [];

  // Loop detection state
  private recentToolCalls: string[] = [];
  private contentGenerationHistory: string[] = [];
  private consecutiveLoopWarnings = 0;
  private lastBlockedTool: string | null = null;
  private lastBlockedSignature: string | null = null;
  private static readonly LOOP_DETECTION_WINDOW = 6;
  private static readonly LOOP_THRESHOLD = 3; // Same tool called 3+ times in window
  private static readonly MAX_CONSECUTIVE_LOOP_WARNINGS = 3; // Force stop after this many warnings

  // Circuit breaker for transition_phase retry loop
  private consecutiveNoToolCallAttempts = 0;
  private lastPromptedAction: string | null = null;
  private static readonly MAX_TRANSITION_RETRIES = 2; // Force transition after 2 failed attempts

  // Context window tracking
  private tokenUsage = {
    lastPromptTokens: 0,
    lastCompletionTokens: 0,
  };
  // Lower threshold (60%) to leave room for response generation
  // llama.cpp servers often can't handle mid-generation overflow
  private static readonly CONTEXT_THRESHOLD = 0.60;
  private maxContextTokens: number = 16000; // Will be updated from LLM client

  // Current mode for more descriptive agent names in UI
  private currentMode: 'orchestrator' | 'content' | 'image' | 'video' | 'planning' = 'orchestrator';

  // Claude SDK-style plan mode state
  private planModeActive = false;

  // Project isolation: track current project ID to detect project changes
  private projectId: string | null = null;
  private lastProjectId: string | null = null;

  constructor(
    tools: Map<string, ToolDefinition>,
    llm: LLMClient,
    config: AgentConfig = {}
  ) {
    super();
    this.tools = tools;
    this.llm = llm;
    this.isSubAgent = config.isSubAgent ?? false;
    this.maxIterations = config.maxIterations ?? 100;
    this.name = config.name ?? `agent-${nanoid(6)}`;
    this.customPrompt = config.customPrompt;
    this.projectId = config.projectId ?? null;
    this.projectId = config.projectId ?? null;
    this.lastProjectId = this.projectId;
  }

  /**
   * Update the custom prompt (instructions) for the agent.
   * This rebuilds the system message immediately.
   * Useful for phase transitions in workflow agents.
   */
  updateCustomPrompt(prompt: string): void {
    this.customPrompt = prompt;
    this.rebuildSystemMessage();
  }

  /**
   * Rebuild the system message in the messages history.
   */
  private rebuildSystemMessage(): void {
    if (this.messages.length > 0 && this.messages[0] && this.messages[0].role === 'system') {
      this.messages[0].content = this.buildSystemMessage();
      debugLog(`[GenericAgent] Updated system message (custom prompt length: ${this.customPrompt?.length ?? 0})`);
    }
  }

  /**
   * Initialize the agent by querying model capabilities.
   * Must be called before running the agent.
   * Throws if the model's context length is too small.
   */
  async initialize(): Promise<void> {
    // Query context length from LLM provider (validates minimum requirements)
    this.maxContextTokens = await this.llm.getContextLength();
    debugLog(`[GenericAgent] Initialized with context length: ${this.maxContextTokens} tokens`);
  }

  /**
   * Get the effective agent name based on current mode.
   */
  private getEffectiveAgentName(): string {
    switch (this.currentMode) {
      case 'orchestrator':
        return 'Orchestrator';
      case 'content':
        return 'Content Agent';
      case 'image':
        return 'Image Agent';
      case 'video':
        return 'Video Agent';
      case 'planning':
        return 'Planning Agent';
      default:
        return this.name;
    }
  }

  /**
   * Stop the agent's current execution.
   */
  stop(): void {
    this.aborted = true;
    this.emit({ type: 'agent_status', status: 'interrupted', agentName: this.getEffectiveAgentName() });
  }

  /**
   * Update the project ID. This will trigger a state reset on the next run() call
   * if the project ID has changed.
   */
  setProjectId(projectId: string | null): void {
    this.projectId = projectId;
  }

  /**
   * Inject new user input during execution.
   * The agent will process this input on the next iteration.
   */
  injectInput(input: string): void {
    this.pendingUserInput = input;
    this.emit({ type: 'user_input_injected', input, agentName: this.getEffectiveAgentName() });
  }

  /**
   * Check if agent is currently running.
   */
  isRunning(): boolean {
    return !this.aborted && !this.waitingForUser && this.iteration > 0;
  }

  /**
   * Generate LLM response with streaming, emitting chunks as they arrive.
   * Accumulates content and tool calls, returning the complete response.
   */
  private async generateWithStreaming(
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    let content = '';
    const toolCalls: ToolCall[] = [];
    const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    try {
      for await (const chunk of this.llm.generateStream({ messages, tools, temperature: 0.7 })) {
        // Check for abort
        if (this.aborted) {
          this.emit({ type: 'streaming_text', chunk: '', done: true });
          break;
        }

        // Handle content chunks
        if (chunk.content) {
          content += chunk.content;
          debugLog(`[GenericAgent] streaming_text emit: chunk=${chunk.content.length} chars, total=${content.length} chars`);
          this.emit({ type: 'streaming_text', chunk: chunk.content, done: false });
        }

        // Handle tool call deltas
        if (chunk.toolCallDelta) {
          const delta = chunk.toolCallDelta;
          let accumulator = toolCallAccumulators.get(delta.index);

          if (!accumulator) {
            accumulator = { id: delta.id ?? '', name: delta.name ?? '', arguments: '' };
            toolCallAccumulators.set(delta.index, accumulator);
          }

          if (delta.id) accumulator.id = delta.id;
          if (delta.name) accumulator.name = delta.name;
          if (delta.arguments) accumulator.arguments += delta.arguments;
        }

        // Handle stream completion and capture usage
        if (chunk.done) {
          debugLog(`[GenericAgent] streaming_text DONE: total content=${content.length} chars, toolCallCount=${toolCallAccumulators.size}`);
          this.emit({ type: 'streaming_text', chunk: '', done: true });
          if (chunk.usage) {
            usage = chunk.usage;
          }
        }
      }
    } catch (error) {
      // On error, emit done and log context before re-throwing
      const errorMessage = error instanceof Error ? error.message : String(error);
      const agentName = this.getEffectiveAgentName();
      console.error(`[GenericAgent] Streaming LLM call failed in ${agentName}:`, errorMessage);
      this.emit({ type: 'streaming_text', chunk: '', done: true });
      throw error;
    }

    // Convert accumulated tool calls to final format
    for (const [, acc] of toolCallAccumulators) {
      if (acc.id && acc.name) {
        try {
          toolCalls.push({
            id: acc.id,
            name: acc.name,
            arguments: acc.arguments ? JSON.parse(acc.arguments) : {},
          });
        } catch {
          // If JSON parsing fails, use empty object
          toolCalls.push({
            id: acc.id,
            name: acc.name,
            arguments: {},
          });
        }
      }
    }

    // Clean content (remove <think> tags)
    const cleanedContent = content ? content.replace(/<think>.*?<\/think>/gs, '').trim() : null;

    debugLog(`[GenericAgent] generateWithStreaming result: rawContent=${content.length} chars, cleanedContent=${cleanedContent?.length ?? 0} chars, toolCalls=${toolCalls.length}`);
    if (cleanedContent) {
      debugLog(`[GenericAgent] generateWithStreaming content preview: "${cleanedContent.slice(0, 200)}${cleanedContent.length > 200 ? '...' : ''}"`);
    }

    return {
      content: cleanedContent,
      toolCalls,
      finishReason: 'stop',
      usage,
    };
  }

  /**
   * Run the agent on a task.
   * Returns when completed, errored, or waiting for user input.
   */
  async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    // Reset abort state for new run
    this.aborted = false;

    // Emit started status
    this.emit({ type: 'agent_status', status: 'started', agentName: this.getEffectiveAgentName() });

    // IMMEDIATE phase correction - do this FIRST before any processing
    // This ensures YouTube workflows always start with TRANSCRIPT_INPUT phase
    try {
      const { loadProject, setProjectInputType, normalizeCurrentPhaseForInputType, looksLikeSrt, saveProject } = await import('../../tasks/video/workflow/ProjectManager.js');
      let project = loadProject();
      if (project) {
        // Check if input looks like transcript but project has wrong inputType
        if (task && (project.inputType === 'idea' || project.inputType === undefined)) {
          // Re-check input if project inputType is not set or is 'idea'
          if (looksLikeSrt(task)) {
            const corrected = setProjectInputType('youtube_srt');
            if (corrected) {
              debugLog(`[GenericAgent] Corrected project inputType to youtube_srt based on task content`);
              project = corrected;
            }
          }
        }
        
        // For YouTube workflows, force correct phase (must be TRANSCRIPT_INPUT, not PLOT/STORY)
        if (project.inputType === 'youtube_srt' || project.inputType === 'script') {
          const normalized = normalizeCurrentPhaseForInputType(project);
          if (normalized.changed || project.currentPhase === 'plot' || project.currentPhase === 'story') {
            const oldPhase = project.currentPhase;
            project.currentPhase = normalized.phase;
            saveProject(project);
            debugLog(`[GenericAgent] IMMEDIATELY corrected phase from ${oldPhase} to ${normalized.phase} for YouTube workflow`);
          }
        }
      }
    } catch (err) {
      debugLog(`[GenericAgent] Failed to correct project phase at start: ${err}`);
    }

    // Resume from user question or start fresh
    if (userResponse && this.waitingForUser) {
      // Check if there's an active planning session (from dispatch_agent)
      // Check if there's an active planning session (from dispatch_agent)
      if (this.planningState?.active) {
        // Capture toolCallId BEFORE handling response (which might clear the state)
        const toolCallId = this.planningState.toolCallId;

        // Handle the planning response
        const planResult = await this.handlePlanningResponse(userResponse);
        const planResultObj = planResult as Record<string, unknown>;

        // Check if planning needs more input or is complete
        if (planResultObj['status'] === 'awaiting_verification') {
          // Still waiting for user - emit question and return
          this.waitingForUser = true;
          this.pendingQuestion = planResultObj['question'] as string;

          this.emit({
            type: 'question',
            question: planResultObj['question'] as string,
            isConfirmation: false,
            options: planResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: planResultObj['autoApproveTimeoutMs'] as number | undefined,
          });

          // Note: Plan is shown via ToolCallDisplay, don't duplicate in output
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: planResultObj['question'] as string,
            options: planResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: planResultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Planning is complete (approved, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Find the dispatch_agent tool call and add/update its result
        // Check if a tool message with this toolCallId already exists (from awaiting_verification)
        const existingPlanToolMsgIndex = this.messages.findIndex(
          msg => msg.role === 'tool' && msg.toolCallId === toolCallId
        );
        if (existingPlanToolMsgIndex >= 0) {
          // Update existing message instead of adding duplicate
          this.messages[existingPlanToolMsgIndex] = {
            role: 'tool',
            content: JSON.stringify(planResult),
            toolCallId: toolCallId,
            name: 'dispatch_agent',
          };
          debugLog(`[GenericAgent] Updated existing tool message at index ${existingPlanToolMsgIndex} for dispatch_agent`);
        } else {
          // Add new tool message
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(planResult),
            toolCallId: toolCallId,
            name: 'dispatch_agent',
          });
        }

        // Emit status change back to thinking
        this.emit({ type: 'agent_status', status: 'thinking', agentName: this.getEffectiveAgentName() });

        debugLog(`[GenericAgent] Plan approved, continuing main loop. Planning state cleared: ${this.planningState === null}`);
        // Continue the main execution loop to process the approved plan
        // Don't return here - let the loop continue (fall through to main loop at line 544)
      } else if (this.contentState?.active) {
        // Capture toolCallId BEFORE handling response
        const toolCallId = this.contentState.toolCallId;

        // Handle the content creation response
        const contentResult = await this.handleContentResponse(userResponse);
        const contentResultObj = contentResult as Record<string, unknown>;

        // Check if content needs more input or is complete
        if (contentResultObj['status'] === 'awaiting_verification') {
          // Still waiting for user - emit question and return
          this.waitingForUser = true;
          this.pendingQuestion = contentResultObj['question'] as string;

          this.emit({
            type: 'question',
            question: contentResultObj['question'] as string,
            isConfirmation: false,
            options: contentResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: contentResultObj['autoApproveTimeoutMs'] as number | undefined,
          });

          // Content is shown via ToolCallDisplay
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: contentResultObj['question'] as string,
            options: contentResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: contentResultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Content creation is complete (approved, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Add/update the dispatch_content_agent result to messages
        // Check if a tool message with this toolCallId already exists (from awaiting_verification)
        const existingContentToolMsgIndex = this.messages.findIndex(
          msg => msg.role === 'tool' && msg.toolCallId === toolCallId
        );
        if (existingContentToolMsgIndex >= 0) {
          // Update existing message instead of adding duplicate
          this.messages[existingContentToolMsgIndex] = {
            role: 'tool',
            content: JSON.stringify(contentResult),
            toolCallId: toolCallId,
            name: 'dispatch_content_agent',
          };
          debugLog(`[GenericAgent] Updated existing tool message at index ${existingContentToolMsgIndex} for dispatch_content_agent`);
        } else {
          // Add new tool message
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(contentResult),
            toolCallId: toolCallId,
            name: 'dispatch_content_agent',
          });
        }

        // Emit status change back to thinking
        this.emit({ type: 'agent_status', status: 'thinking', agentName: this.getEffectiveAgentName() });

        // Continue main loop - don't reset messages since we're continuing from a tool result
        // Skip the "start fresh" logic below since we already have messages
        debugLog(`[GenericAgent] Content approved, continuing main loop with existing messages (${this.messages.length} messages)`);
      } else if (this.imageGenState?.active) {
        // Capture toolCallId BEFORE handling response
        const toolCallId = this.imageGenState.toolCallId;

        // Handle the image generation response
        const imageResult = await this.handleImageGenResponse(userResponse);
        const imageResultObj = imageResult as Record<string, unknown>;

        // Check if image gen needs more input or is complete
        if (imageResultObj['status'] === 'awaiting_prompt_approval') {
          // Still waiting for user - emit question and return
          this.waitingForUser = true;
          this.pendingQuestion = imageResultObj['question'] as string;

          this.emit({
            type: 'question',
            question: imageResultObj['question'] as string,
            isConfirmation: false,
            options: imageResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: imageResultObj['autoApproveTimeoutMs'] as number | undefined,
            context: imageResultObj['prompt'] as string,
          });

          // Prompt is shown in QuestionPrompt context
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: imageResultObj['question'] as string,
            options: imageResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: imageResultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Image generation is complete (generated, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Add/update the dispatch_image_agent result to messages
        // Check if a tool message with this toolCallId already exists (from awaiting_prompt_approval)
        const existingImageToolMsgIndex = this.messages.findIndex(
          msg => msg.role === 'tool' && msg.toolCallId === toolCallId
        );
        if (existingImageToolMsgIndex >= 0) {
          // Update existing message instead of adding duplicate
          this.messages[existingImageToolMsgIndex] = {
            role: 'tool',
            content: JSON.stringify(imageResult),
            toolCallId: toolCallId,
            name: 'dispatch_image_agent',
          };
          debugLog(`[GenericAgent] Updated existing tool message at index ${existingImageToolMsgIndex} for dispatch_image_agent`);
        } else {
          // Add new tool message
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(imageResult),
            toolCallId: toolCallId,
            name: 'dispatch_image_agent',
          });
        }

        // Emit status change back to thinking
        this.emit({ type: 'agent_status', status: 'thinking', agentName: this.getEffectiveAgentName() });
      } else if (this.videoGenState?.active) {
        // Capture toolCallId BEFORE handling response
        const toolCallId = this.videoGenState.toolCallId;

        // Handle the video generation response
        const videoResult = await this.handleVideoGenResponse(userResponse);
        const videoResultObj = videoResult as Record<string, unknown>;

        // Check if video gen needs more input or is complete
        if (videoResultObj['status'] === 'awaiting_approval') {
          // Still waiting for user - emit question and return
          this.waitingForUser = true;
          this.pendingQuestion = videoResultObj['question'] as string;

          this.emit({
            type: 'question',
            question: videoResultObj['question'] as string,
            isConfirmation: false,
            options: videoResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: videoResultObj['autoApproveTimeoutMs'] as number | undefined,
          });

          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: videoResultObj['question'] as string,
            options: videoResultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: videoResultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Video generation is complete (generated, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Add/update the dispatch_video_agent result to messages
        // Check if a tool message with this toolCallId already exists (from awaiting_approval)
        const existingVideoToolMsgIndex = this.messages.findIndex(
          msg => msg.role === 'tool' && msg.toolCallId === toolCallId
        );
        if (existingVideoToolMsgIndex >= 0) {
          // Update existing message instead of adding duplicate
          this.messages[existingVideoToolMsgIndex] = {
            role: 'tool',
            content: JSON.stringify(videoResult),
            toolCallId: toolCallId,
            name: 'dispatch_video_agent',
          };
          debugLog(`[GenericAgent] Updated existing tool message at index ${existingVideoToolMsgIndex} for dispatch_video_agent`);
        } else {
          // Add new tool message
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(videoResult),
            toolCallId: toolCallId,
            name: 'dispatch_video_agent',
          });
        }

        // Emit status change back to thinking
        this.emit({ type: 'agent_status', status: 'thinking', agentName: this.getEffectiveAgentName() });
      } else {
        // Regular ask_user response
        this.handleUserResponse(userResponse);
        this.waitingForUser = false;
        this.pendingQuestion = undefined;
      }

      // After handling user response (content/plan/image/video approval), continue main loop
      // Don't reset messages - we're continuing with existing conversation
      // The tool result has already been added to messages above
      if (this.messages.length === 0) {
        debugLog(`[GenericAgent] WARNING: No messages after handling user response. This should not happen.`);
        // Fallback: if somehow messages are empty, we need to initialize
        // But this shouldn't happen in normal flow
      }
    } else if (!this.waitingForUser && task && task.trim().length > 0) {
      // Only start fresh if we have a non-empty task AND we're not waiting for user
      // If task is empty, we're continuing from a previous state (e.g., after content approval)
      // Don't reset messages in that case - continue with existing conversation
      // Check if project ID changed - if so, reset all state to ensure isolation
      if (this.projectId !== this.lastProjectId) {
        debugLog(`[GenericAgent] Project ID changed from ${this.lastProjectId} to ${this.projectId}. Resetting agent state.`);
        this.messages = [];
        this.activeContextVariables = [];
        this.todoManager = new ExpandableTodoManager();
        this.iteration = 0;

        this.recentToolCalls = [];
        this.contentGenerationHistory = [];
        // Reload context store for the new project to ensure isolation
        const basePath = getCurrentProjectBasePath();
        contextStore.reload(this.projectId, basePath);
        this.lastProjectId = this.projectId;
      }

      // Start fresh - check if task is long and should be condensed
      let taskContent = task;
      if (shouldCondense(task)) {
        const label = generateContentLabel(task);
        const result = condenseUserInput(task);
        if (result.wasCondensed && result.variableName) {
          // Add to active context variables
          this.activeContextVariables.push({
            variableName: result.variableName,
            label,
            charCount: task.length,
          });
          taskContent = result.condensed;
          debugLog(`[GenericAgent] Condensed long user input (${task.length} chars) to ${result.variableName}`);
        }
      }

      // Start fresh - wrap user task in XML tags for structured prompts
      this.messages = [
        { role: 'system', content: this.buildSystemMessage() },
        { role: 'user', content: wrapUserTask(taskContent) },
      ];
      this.iteration = 0;
      this.recentToolCalls = []; // Reset loop detection
    }

    let finalOutput = '';

    // Main while(tool_use) loop
    while (this.iteration < this.maxIterations) {
      // CRITICAL: Check COMPLETED phase FIRST - before any other work
      try {
        const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
        const project = loadProject();
        if (project?.currentPhase === 'completed') {
          debugLog(`[GenericAgent] COMPLETED phase detected at loop start. Stopping execution immediately.`);
          return {
            status: 'completed',
            output: 'Workflow complete. All videos and images have been generated successfully.',
            todos: this.todoManager.getTodos(),
          };
        }
      } catch (err) {
        debugLog(`[GenericAgent] Failed to check project phase at loop start: ${err}`);
        // Continue if check fails
      }

      // Check for abort
      if (this.aborted) {
        return {
          status: 'interrupted',
          output: 'Execution stopped by user.',
          todos: this.todoManager.getTodos(),
          error: 'user_stopped',
        };
      }

      // Check for injected user input - add it to messages
      if (this.pendingUserInput) {
        let userInput = this.pendingUserInput;
        this.pendingUserInput = null;

        // Condense if long
        if (shouldCondense(userInput)) {
          const label = generateContentLabel(userInput);
          const result = condenseUserInput(userInput);
          if (result.wasCondensed && result.variableName) {
            this.activeContextVariables.push({
              variableName: result.variableName,
              label,
              charCount: userInput.length,
            });
            userInput = result.condensed;
            debugLog(`[GenericAgent] Condensed injected user input to ${result.variableName}`);
          }
        }

        // Add user input as a new message with XML tags
        this.messages.push({
          role: 'user',
          content: `<user_interjection>\n${userInput}\n</user_interjection>`,
        });

        // Emit event
        this.emit({ type: 'agent_text', text: `User: ${userInput.slice(0, 200)}${userInput.length > 200 ? '...' : ''}`, isFinal: false });
      }

      this.iteration++;

      // CRITICAL: Stop immediately if we're in COMPLETED phase
      try {
        const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
        const project = loadProject();
        if (project?.currentPhase === 'completed') {
          debugLog(`[GenericAgent] COMPLETED phase detected. Stopping execution immediately.`);
          return {
            status: 'completed',
            output: 'Workflow complete. All videos and images have been generated successfully.',
            todos: this.todoManager.getTodos(),
          };
        }
      } catch (err) {
        debugLog(`[GenericAgent] Failed to check project phase: ${err}`);
        // Continue if check fails
      }

      // Emit thinking status
      this.emit({ type: 'agent_status', status: 'thinking', agentName: this.getEffectiveAgentName() });

      // Check if we need to compress context before making LLM call
      if (this.shouldCompressContext()) {
        await this.compressConversationHistory();
      }

      // Build messages with todo reminder injected
      const messagesWithReminder = this.injectTodoReminder();

      // Stream LLM response
      const response = await this.generateWithStreaming(
        messagesWithReminder,
        Array.from(this.tools.values())
      );

      // Track token usage for context window management
      if (response.usage) {
        this.tokenUsage.lastPromptTokens = response.usage.promptTokens;
        this.tokenUsage.lastCompletionTokens = response.usage.completionTokens;
        debugLog(`[GenericAgent] Token usage: prompt=${response.usage.promptTokens}, completion=${response.usage.completionTokens}, total=${response.usage.totalTokens}`);

        // Log context usage for phase-aware monitoring
        phaseLogger.contextUsage('GenericAgent', response.usage.promptTokens, this.maxContextTokens);
      }

      // Add assistant message to history
      this.messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // If no tool calls, check if we should continue or finish
      if (response.toolCalls.length === 0) {
        finalOutput = response.content ?? '';

        // CRITICAL: Check if we're in TRANSCRIPT_INPUT phase and haven't called Task tool yet
        // Check actual project state first (more reliable than prompt content)
        let isTranscriptInputPhase = false;
        let projectInputType: string | undefined;
        try {
          const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
          const project = loadProject();
          if (project) {
            projectInputType = project.inputType;
            // For YouTube workflows, check if we're in transcript_input phase
            if (project.inputType === 'youtube_srt' || project.inputType === 'script') {
              isTranscriptInputPhase = project.currentPhase === 'transcript_input';
            }
          }
        } catch (err) {
          debugLog(`[GenericAgent] Failed to check project state: ${err}`);
        }

        // Fallback: Check prompt content if project doesn't exist or isn't YouTube workflow
        if (!isTranscriptInputPhase) {
          isTranscriptInputPhase = this.customPromptIncludes('transcript_input') || 
                                   this.customPromptIncludes('Transcript Input') ||
                                   this.customPromptIncludes('TRANSCRIPT_INPUT') ||
                                   this.name.includes('transcript_input') ||
                                   this.name.includes('transcript-input');
        }
        
        if (isTranscriptInputPhase && this.iteration < this.maxIterations - 1) {
          // First, check the actual project state to see if transcript is already parsed
          let transcriptAlreadyParsed = false;
          let phaseAlreadyCompleted = false;
          try {
            const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
            const project = loadProject();
            if (project) {
              // Check if transcript entries already exist
              transcriptAlreadyParsed = Boolean(project.transcriptEntries && project.transcriptEntries.length > 0);
              // Check if phase is already completed
              const phaseInfo = project.phases?.transcript_input;
              phaseAlreadyCompleted = Boolean(phaseInfo?.status === 'completed' || phaseInfo?.status === 'skipped');
            }
          } catch (err) {
            debugLog(`[GenericAgent] Failed to check project state: ${err}`);
          }

          // If transcript is already parsed or phase is completed, prompt to transition phase
          if (transcriptAlreadyParsed || phaseAlreadyCompleted) {
            // Circuit breaker: If we've already prompted for transition_phase multiple times, force it
            const isTransitionAction = phaseAlreadyCompleted;
            if (isTransitionAction && this.lastPromptedAction === 'transition_phase') {
              this.consecutiveNoToolCallAttempts++;
            } else {
              // Reset counter if this is a different action
              this.consecutiveNoToolCallAttempts = 1;
              this.lastPromptedAction = isTransitionAction ? 'transition_phase' : 'complete_and_transition';
            }

            // Force transition if we've exceeded retry limit
            if (phaseAlreadyCompleted && this.consecutiveNoToolCallAttempts > GenericAgent.MAX_TRANSITION_RETRIES) {
              debugLog(`[GenericAgent] Circuit breaker triggered: Forcing transition_phase after ${this.consecutiveNoToolCallAttempts} failed attempts`);
              try {
                const { transitionToNextPhase } = await import('../../tasks/video/workflow/ProjectManager.js');
                const basePath = getCurrentProjectBasePath();
                const project = loadProject(basePath);
                if (project) {
                  const oldPhase = project.currentPhase;
                  const transitionResult = await transitionToNextPhase(project, basePath);
                  if (transitionResult.transitioned) {
                    const newPhase = transitionResult.project.currentPhase;
                    debugLog(`[GenericAgent] Circuit breaker: Successfully forced phase transition from ${oldPhase} to ${newPhase}`);
                    phaseLogger.phaseTransition(oldPhase, newPhase, `Circuit breaker: Auto-transitioned after ${this.consecutiveNoToolCallAttempts} retry attempts`);
                    // Reset counters
                    this.consecutiveNoToolCallAttempts = 0;
                    this.lastPromptedAction = null;
                    // Break out of the loop to continue with new phase
                    break;
                  } else {
                    debugLog(`[GenericAgent] Circuit breaker: Transition failed: ${transitionResult.reason}`);
                    // Fall through to normal prompt
                  }
                } else {
                  debugLog(`[GenericAgent] Circuit breaker: No project found`);
                  // Fall through to normal prompt
                }
              } catch (err) {
                debugLog(`[GenericAgent] Circuit breaker: Error forcing transition: ${err}`);
                // Fall through to normal prompt
              }
            }

            if (phaseAlreadyCompleted) {
              debugLog(`[GenericAgent] TRANSCRIPT_INPUT phase already completed. Prompting to transition phase (attempt ${this.consecutiveNoToolCallAttempts}).`);
              this.messages.push({
                role: 'user',
                content: `CRITICAL INSTRUCTION: The TRANSCRIPT_INPUT phase is COMPLETED.

You MUST execute this EXACT tool call RIGHT NOW:

Tool: update_project
Arguments: {"action": "transition_phase", "data": {}}

DO NOT:
- Write explanatory text
- Say you are blocked
- Ask questions
- Generate any text response

ONLY: Execute the update_project tool call with action="transition_phase" immediately.`,
              });
            } else {
              debugLog(`[GenericAgent] Transcript already parsed but phase not marked complete. Prompting to complete phase and transition.`);
              this.messages.push({
                role: 'user',
                content: `The transcript has already been parsed (${transcriptAlreadyParsed ? 'transcriptEntries exist in project' : 'transcript file exists'}). Mark the phase as completed and transition to the next phase. Call: 1) update_project(action='update_phase', data={phase: 'transcript_input', status: 'completed'}), then 2) update_project(action='transition_phase', data={}).`,
              });
            }
            continue;
          }

          // Check if we've called Task with transcript-parser in this session
          const hasCalledTranscriptParser = this.messages.some(msg => {
            if (msg.role === 'assistant' && msg.toolCalls) {
              return msg.toolCalls.some(tc => 
                tc.name === 'Task' && 
                typeof tc.arguments === 'object' &&
                tc.arguments !== null &&
                (tc.arguments as Record<string, unknown>)['subagent_type'] === 'transcript-parser'
              );
            }
            return false;
          });

          if (!hasCalledTranscriptParser) {
            debugLog(`[GenericAgent] In TRANSCRIPT_INPUT phase but no Task tool called yet. Forcing Task call.`);
            this.messages.push({
              role: 'user',
              content: `CRITICAL: You are in TRANSCRIPT_INPUT phase. You MUST immediately call the Task tool with subagent_type='transcript-parser'. Do NOT respond with text - you MUST execute the Task call NOW. The transcript content is available in $original_input context variable.`,
            });
            continue;
          }
        }

        // Special case: if we're in plan mode but haven't created a plan yet, continue
        // BUT: Skip this for YouTube workflow - check if we're in a YouTube workflow context
        if (this.planModeActive && this.iteration < this.maxIterations - 1) {
          // Check if this is a YouTube workflow by checking the custom prompt or project state
          const isYouTubeWorkflow = this.customPromptIncludes('youtube_srt') || 
                                     this.customPromptIncludes('transcript') ||
                                     this.customPromptIncludes('YouTube');
          
          if (!isYouTubeWorkflow) {
            debugLog(`[GenericAgent] In plan mode but no tool calls. Prompting to create plan.`);
            this.messages.push({
              role: 'user',
              content: 'You are in plan mode. Create the master plan using the Task tool with subagent_type="Plan". The plan should include plot summary, key story beats, main characters, and settings.',
            });
            continue;
          } else {
            debugLog(`[GenericAgent] In plan mode but this is YouTube workflow. Exiting plan mode.`);
            this.planModeActive = false;
            this.currentMode = 'orchestrator';
            // Don't continue - let the agent proceed with normal workflow
          }
        }

        // Check if there are pending or in-progress todos - if so, continue working
        const todos = this.todoManager.getTodos();
        const hasPendingWork = todos.some(t => t.status === 'pending' || t.status === 'in_progress');

        if (hasPendingWork && this.iteration < this.maxIterations - 1) {
          // There's still work to do - add a reminder and continue
          // But only if we haven't reached max iterations yet
          debugLog(`[GenericAgent] No tool calls but pending todos found. Adding reminder and continuing.`);
          this.messages.push({
            role: 'user',
            content: `You have pending tasks in your todo list. Please continue working on them. Use the appropriate tools to complete the remaining tasks.`,
          });
          // Continue the loop instead of breaking
          continue;
        }

        // No pending work or reached max iterations - we're done
        break;
      }

      // Reset circuit breaker counters when tool calls are made
      if (response.toolCalls.length > 0) {
        this.consecutiveNoToolCallAttempts = 0;
        this.lastPromptedAction = null;
      }

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        // Special handling for ask_user - pause execution
        if (toolCall.name === 'ask_user' || toolCall.name === 'AskUserQuestion') {
          const result = this.handleAskUser(toolCall);
          if (result) {
            this.emit({ type: 'agent_status', status: 'waiting', agentName: this.getEffectiveAgentName() });
            return result;
          }
          continue;
        }

        // Execute the tool
        const result = await this.executeTool(toolCall);
        const resultObj = result as Record<string, unknown>;

        // Check if tool is waiting for user input (dispatch_agent planning)
        if (resultObj['__awaiting_user_input']) {
          // Return waiting status - the planning loop will handle user response
          // Note: Plan is shown via ToolCallDisplay, don't duplicate in output
          return {
            status: 'waiting_for_user',
            output: '',
            todos: this.todoManager.getTodos(),
            pendingQuestion: resultObj['question'] as string,
            options: resultObj['options'] as Array<{ label: string; description?: string }>,
            autoApproveTimeoutMs: resultObj['autoApproveTimeoutMs'] as number | undefined,
          };
        }

        // Special handling for EnterPlanMode - after entering plan mode, continue the loop
        // so the agent can actually create the plan
        // BUT: Skip this for YouTube workflow
        if (toolCall.name === 'EnterPlanMode' && resultObj['status'] === 'entered_plan_mode') {
          // Check if this is a YouTube workflow
          const isYouTubeWorkflow = this.customPromptIncludes('youtube_srt') || 
                                     this.customPromptIncludes('transcript') ||
                                     this.customPromptIncludes('YouTube');
          
          if (isYouTubeWorkflow) {
            debugLog(`[GenericAgent] EnterPlanMode called for YouTube workflow - this should not happen. Exiting plan mode.`);
            this.planModeActive = false;
            this.currentMode = 'orchestrator';
            // Add tool result but don't prompt for Plan subagent
            const resultWithWarning = result as Record<string, unknown>;
            this.messages.push({
              role: 'tool',
              content: JSON.stringify({ ...resultWithWarning, warning: 'EnterPlanMode not needed for YouTube workflow. Proceed directly to TRANSCRIPT_INPUT phase.' }),
              toolCallId: toolCall.id,
              name: toolCall.name,
            });
            // Continue without prompting for Plan subagent
            continue;
          }
          
          debugLog(`[GenericAgent] Entered plan mode. Adding tool result and continuing to create plan.`);
          // Add tool result to messages
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: toolCall.id,
            name: toolCall.name,
          });
          // Add a prompt to encourage the agent to create the plan
          this.messages.push({
            role: 'user',
            content: 'You have entered plan mode. Now create the master plan using the Task tool with subagent_type="Plan". The plan should include plot summary, key story beats, main characters, and settings.',
          });
          // Continue the loop so the agent can create the plan
          continue;
        }

        // Add tool result to messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: toolCall.id,
          name: toolCall.name,
        });

        // CRITICAL: Check if tool execution transitioned us to COMPLETED phase
        try {
          const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
          const project = loadProject();
          if (project?.currentPhase === 'completed') {
            debugLog(`[GenericAgent] COMPLETED phase detected after tool execution. Stopping immediately.`);
            return {
              status: 'completed',
              output: 'Workflow complete. All videos and images have been generated successfully.',
              todos: this.todoManager.getTodos(),
            };
          }
        } catch (err) {
          debugLog(`[GenericAgent] Failed to check project phase after tool execution: ${err}`);
          // Continue if check fails
        }

        // Special handling: After transcript-parser Task completes, automatically check if parsing succeeded
        // and complete the phase if transcriptEntries exist
        const subagentType = (toolCall.arguments as Record<string, unknown>)?.['subagent_type'] as string | undefined;
        if (toolCall.name === 'Task' && subagentType === 'transcript-parser' && resultObj['status'] === 'completed') {
          try {
            const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
            const project = loadProject();
            if (project && project.transcriptEntries && project.transcriptEntries.length > 0) {
              // Transcript parsing succeeded - automatically complete phase and transition
              debugLog(`[GenericAgent] Transcript parsing succeeded (${project.transcriptEntries.length} entries). Automatically completing phase.`);
              
              // Check if phase is already completed
              const phaseInfo = project.phases?.transcript_input;
              const isPhaseCompleted = phaseInfo?.status === 'completed' || phaseInfo?.status === 'skipped';
              
              if (!isPhaseCompleted) {
                // Automatically mark phase as completed and transition
                this.messages.push({
                  role: 'user',
                  content: `CRITICAL: Transcript parsing completed successfully with ${project.transcriptEntries.length} entries. You MUST immediately: 1) Call update_project(action='update_phase', data={phase: 'transcript_input', status: 'completed'}), then 2) Call update_project(action='transition_phase', data={}) to move to Planning phase. Do NOT ask the user anything - complete the phase transition automatically.`,
                });
                // Continue loop to process these update_project calls
                continue;
              } else {
                // Phase already marked complete, just transition
                debugLog(`[GenericAgent] Transcript parsing completed. Phase already marked complete. Prompting to transition.`);
                this.messages.push({
                  role: 'user',
                  content: `Transcript parsing completed. Phase is already marked complete. You MUST call update_project(action='transition_phase', data={}) to move to Planning phase. Do NOT ask the user anything.`,
                });
                continue;
              }
            } else {
              // Parsing may have failed - check the output for clues
              const output = resultObj['output'] as string | undefined;
              if (output && output.includes('No output generated')) {
                debugLog(`[GenericAgent] WARNING: Transcript parsing returned "No output generated". This may indicate the parse_srt tool was not called by the subagent. Checking if parse_srt tool is available.`);
                // Check if parse_srt tool exists
                const parseSrtTool = this.tools.get('parse_srt');
                if (!parseSrtTool) {
                  debugLog(`[GenericAgent] ERROR: parse_srt tool is not registered in orchestrator tools!`);
                } else {
                  debugLog(`[GenericAgent] parse_srt tool is registered. Subagent may not have called it.`);
                }
              }
            }
          } catch (err) {
            debugLog(`[GenericAgent] Failed to check transcript parsing result: ${err}`);
          }
        }


        // Special handling: After transition_phase tool call, check if transition failed
        // due to Planning phase being in_progress but deliverables exist
        if (toolCall.name === 'update_project' && 
            (toolCall.arguments as Record<string, unknown>)?.['action'] === 'transition_phase') {
          const resultObj = result as Record<string, unknown>;
          if (resultObj['transitioned'] === false && 
              typeof resultObj['next_action'] === 'string' &&
              resultObj['next_action'].includes('Phase transition not needed')) {
            try {
              const { loadProject, checkPlanningDeliverables } = await import('../../tasks/video/workflow/ProjectManager.js');
              const project = loadProject();
              if (project?.currentPhase === 'planning') {
                const planningDeliverablesExist = checkPlanningDeliverables(project);
                const phaseStatus = project.phases?.planning?.status;
                if (planningDeliverablesExist && phaseStatus !== 'completed' && phaseStatus !== 'skipped') {
                  // Planning phase deliverables are complete but phase is not marked as completed
                  debugLog(`[GenericAgent] Planning phase deliverables exist but phase is not marked as completed. Prompting to mark phase as completed first.`);
                  this.messages.push({
                    role: 'user',
                    content: `Planning phase deliverables are complete but phase is not marked as completed. You MUST first call update_project(action='update_phase', data={phase: 'planning', status: 'completed'}), then call transition_phase.`,
                  });
                  continue;
                }
              }
            } catch (err) {
              debugLog(`[GenericAgent] Failed to check Planning phase deliverables: ${err}`);
            }
          }
        }
      }
    }

    // Check if max iterations reached
    if (this.iteration >= this.maxIterations) {
      this.emit({ type: 'agent_status', status: 'error', agentName: this.getEffectiveAgentName() });
      return {
        status: 'interrupted',
        output: 'Agent reached maximum iterations without completing.',
        todos: this.todoManager.getTodos(),
        error: 'max_iterations_reached',
      };
    }

    // Emit completed status
    this.emit({ type: 'agent_status', status: 'completed', agentName: this.getEffectiveAgentName() });
    this.emit({ type: 'agent_text', text: finalOutput, isFinal: true });

    return {
      status: 'completed',
      output: finalOutput,
      todos: this.todoManager.getTodos(),
    };
  }

  /**
   * Get the current todo list.
   */
  getTodos(): ExpandableTodoItem[] {
    return this.todoManager.getTodos();
  }

  /**
   * Check if agent is waiting for user input.
   */
  isWaiting(): boolean {
    return this.waitingForUser;
  }

  /**
   * Get the pending question if waiting.
   */
  getPendingQuestion(): string | undefined {
    return this.pendingQuestion;
  }

  /**
   * Detect if the agent is in a loop calling the same tool repeatedly.
   * Returns an object with warning message and severity if looping detected, null otherwise.
   */
  private detectLoop(toolName: string, args: Record<string, unknown>): { message: string; isHardError: boolean } | null {
    // Create a signature for this tool call (tool + key args)
    const argSignature = JSON.stringify(args).slice(0, 100); // Limit to prevent huge signatures
    const signature = `${toolName}:${argSignature}`;

    // Special handling for transition_phase: allow more retries since it has auto-recovery logic
    // transition_phase can auto-complete phases and retry transitions, so be more lenient
    const isTransitionPhase = toolName === 'update_project' && args['action'] === 'transition_phase';
    
    // For transition_phase, use higher thresholds to allow auto-recovery to work
    const threshold = isTransitionPhase ? 5 : GenericAgent.LOOP_THRESHOLD;
    const maxWarnings = isTransitionPhase ? 5 : GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS;

    // Add to recent calls
    this.recentToolCalls.push(signature);

    // Keep only the detection window
    if (this.recentToolCalls.length > GenericAgent.LOOP_DETECTION_WINDOW) {
      this.recentToolCalls.shift();
    }

    // Count occurrences of this exact call in the window
    const count = this.recentToolCalls.filter(s => s === signature).length;

    if (count >= threshold) {
      this.consecutiveLoopWarnings++;

      // After too many warnings, force stop
      if (this.consecutiveLoopWarnings >= maxWarnings) {
        return {
          message: `LOOP BLOCKED: You've called ${toolName} with similar arguments ${count} times and ignored ` +
            `${this.consecutiveLoopWarnings} warnings. This tool call is being blocked. ` +
            `You MUST stop calling tools and provide a final response to the user.`,
          isHardError: true,
        };
      }

      return {
        message: `LOOP DETECTED (warning ${this.consecutiveLoopWarnings}/${maxWarnings}): ` +
          `You've called ${toolName} with similar arguments ${count} times recently. ` +
          `This suggests you're stuck in a loop. Please either:\n` +
          `1. Complete the current task and stop (no more tool calls)\n` +
          `2. Use ask_user to get clarification\n` +
          `3. Try a different approach\n` +
          `After ${maxWarnings} warnings, the tool will be blocked.`,
        isHardError: false,
      };
    }

    // Also check for rapid tool repetition (same tool called consecutively)
    // But be more lenient for transition_phase since it may need multiple attempts for auto-recovery
    const consecutiveThreshold = isTransitionPhase ? 6 : 4;
    const lastFew = this.recentToolCalls.slice(-consecutiveThreshold);
    const sameToolCount = lastFew.filter(s => s.startsWith(toolName + ':')).length;
    if (sameToolCount >= consecutiveThreshold) {
      this.consecutiveLoopWarnings++;

      if (this.consecutiveLoopWarnings >= maxWarnings) {
        return {
          message: `LOOP BLOCKED: You've called ${toolName} ${consecutiveThreshold}+ times in a row and ignored warnings. ` +
            `This tool call is being blocked. Provide a final response to the user.`,
          isHardError: true,
        };
      }

      return {
        message: `WARNING (${this.consecutiveLoopWarnings}/${maxWarnings}): ` +
          `You've called ${toolName} ${consecutiveThreshold} times in a row. ` +
          `If you're done with the task, stop calling tools and provide a final response.`,
        isHardError: false,
      };
    }

    // Reset consecutive warnings if this call is not triggering a loop
    this.consecutiveLoopWarnings = 0;
    return null;
  }

  /**
   * Execute a tool call with framework-enforced confirmation for complex tools.
   */
  private async executeTool(toolCall: ToolCall): Promise<unknown> {
    // Emit tool call event first (before any early returns)
    this.emit({
      type: 'tool_call',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      agentName: this.getEffectiveAgentName(),
    });

    // Check for looping (skip for think + TodoWrite - these may be called frequently)
    if (toolCall.name !== 'think' && !isBuiltinTodoTool(toolCall.name)) {
      // Reset loop detection if agent is trying a different tool or different arguments
      // This allows recovery from blocked states
      const argSignature = JSON.stringify(toolCall.arguments).slice(0, 100);
      const currentSignature = `${toolCall.name}:${argSignature}`;
      
      if (this.lastBlockedTool && this.lastBlockedSignature) {
        // If trying a different tool, reset blocked state
        if (toolCall.name !== this.lastBlockedTool) {
          debugLog(`[GenericAgent] Different tool detected (${toolCall.name} vs ${this.lastBlockedTool}), resetting loop detection`);
          this.consecutiveLoopWarnings = 0;
          this.lastBlockedTool = null;
          this.lastBlockedSignature = null;
          // Clear recent calls to give fresh start
          this.recentToolCalls = [];
        }
        // If trying same tool but different arguments, allow it (might be recovery attempt)
        else if (currentSignature !== this.lastBlockedSignature) {
          debugLog(`[GenericAgent] Same tool (${toolCall.name}) but different arguments, allowing attempt`);
          // Reduce warnings to allow recovery
          this.consecutiveLoopWarnings = Math.max(0, this.consecutiveLoopWarnings - 1);
        }
      }
      
      const loopResult = this.detectLoop(toolCall.name, toolCall.arguments);
      if (loopResult) {
        const resultStatus = loopResult.isHardError ? 'loop_blocked' : 'loop_warning';
        
        // Track blocked tool for recovery detection
        if (loopResult.isHardError) {
          this.lastBlockedTool = toolCall.name;
          this.lastBlockedSignature = currentSignature;
        }
        
        // Provide specific recovery hints for transition_phase
        let recoveryHint: string | undefined;
        if (loopResult.isHardError) {
          if (toolCall.name === 'update_project' && toolCall.arguments['action'] === 'transition_phase') {
            recoveryHint = 'CRITICAL: You are blocked from calling transition_phase. To recover:\n' +
              '1. First call update_project with action="update_phase" and data={phase: "transcript_input", status: "completed"} to mark the phase as complete\n' +
              '2. Then you can try transition_phase again, OR\n' +
              '3. Simply proceed with the next phase work - the phase transition will happen automatically when needed.\n' +
              'Do NOT keep calling transition_phase with the same arguments.';
          } else {
            recoveryHint = 'Try using a different tool or different arguments to reset loop detection.';
          }
        }
        
        const warningResult = {
          status: resultStatus,
          warning: loopResult.message,
          tool: toolCall.name,
          blocked: loopResult.isHardError,
          recovery_hint: recoveryHint,
        };
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: warningResult,
          isError: loopResult.isHardError,
          agentName: this.getEffectiveAgentName(),
        });
        return warningResult;
      }
      
      // If loop detection passed, reset warnings and blocked state (tool call is proceeding)
      // This allows the agent to break out of loops by using different tools or arguments
      this.consecutiveLoopWarnings = 0;
      this.lastBlockedTool = null;
      this.lastBlockedSignature = null;
    }

    // Handle built-in todo tools specially (no handler required)
    if (isBuiltinTodoTool(toolCall.name)) {
      const result = this.handleTodoTool(toolCall);
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle plan mode tools (Claude SDK style)
    if (isPlanModeTool(toolCall.name)) {
      const result = this.handlePlanModeTool(toolCall.name);
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle Task tool specially - unified subagent entrypoint (Claude SDK style)
    if (isTaskTool(toolCall.name)) {
      // CRITICAL: Block alternative workflows during video_generation phase
      // Prevent Task calls that try to create scenes or other content when video generation should be complete
      try {
        const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
        const project = loadProject();
        
        if (project?.currentPhase === 'video_generation') {
          const args = toolCall.arguments as Record<string, unknown>;
          const subagentType = args['subagent_type'] as string | undefined;
          const contentType = args['content_type'] as string | undefined;
          
          // Block content-creator with scene content_type during video_generation
          // Also block other content creation workflows that shouldn't happen during video generation
          if (subagentType === 'content-creator' && (contentType === 'scene' || contentType === 'plot' || contentType === 'story')) {
            const errorMsg = `ERROR: Cannot use Task with content-creator and content_type="${contentType}" during video_generation phase. The video_generation phase should be marked as complete after generate_all_videos completes, not create new content. If generate_all_videos failed, mark the phase as complete anyway and do not try alternative workflows.`;
            
            debugLog(`[GenericAgent] ${errorMsg}`);
            
            const errorResult = {
              status: 'error',
              error: errorMsg,
              toolCallId: toolCall.id,
              message: 'Alternative workflow blocked during video_generation phase. Mark the phase as complete instead.',
            };
            
            this.emit({
              type: 'tool_result',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: errorResult,
              isError: true,
              agentName: this.getEffectiveAgentName(),
            });
            
            return errorResult;
          }
        }
      } catch (err) {
        debugLog(`[GenericAgent] Failed to check project phase for Task validation: ${err}`);
        // Continue with Task execution if check fails (fail open to avoid breaking normal operation)
      }
      
      const result = await this.handleTask(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if subagent needs user verification (same as dispatch_agent)
      if (resultObj['status'] === 'awaiting_verification' || resultObj['status'] === 'awaiting_approval' || resultObj['status'] === 'awaiting_prompt_approval') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        const questionOptions = resultObj['options'] as Array<{ label: string; description?: string }>;
        const questionTimeout = resultObj['autoApproveTimeoutMs'] as number | undefined;

        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: questionOptions,
          autoApproveTimeoutMs: questionTimeout,
          context: resultObj['prompt'] as string, // Handle prompt context for image/video agents
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        const markedResult = typeof result === 'object' && result !== null
          ? { __awaiting_user_input: true, ...result }
          : { __awaiting_user_input: true, result };
        return markedResult;
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle dispatch_agent specially - spawn a sub-agent for planning
    if (toolCall.name === 'dispatch_agent') {
      const result = await this.handleDispatchAgent(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if planning needs user verification
      if (resultObj['status'] === 'awaiting_verification') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        const questionOptions = resultObj['options'] as Array<{ label: string; description?: string }>;
        const questionTimeout = resultObj['autoApproveTimeoutMs'] as number | undefined;
        debugLog(`[GenericAgent] dispatch_agent result: ${JSON.stringify({
          status: resultObj['status'],
          question: (resultObj['question'] as string)?.slice(0, 50),
          optionsCount: questionOptions?.length,
          options: questionOptions,
          autoApproveTimeoutMs: questionTimeout,
        }, null, 2)}`);
        debugLog(`[GenericAgent] dispatch_agent emitting question event with options: ${JSON.stringify(questionOptions)}`);
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: questionOptions,
          autoApproveTimeoutMs: questionTimeout,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        const markedResult = typeof result === 'object' && result !== null
          ? { __awaiting_user_input: true, ...result }
          : { __awaiting_user_input: true, result };
        return markedResult;
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle generate_content - deterministic content generation with automatic context injection
    if (toolCall.name === 'generate_content') {
      // CRITICAL: Block alternative workflows during video_generation phase
      // Prevent generate_content calls that try to create scenes or other content when video generation should be complete
      try {
        const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
        const project = loadProject();
        
        if (project?.currentPhase === 'video_generation') {
          const args = toolCall.arguments as Record<string, unknown>;
          const contentType = args['content_type'] as string | undefined;
          
          // Block scene, plot, story content generation during video_generation
          // These should not be created during video generation - the phase should just be marked complete
          if (contentType === 'scene' || contentType === 'plot' || contentType === 'story' || contentType === 'character' || contentType === 'setting') {
            const errorMsg = `ERROR: Cannot use generate_content with content_type="${contentType}" during video_generation phase. The video_generation phase should be marked as complete after generate_all_videos completes, not create new content. If generate_all_videos failed, mark the phase as complete anyway and do not try alternative workflows.`;
            
            debugLog(`[GenericAgent] ${errorMsg}`);
            
            const errorResult = {
              status: 'error',
              error: errorMsg,
              toolCallId: toolCall.id,
              message: 'Alternative workflow blocked during video_generation phase. Mark the phase as complete instead.',
            };
            
            this.emit({
              type: 'tool_result',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              result: errorResult,
              isError: true,
              agentName: this.getEffectiveAgentName(),
            });
            
            return errorResult;
          }
        }
      } catch (err) {
        debugLog(`[GenericAgent] Failed to check project phase for generate_content validation: ${err}`);
        // Continue with generate_content execution if check fails (fail open to avoid breaking normal operation)
      }
      const args = toolCall.arguments;
      const contentType = args['content_type'] as string;
      const name = args['name'] as string | undefined;
      const sceneNumber = args['scene_number'] as number | undefined;
      const taskDescription = args['task_description'] as string | undefined;

      if (!contentType) {
        return { error: 'content_type is required for generate_content' };
      }

      // Loop detection: prevent repeated calls for the same character/setting
      if ((contentType === 'character' || contentType === 'setting') && name) {
        const callKey = `${contentType}:${name.toLowerCase()}`;
        const recentCalls = this.contentGenerationHistory.filter(call => call === callKey);

        // Strict threshold for content generation - 2 calls is suspicious, 3 is a hard stop
        if (recentCalls.length >= 2) {
          debugLog(`[GenericAgent] LOOP DETECTED: generate_content called ${recentCalls.length + 1} times for ${callKey}. Stopping to prevent infinite loop.`);
          return {
            error: `Loop detected: ${contentType} "${name}" has been generated ${recentCalls.length + 1} times. Check if it already exists using read_project() and skip if it does.`,
            suggestion: `Call read_project() to check if "${name}" already exists in project.${contentType === 'character' ? 'characters' : 'settings'}. If it exists, skip generation and move to the next item.`,
          };
        }

        this.contentGenerationHistory.push(callKey);
        // Keep history manageable but long enough to catch loops across many steps
        if (this.contentGenerationHistory.length > 50) {
          this.contentGenerationHistory.shift();
        }
      }

      // Get the required contexts for this content type
      const requiredContexts = CONTENT_TYPE_CONTEXTS[contentType] || [];
      debugLog(`[GenericAgent] generate_content: content_type=${contentType}, required_contexts=${requiredContexts.join(', ')}`);

      // Build the output file path
      let outputFile = CONTENT_TYPE_OUTPUT_FILES[contentType] || `plans/${contentType}.md`;
      if ((contentType === 'character' || contentType === 'setting') && name) {
        // For characters and settings, use flat structure: agent/characters/max.md or agent/settings/dusty-village.md
        const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        outputFile = `${outputFile.replace(/\/$/, '')}/${safeName}.md`;
      } else if (contentType === 'scene' && sceneNumber !== undefined) {
        // For scenes, save to individual scene folders: agent/scenes/scene-XXX/scene.md
        const sceneFolder = `scene-${String(sceneNumber).padStart(3, '0')}`;
        outputFile = `agent/scenes/${sceneFolder}/scene.md`;
      } else if (contentType === 'scene') {
        // If scene_number not provided, still use the default (for backward compatibility)
        // But warn that scene_number should be provided
        debugLog(`[GenericAgent] WARNING: generate_content for scene without scene_number. Using default path: ${outputFile}`);
      }

      // Build the task description
      const task = taskDescription ||
        (name ? `Create ${contentType} profile for: ${name}` : `Create ${contentType} content`);

      // Create a synthetic tool call for handleDispatchContentAgent
      const syntheticToolCall: ToolCall = {
        id: toolCall.id,
        name: 'dispatch_content_agent',
        arguments: {
          task,
          content_type: contentType,
          context_refs: requiredContexts,
          output_file: outputFile,
        },
      };

      debugLog(`[GenericAgent] generate_content dispatching with context_refs: ${JSON.stringify(requiredContexts)}`);

      // For character/setting generation, check if it already exists first
      if ((contentType === 'character' || contentType === 'setting') && name) {
        try {
          const { loadProject } = await import('../../tasks/video/workflow/ProjectManager.js');
          const project = loadProject();
          if (project) {
            const items = contentType === 'character' ? project.characters : project.settings;
            const existing = items.find(item =>
              item.name.toLowerCase() === name.toLowerCase()
            );
            if (existing) {
              debugLog(`[GenericAgent] ${contentType} "${name}" already exists in project. Skipping generation.`);
              return {
                status: 'skipped',
                message: `${contentType} "${name}" already exists in project`,
                content_type: contentType,
                name: name,
                suggestion: `Use read_project() to see existing ${contentType}s. Skip generating ${contentType}s that already exist.`,
              };
            }
          }
        } catch (err) {
          debugLog(`[GenericAgent] WARNING: Failed to check for existing ${contentType}: ${err}. Proceeding with generation.`);
        }
      }

      const result = await this.handleDispatchContentAgent(syntheticToolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if content creation failed with an error
      if (resultObj['error']) {
        debugLog(`[GenericAgent] generate_content failed: ${resultObj['error']}`);
        // For character/setting errors, suggest checking if it already exists
        if ((contentType === 'character' || contentType === 'setting') && name) {
          return {
            ...resultObj,
            suggestion: `The ${contentType} "${name}" could not be generated. Check if it already exists using read_project(), or verify the name is correct in the story context.`,
          };
        }
        return result; // Return error directly to orchestrator
      }

      // Check if content needs user verification
      if (resultObj['status'] === 'awaiting_verification') {
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        const questionOptions = resultObj['options'] as Array<{ label: string; description?: string }>;
        const questionTimeout = resultObj['autoApproveTimeoutMs'] as number | undefined;
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: questionOptions,
          autoApproveTimeoutMs: questionTimeout,
        });

        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        return { __awaiting_user_input: true, ...resultObj };
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle dispatch_content_agent specially - spawn a sub-agent for creative content
    if (toolCall.name === 'dispatch_content_agent') {
      const result = await this.handleDispatchContentAgent(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if content needs user verification
      if (resultObj['status'] === 'awaiting_verification') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        const questionOptions = resultObj['options'] as Array<{ label: string; description?: string }>;
        const questionTimeout = resultObj['autoApproveTimeoutMs'] as number | undefined;
        debugLog(`[GenericAgent] dispatch_content_agent emitting question event with options: ${JSON.stringify(questionOptions)}`);
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: questionOptions,
          autoApproveTimeoutMs: questionTimeout,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        const markedResult = typeof result === 'object' && result !== null
          ? { __awaiting_user_input: true, ...result }
          : { __awaiting_user_input: true, result };
        return markedResult;
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle dispatch_image_agent specially - sub-agent for image prompt crafting + generation
    if (toolCall.name === 'dispatch_image_agent') {
      const result = await this.handleDispatchImageAgent(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if image gen needs user verification
      if (resultObj['status'] === 'awaiting_prompt_approval') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: resultObj['options'] as Array<{ label: string; description?: string }>,
          autoApproveTimeoutMs: resultObj['autoApproveTimeoutMs'] as number | undefined,
          context: resultObj['prompt'] as string,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        const markedResult = typeof result === 'object' && result !== null
          ? { __awaiting_user_input: true, ...result }
          : { __awaiting_user_input: true, result };
        return markedResult;
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    // Handle dispatch_video_agent specially - sub-agent for video generation
    if (toolCall.name === 'dispatch_video_agent') {
      const result = await this.handleDispatchVideoAgent(toolCall);
      const resultObj = result as Record<string, unknown>;

      // Check if video gen needs user verification
      if (resultObj['status'] === 'awaiting_approval') {
        // Emit tool result first
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });

        // Set up waiting state for user input
        this.waitingForUser = true;
        this.pendingQuestion = resultObj['question'] as string;

        // Emit question event with options and auto-approve timeout
        this.emit({
          type: 'question',
          question: resultObj['question'] as string,
          isConfirmation: false,
          options: resultObj['options'] as Array<{ label: string; description?: string }>,
          autoApproveTimeoutMs: resultObj['autoApproveTimeoutMs'] as number | undefined,
        });

        // Emit status change
        this.emit({
          type: 'agent_status',
          status: 'waiting',
          agentName: this.getEffectiveAgentName(),
        });

        // Return special marker to indicate we're pausing for user input
        const markedResult = typeof result === 'object' && result !== null
          ? { __awaiting_user_input: true, ...result }
          : { __awaiting_user_input: true, result };
        return markedResult;
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    }

    const tool = this.tools.get(toolCall.name);
    if (!tool?.handler) {
      const errorResult = { error: `Unknown tool: ${toolCall.name}` };
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: errorResult,
        isError: true,
        agentName: this.getEffectiveAgentName(),
      });
      return errorResult;
    }

    // Framework-enforced confirmation for complex tools
    if (isComplexTool(toolCall.name)) {
      if (!this.pendingConfirmations.has(toolCall.name)) {
        // First call - store args and return "needs confirmation"
        this.pendingConfirmations.set(toolCall.name, toolCall.arguments);
        const confirmResult = {
          status: 'needs_confirmation',
          tool: toolCall.name,
          args: toolCall.arguments,
          message: `Call ask_user(is_confirmation=true) to confirm ${toolCall.name}, then call again.`,
        };
        this.emit({
          type: 'tool_result',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: confirmResult,
          isError: false,
          agentName: this.getEffectiveAgentName(),
        });
        return confirmResult;
      } else {
        // Second call after confirmation - execute and clear pending
        this.pendingConfirmations.delete(toolCall.name);
      }
    }

    // Execute the tool handler
    try {
      const result = await Promise.resolve(tool.handler(toolCall.arguments));

      // Check for phase transition info in result and emit event
      const resultObj = result as Record<string, unknown> | null;
      if (resultObj && typeof resultObj === 'object' && '_phaseTransition' in resultObj) {
        const phaseTransition = resultObj['_phaseTransition'] as {
          fromPhase: string;
          toPhase: string;
          displayName?: string;
          description?: string;
        };
        this.emit({
          type: 'phase_transition',
          fromPhase: phaseTransition.fromPhase,
          toPhase: phaseTransition.toPhase,
          displayName: phaseTransition.displayName,
          description: phaseTransition.description,
        });
      }

      // Reset loop detection on successful tool execution
      // This allows the agent to break out of loops by using different tools
      const resultStatus = resultObj?.['status'] as string | undefined;
      const isLoopBlocked = resultStatus === 'loop_blocked' || resultStatus === 'loop_warning';
      const autoRecovered = resultObj?.['_auto_recovered'] as boolean | undefined;
      
      if (!isLoopBlocked) {
        // Successful tool call - reset loop detection to allow progress
        // Also reset if auto-recovery happened (indicates the tool fixed itself)
        if (resultStatus === 'success' || autoRecovered) {
          this.consecutiveLoopWarnings = 0;
          // Clear recent tool calls on success or auto-recovery to break loop
          this.recentToolCalls = [];
          // Clear blocked state on success
          this.lastBlockedTool = null;
          this.lastBlockedSignature = null;
        } else {
          // Partial success - reduce warnings but don't clear history
          this.consecutiveLoopWarnings = Math.max(0, this.consecutiveLoopWarnings - 1);
          // Clear recent tool calls if this is a different tool (helps break loops when switching)
          if (this.recentToolCalls.length > 0) {
            const lastTool = this.recentToolCalls[this.recentToolCalls.length - 1]?.split(':')[0];
            if (lastTool !== toolCall.name) {
              // Different tool - clear recent calls and blocked state to break loop
              this.recentToolCalls = [];
              this.lastBlockedTool = null;
              this.lastBlockedSignature = null;
            }
          }
        }
      }

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      return result;
    } catch (error) {
      const errorResult = { error: String(error), tool: toolCall.name };
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: errorResult,
        isError: true,
        agentName: this.getEffectiveAgentName(),
      });
      return errorResult;
    }
  }

  /**
   * Handle Task tool - launches a subagent by subagent_type.
   * For now, maps to existing internal sub-agent handlers so we can migrate incrementally.
   */
  private async handleTask(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const subagentType = args['subagent_type'] as string | undefined;

    if (!subagentType) {
      return { error: 'Task requires subagent_type' };
    }

    // Incremental compatibility mapping onto existing sub-agent handlers.
    if (subagentType === 'Plan') {
      const isYouTubeWorkflow = this.customPromptIncludes('youtube_srt') ||
        this.customPromptIncludes('transcript') ||
        this.customPromptIncludes('YouTube');

      if (isYouTubeWorkflow) {
        return {
          error: 'Plan subagent is disabled for YouTube transcript workflows.',
          suggestion: 'Use Task with subagent_type="content-planner" to create the strategic content plan.',
        };
      }
      return await this.handleDispatchAgent({
        ...toolCall,
        name: 'dispatch_agent',
      });
    }

    if (subagentType === 'Explore') {
      return await this.handleDispatchExploreAgent(toolCall);
    }

    if (subagentType === 'content-creator') {
      return await this.handleDispatchContentAgent({
        ...toolCall,
        name: 'dispatch_content_agent',
      });
    }

    if (subagentType === 'image-generator') {
      // Image-generator needs generate_image and wait_for_job tools
      // Pass the tools from the main registry to the subagent
      return await this.handleDispatchImageGeneratorSubagent(toolCall);
    }

    if (subagentType === 'video-assembler') {
      return await this.handleDispatchVideoAgent({
        ...toolCall,
        name: 'dispatch_video_agent',
      });
    }

    if (subagentType === 'transcript-parser') {
      return await this.handleDispatchTranscriptParser({
        ...toolCall,
        name: 'dispatch_transcript_parser',
      });
    }

    if (subagentType === 'content-planner') {
      return await this.handleDispatchPlacementPlanner({
        ...toolCall,
        name: 'dispatch_placement_planner',
      });
    }

    if (subagentType === 'image-placer') {
      return await this.handleDispatchImagePlacer({
        ...toolCall,
        name: 'dispatch_image_placer',
      });
    }

    if (subagentType === 'video-placer') {
      return await this.handleDispatchVideoPlacer({
        ...toolCall,
        name: 'dispatch_video_placer',
      });
    }

    if (subagentType === 'infographics-placer') {
      return await this.handleDispatchInfographicsPlacer({
        ...toolCall,
        name: 'dispatch_infographics_placer',
      });
    }

    if (subagentType === 'video-replacer') {
      return await this.handleDispatchVideoReplacer({
        ...toolCall,
        name: 'dispatch_video_replacer',
      });
    }

    return { error: `Unsupported subagent_type: ${subagentType}` };
  }

  private handlePlanModeTool(toolName: string): Record<string, unknown> {
    if (toolName === 'EnterPlanMode') {
      this.planModeActive = true;
      this.currentMode = 'planning';
      return { status: 'entered_plan_mode' };
    }

    // ExitPlanMode
    this.planModeActive = false;
    this.currentMode = 'orchestrator';
    return { status: 'exited_plan_mode' };
  }

  /**
   * Handle built-in todo management tool.
   */
  private handleTodoTool(toolCall: ToolCall): unknown {
    const args = toolCall.arguments;
    const merge = (args['merge'] as boolean | undefined) ?? false;
    const todos = (args['todos'] as Array<Record<string, unknown>> | undefined) ?? [];

    // Claude SDK guidance: never create single-item todo lists.
    if (todos.length < 2) {
      return {
        error: 'Never create single-item todo lists. If you only have one task, just do it directly.',
      };
    }

    // Check for tool call patterns in todo content (forbidden)
    const toolCallPatterns = [
      /\b(dispatch_\w+|update_project|read_project|write_file|read_file|todo_write|TodoWrite|ask_user|AskUserQuestion)\b/i,
      /\baction:\s*["']?\w+["']?/i,
      /\buse\s+(the\s+)?[\w_]+\s+tool/i,
      /\bcall\s+[\w_]+/i,
    ];

    for (const todo of todos) {
      const content = (todo['content'] as string) || '';
      for (const pattern of toolCallPatterns) {
        if (pattern.test(content)) {
          return {
            error: `Todo "${content.slice(0, 50)}..." contains tool/function references. Todos should describe WHAT to accomplish, not HOW.`,
            suggestion: 'Rewrite todos to be task-focused. Good: "Create character profile for Alice". Bad: "Use dispatch_content_agent to create Alice".',
          };
        }
      }
    }

    // Apply todo updates.
    // - merge=false: replace list (preserving any existing completed items via manager logic)
    // - merge=true: merge by id onto existing items
    const result = merge
      ? this.todoManager.mergeTodosById(todos)
      : this.todoManager.writeTodos(todos);

    const updatedTodos = this.todoManager.getTodos();
    debugLog(`[GenericAgent] handleTodoTool: merge=${merge}, inputTodos=${todos.length}, resultTodos=${updatedTodos.length}`);
    debugLog(`[GenericAgent] handleTodoTool emitting todo_update with ${updatedTodos.length} todos: ${JSON.stringify(updatedTodos.map(t => ({ id: t.id, status: t.status, content: t.content?.slice(0, 30) })))}`);

    // Emit todo update event
    this.emit({
      type: 'todo_update',
      todos: updatedTodos,
      agentName: this.getEffectiveAgentName(),
    });

    return result;
  }

  // State for dispatch_agent sub-agent planning loop
  private planningState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentPlan: string;
    iterations: number;
    /** Tool call ID for streaming events */
    toolCallId: string;
    /** Output file path for saving the plan */
    outputFile?: string;
  } | null = null;

  // State for dispatch_content_agent sub-agent (creative content generation)
  private contentState: {
    active: boolean;
    task: string;
    contentType: ContentType;
    context?: string;
    outputFile?: string;
    messages: Message[];
    currentContent: string;
    iterations: number;
    /** Tool call ID for streaming events */
    toolCallId: string;
  } | null = null;

  // State for dispatch_image_agent sub-agent (image prompt planning + generation)
  private imageGenState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentPrompt: string;
    negativePrompt: string;
    aspectRatio: string;
    iterations: number;
    /** Parameters passed from parent for generate_image */
    imageParams: {
      scene_number: number;
      image_type?: 'scene' | 'character_ref' | 'setting_ref';
      character_name?: string;
      setting_name?: string;
    };
    /** Reference images for consistency (used for scene generation) */
    referenceImages?: Array<{
      image_id: string;
      type: 'character' | 'setting';
      name: string;
    }>;
    /** Generation mode determined by image_type and reference availability */
    generationMode: 'text_to_image' | 'image_text_to_image';
    /** Tool call ID for streaming events */
    toolCallId: string;
  } | null = null;

  // State for dispatch_video_agent sub-agent (video generation)
  // Note: sceneImageArtifactId is optional for YouTube workflow (VIDEO_GENERATION phase)
  private videoGenState: {
    active: boolean;
    task: string;
    sceneNumber: number;
    sceneImageArtifactId: string | undefined; // Optional for YouTube workflow
    motionDescription?: string;
    context?: string;
    messages: Message[];
    currentParams: {
      duration: number;
      fps: number;
      motionStrength: number;
    };
    iterations: number;
    /** Tool call ID for streaming events */
    toolCallId: string;
  } | null = null;

  // State for transcript parsing sub-agent
  private transcriptParserState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentOutput: string;
    iterations: number;
    toolCallId: string;
  } | null = null;

  // State for placement planning sub-agent
  private placementPlannerState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentOutput: string;
    iterations: number;
    toolCallId: string;
    outputFile?: string;
  } | null = null;

  // State for image placement sub-agent
  private imagePlacerState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentOutput: string;
    iterations: number;
    toolCallId: string;
    outputFile?: string;
  } | null = null;

  // State for video placement sub-agent
  private videoPlacerState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentOutput: string;
    iterations: number;
    toolCallId: string;
    outputFile?: string;
  } | null = null;

  // State for infographics placement sub-agent
  private infographicsPlacerState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentOutput: string;
    iterations: number;
    toolCallId: string;
    outputFile?: string;
  } | null = null;

  // State for video replacement sub-agent
  private videoReplacerState: {
    active: boolean;
    task: string;
    context?: string;
    messages: Message[];
    currentOutput: string;
    iterations: number;
    toolCallId: string;
  } | null = null;

  /**
   * Handle dispatch_agent tool - spawns a sub-agent for planning.
   * The sub-agent handles the full plan verification loop with the user.
   * It keeps iterating until the user approves the plan.
   */
  private async handleDispatchAgent(toolCall: ToolCall): Promise<unknown> {
    // Set mode for UI display
    this.currentMode = 'planning';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_agent' };
    }

    // Resolve all context_refs into a combined context
    const contextParts: Array<{ variableName: string; label: string; content: string }> = [];

    if (contextRefs && contextRefs.length > 0) {
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push({
            variableName: ref,
            label: stored.label,
            content: stored.content,
          });
          debugLog(`[GenericAgent] Resolved context_ref ${ref} for planning agent (${stored.label}, ${stored.content.length} chars)`);
        } else {
          debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
        }
      }
    }

    // Build combined context with clear sections
    let context: string | undefined;
    if (contextParts.length > 0) {
      context = contextParts.map(part =>
        `## ${part.variableName} (${part.label})\n\n${part.content}`
      ).join('\n\n---\n\n');
      debugLog(`[GenericAgent] Combined ${contextParts.length} contexts for planning agent (${context.length} chars total)`);
    }

    // Check if we're resuming an existing planning session
    if (this.planningState?.active) {
      // This shouldn't happen - dispatch_agent shouldn't be called while planning is active
      return { error: 'Planning already in progress' };
    }

    // Initialize planning state with imported prompt
    const planningSystemPrompt = buildPlanningPrompt(task, context);

    debugLog(`[GenericAgent] handleDispatchAgent: outputFile=${outputFile || 'undefined'}`);

    this.planningState = {
      active: true,
      task,
      context,
      messages: [
        { role: 'system', content: planningSystemPrompt },
        { role: 'user', content: '<request>\nCreate an initial plan for this task.\n</request>' },
      ],
      currentPlan: '',
      iterations: 0,
      toolCallId: toolCall.id,
      outputFile,
    };

    // Generate the initial plan
    return this.continuePlanningLoop();
  }

  /**
   * Handle dispatch_explore_agent tool - spawns a sub-agent for read-only exploration.
   * Returns a summary of existing project content for the requested task.
   */
  private async handleDispatchExploreAgent(toolCall: ToolCall): Promise<unknown> {
    this.currentMode = 'content';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_explore_agent' };
    }

    const contextParts: Array<{ variableName: string; label: string; content: string }> = [];
    const missingRefs: string[] = [];

    if (contextRefs && contextRefs.length > 0) {
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push({
            variableName: ref,
            label: stored.label,
            content: stored.content,
          });
          debugLog(`[GenericAgent] Resolved context_ref ${ref} for explore agent (${stored.label}, ${stored.content.length} chars)`);
        } else {
          const projectFileContent = this.tryResolveFromProjectFiles(ref);
          if (projectFileContent) {
            contextParts.push({
              variableName: ref,
              label: projectFileContent.label,
              content: projectFileContent.content,
            });
            debugLog(`[GenericAgent] Resolved context_ref ${ref} from project file for explore agent: ${projectFileContent.file}`);
          } else {
            debugLog(`[GenericAgent] WARNING: Context reference not found for explore agent: ${ref}`);
            missingRefs.push(ref);
          }
        }
      }
    } else {
      const autoRefs = ['$story', '$plot', '$original_input'];
      for (const ref of autoRefs) {
        const projectFileContent = this.tryResolveFromProjectFiles(ref);
        if (projectFileContent) {
          contextParts.push({
            variableName: ref,
            label: projectFileContent.label,
            content: projectFileContent.content,
          });
          debugLog(`[GenericAgent] Auto-loaded ${ref} for explore agent from project file: ${projectFileContent.file}`);
        }
      }
    }

    let context: string | undefined;
    if (contextParts.length > 0) {
      context = contextParts.map(part =>
        `## ${part.variableName} (${part.label})\n\n${part.content}`
      ).join('\n\n---\n\n');
      debugLog(`[GenericAgent] Combined ${contextParts.length} contexts for explore agent (${context.length} chars total)`);
    } else {
      debugLog(`[GenericAgent] WARNING: No context available for explore agent`);
    }

    const exploreSystemPrompt = buildExplorePrompt(task, context);
    const messages: Message[] = [
      { role: 'system', content: exploreSystemPrompt },
      { role: 'user', content: '<request>\nSummarize existing project content for this task.\n</request>' },
    ];

    try {
      let content = '';

      for await (const chunk of this.llm.generateStream({
        messages,
        temperature: 0.2,
      })) {
        if (chunk.content) {
          content += chunk.content;
          this.emit({
            type: 'tool_streaming',
            toolCallId: toolCall.id,
            chunk: chunk.content,
            done: false,
            agentName: this.getEffectiveAgentName(),
            toolName: 'dispatch_explore_agent',
          });
        }
        if (chunk.done) {
          this.emit({
            type: 'tool_streaming',
            toolCallId: toolCall.id,
            chunk: '',
            done: true,
            agentName: this.getEffectiveAgentName(),
          });
        }
      }

      const trimmed = content.trim() || 'No content generated';
      const result: Record<string, unknown> = {
        status: 'success',
        content: trimmed,
        task,
      };

      if (missingRefs.length > 0) {
        result['warning'] = `Could not resolve context_refs: ${missingRefs.join(', ')}`;
      }

      if (outputFile) {
        result['warning'] = result['warning']
          ? `${result['warning']} | Explore subagent is read-only; output_file ignored: ${outputFile}`
          : `Explore subagent is read-only; output_file ignored: ${outputFile}`;
      }

      this.currentMode = 'orchestrator';
      return result;
    } catch (error) {
      this.currentMode = 'orchestrator';
      return {
        error: `Explore failed: ${String(error)}`,
        task,
      };
    }
  }

  /**
   * Continue the planning loop - generates plan and asks for user verification.
   */
  private async continuePlanningLoop(): Promise<unknown> {
    if (!this.planningState) {
      return { error: 'No active planning session' };
    }

    const maxIterations = 10;

    if (this.planningState.iterations >= maxIterations) {
      const result = {
        status: 'max_iterations',
        plan: this.planningState.currentPlan,
        task: this.planningState.task,
        message: 'Reached maximum iterations for plan refinement. Using the last version.',
      };
      this.planningState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    this.planningState.iterations++;

    try {
      // Generate or refine the plan with streaming
      let planContent = '';
      let isFirstChunk = true;
      debugLog(`[GenericAgent] continuePlanningLoop starting generation, toolCallId=${this.planningState.toolCallId}`);

      // If this is a subsequent iteration (after feedback), we need to reset the streaming display
      const shouldReset = this.planningState.iterations > 1;

      for await (const chunk of this.llm.generateStream({
        messages: this.planningState.messages,
        temperature: 0.7,
      })) {
        if (chunk.content) {
          planContent += chunk.content;
          debugLog(`[GenericAgent] tool_streaming emit: chunk=${chunk.content.length} chars, total=${planContent.length} chars`);
          // Emit tool_streaming to show content inside the ToolCallDisplay
          // On first chunk of a regeneration, include reset flag to clear old content and show display
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.planningState.toolCallId,
            chunk: chunk.content,
            done: false,
            agentName: this.getEffectiveAgentName(),
            toolName: 'dispatch_agent',
            reset: shouldReset && isFirstChunk,
          });
          isFirstChunk = false;
        }
        if (chunk.done) {
          debugLog(`[GenericAgent] tool_streaming DONE: total planContent=${planContent.length} chars`);
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.planningState.toolCallId,
            chunk: '',
            done: true,
            agentName: this.getEffectiveAgentName(),
          });
        }
      }

      this.planningState.currentPlan = planContent.trim() || 'No plan generated';

      // Add assistant response to history
      this.planningState.messages.push({
        role: 'assistant',
        content: this.planningState.currentPlan,
      });

      // Note: Plan is displayed via ToolCallDisplay when the tool result is rendered
      // No need to emit agent_text here as it would cause duplicate display

      // Return status indicating we need user verification
      // The main agent will pause and wait for user input
      const verificationQuestion = this.planningState.iterations === 1
        ? 'I\'ve created a plan for this task. Would you like to proceed or provide feedback?'
        : 'I\'ve updated the plan based on your feedback. Would you like to proceed or provide more feedback?';

      const verificationResult = {
        status: 'awaiting_verification',
        plan: this.planningState.currentPlan,
        task: this.planningState.task,
        iterations: this.planningState.iterations,
        question: verificationQuestion,
        options: [
          { label: 'Accept plan', description: 'Proceed with this plan and start execution' },
          { label: 'Provide feedback', description: 'Modify the plan with your input' },
        ],
      };

      debugLog(`[GenericAgent] continuePlanningLoop returning: ${JSON.stringify({
        status: verificationResult.status,
        question: verificationResult.question?.slice(0, 50),
        optionsCount: verificationResult.options.length,
        options: verificationResult.options,
      }, null, 2)}`);
      return verificationResult;
    } catch (error) {
      const failedTask = this.planningState?.task;
      this.planningState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Planning failed: ${String(error)}`,
        task: failedTask,
      };
    }
  }

  /**
   * Handle user response to planning verification.
   * Uses LLM to classify whether the response is approval or feedback.
   */
  async handlePlanningResponse(userResponse: string): Promise<unknown> {
    if (!this.planningState) {
      return { error: 'No active planning session' };
    }

    // Normalize user response - trim and remove extra whitespace
    const normalizedResponse = userResponse.trim().replace(/\s+/g, ' ');
    debugLog(`[GenericAgent] handlePlanningResponse: normalized="${normalizedResponse}", original="${userResponse}"`);

    // Use LLM to classify the user's intent
    const isApproval = await this.classifyPlanResponse(normalizedResponse);
    debugLog(`[GenericAgent] handlePlanningResponse: isApproval=${isApproval}`);

    if (isApproval) {
      // Write plan to output file
      let fileSaved = false;
      let normalizedPath: string | undefined;

      // Always ensure outputFile is set - use default if not provided
      let outputFileToUse = this.planningState.outputFile;
      if (!outputFileToUse) {
        // Try to infer from task or use default
        const taskLower = this.planningState.task.toLowerCase();
        if (taskLower.includes('plot') && !taskLower.includes('character') && !taskLower.includes('setting')) {
          outputFileToUse = 'agent/plans/plot-plan.md';
        } else if (taskLower.includes('story') && !taskLower.includes('character') && !taskLower.includes('setting')) {
          outputFileToUse = 'agent/plans/story-plan.md';
        } else if (taskLower.includes('character') || taskLower.includes('setting') || taskLower.includes('characters') || taskLower.includes('settings')) {
          outputFileToUse = 'agent/plans/characters-settings-plan.md';
        } else if (taskLower.includes('scene')) {
          outputFileToUse = 'agent/plans/scenes-plan.md';
        } else {
          outputFileToUse = 'agent/plans/plan.md';
        }
        debugLog(`[GenericAgent] No outputFile specified, using inferred default: ${outputFileToUse} (task: ${this.planningState.task.substring(0, 100)})`);
      } else {
        debugLog(`[GenericAgent] Using provided outputFile: ${outputFileToUse}`);
      }

      debugLog(`[GenericAgent] handlePlanningResponse: isApproval=true, outputFile=${outputFileToUse}, planLength=${this.planningState.currentPlan.length}`);

      // Normalize path to ensure plans are saved to agent/plans/ directory with hyphenated names
      normalizedPath = outputFileToUse;

      // If path starts with just "plans/", add "agent/" prefix
      if (normalizedPath.startsWith('plans/') && !normalizedPath.startsWith('agent/plans/')) {
        normalizedPath = `agent/${normalizedPath}`;
      }
      // If path doesn't start with "agent/", assume it should be in agent/plans/
      else if (!normalizedPath.startsWith('agent/')) {
        // If it's just a filename, put it in agent/plans/
        if (!normalizedPath.includes('/')) {
          normalizedPath = `agent/plans/${normalizedPath}`;
        } else {
          // If it has a path but no agent/ prefix, add it
          normalizedPath = `agent/${normalizedPath}`;
        }
      }

      // For project-level planning, always save to master-plan.md
      // This is the single source of truth for the entire workflow
      if (normalizedPath.startsWith('agent/plans/') && !normalizedPath.includes('master-plan')) {
        // Redirect all plan files to the master plan
        normalizedPath = 'agent/plans/master-plan.md';
        debugLog(`[GenericAgent] Redirecting plan to master-plan.md (project-level planning)`);
      }

      try {
        // Use getCurrentProjectBasePath() to get the correct project directory
        const basePath = getCurrentProjectBasePath();
        const projectDir = path.join(basePath, '.kshana');
        const filePath = path.join(projectDir, normalizedPath);
        debugLog(`[GenericAgent] Attempting to save plan to: ${filePath} (normalized from: ${outputFileToUse})`);

        // Ensure parent directory exists
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
          debugLog(`[GenericAgent] Creating parent directory: ${parentDir}`);
          fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.writeFileSync(filePath, this.planningState.currentPlan, 'utf-8');
        fileSaved = true;
        debugLog(`[GenericAgent] Successfully saved plan to ${normalizedPath}`);
      } catch (err) {
        debugLog(`[GenericAgent] ERROR: Failed to save plan to ${outputFileToUse}: ${err}`);
      }

      // Generate plan name and summary using LLM
      // If this fails, we still want to save the plan, so wrap in try-catch
      let name: string;
      let summary: string;
      try {
        const metadata = await this.generatePlanMetadata(
          this.planningState.task,
          this.planningState.currentPlan
        );
        name = metadata.name;
        summary = metadata.summary;
      } catch (err) {
        debugLog(`[GenericAgent] WARNING: Failed to generate plan metadata: ${err}. Using fallback.`);
        // Fallback metadata if LLM call fails
        name = this.planningState.task.slice(0, 50);
        summary = `Plan for: ${this.planningState.task}`;
      }

      // Store reference to the saved plan file instead of duplicating content
      // This prevents duplicate storage - plan is already in agent/plans/ file
      // IMPORTANT: Always store reference in context store, even if metadata generation failed
      let variableName: string;
      if (fileSaved && normalizedPath) {
        // Store reference to the file instead of duplicating content
        variableName = contextStore.storeReference(
          normalizedPath,
          name,
          undefined,
          'tool'
        ).variableName;
        debugLog(`[GenericAgent] Stored reference to plan file in context store as ${variableName} (file: ${normalizedPath})`);
      } else {
        // Fallback: store plan content if file wasn't saved (shouldn't happen in normal flow)
        variableName = contextStore.store(
          this.planningState.currentPlan,
          name,
          { source: 'tool', variableBaseName: 'plan' }
        ).variableName;
        debugLog(`[GenericAgent] Stored plan content in context store as ${variableName} (no file saved)`);
      }

      debugLog(`[GenericAgent] Stored plan in context store as ${variableName}`);

      const result = {
        status: 'approved',
        name,
        summary,
        plan_ref: variableName,
        task: this.planningState.task,
        iterations: this.planningState.iterations,
        output_file: normalizedPath || outputFileToUse,
        file_saved: fileSaved,
        message: fileSaved
          ? `Master plan "${name}" approved and saved to ${normalizedPath || outputFileToUse}. Summary: ${summary}\n\nTo read the full plan, use fetch_context with ${variableName}.`
          : `Master plan "${name}" approved. Summary: ${summary}\n\nTo read the full plan, use fetch_context with ${variableName}.`,
        next_steps: 'IMPORTANT: Master plan approved! Call update_project with action "update_plan_stage" and stage "complete" to mark the plan as approved, then start executing phases based on the master plan.',
      };
      this.planningState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    // User wants to provide feedback - use their input directly with XML tags
    this.planningState.messages.push({
      role: 'user',
      content: `<user_feedback>\n${userResponse}\n</user_feedback>\n\n<request>\nPlease revise the plan based on the feedback above.\n</request>`,
    });

    // Continue the planning loop
    return this.continuePlanningLoop();
  }

  /**
   * Use LLM to classify whether user response indicates approval or feedback.
   */
  private async classifyPlanResponse(userResponse: string): Promise<boolean> {
    // Explicitly check for common approval phrases first - FAST PATH
    // This prevents LLM hallucination and infinite loops where "Accept content" is treated as feedback
    const lower = userResponse.toLowerCase().trim();

    // Check for exact matches and variations (case-insensitive, trimmed)
    const approvalExact = [
      'accept content',
      'accept plan',
      'accept',
      '1',
      'accept plan and proceed',
      'proceed with plan',
      'approve plan',
      'yes, accept plan',
      'yes accept plan',
      'accept and proceed',
    ];
    // Check exact match first
    if (approvalExact.includes(lower)) {
      return true;
    }
    // Check if starts with any approval phrase
    if (approvalExact.some(phrase => lower.startsWith(phrase))) {
      return true;
    }

    // Check for exact matches of common short words
    const exactApprovalPatterns = ['yes', 'ok', 'okay', 'proceed', 'approve', 'go', 'start', 'continue', 'lgtm', 'y'];
    if (exactApprovalPatterns.some(p => lower === p)) {
      return true;
    }

    // Load classification prompt from file
    const classificationPrompt = loadAndRenderMarkdown('system/classification/plan-approval.md', {
      user_response: userResponse,
    });

    try {
      const response = await this.llm.generate({
        messages: [
          { role: 'user', content: classificationPrompt },
        ],
        temperature: 0,
        maxTokens: 10,
      });

      const result = (response.content ?? '').trim().toUpperCase();
      return result.includes('APPROVE');
    } catch {
      // On error, fall back to simple pattern matching

      // Check for partial matches (but exclude feedback-related phrases)
      if (lower.includes('feedback') || lower.includes('change') || lower.includes('modify') || lower.includes('revise') || lower.includes('update') || lower.includes('edit')) {
        return false;
      }

      // Check for approval keywords
      const approvalKeywords = ['accept', 'approve', 'proceed', 'yes', 'ok'];
      return approvalKeywords.some(p => lower.includes(p));
    }
  }

  /**
   * Generate a name and summary for an approved plan.
   * The summary is injected into message history; full plan is stored externally.
   */
  private async generatePlanMetadata(
    task: string,
    plan: string
  ): Promise<{ name: string; summary: string }> {
    const prompt = `Given this planning task and the resulting plan, generate:
1. A short descriptive name (3-5 words, no quotes)
2. A 1-2 sentence summary that captures the key steps and can be used to remember what the plan contains

<task>${task}</task>

<plan>${plan}</plan>

Respond in JSON format:
{"name": "...", "summary": "..."}`;

    try {
      const response = await this.llm.generate({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 200,
      });

      return JSON.parse(response.content ?? '{}');
    } catch {
      return {
        name: task.slice(0, 50),
        summary: `Plan for: ${task}`,
      };
    }
  }

  /**
   * Generate a name and summary for approved content.
   * The summary is injected into message history; full content is stored externally.
   */
  private async generateContentMetadata(
    task: string,
    contentType: string,
    content: string
  ): Promise<{ name: string; summary: string }> {
    const prompt = `Given this content creation task, content type, and the resulting content, generate:
1. A short descriptive name (3-5 words, no quotes)
2. A 1-2 sentence summary that captures the essence of the content and can be used to remember what it contains

<task>${task}</task>
<content_type>${contentType}</content_type>

<content>${content.slice(0, 3000)}${content.length > 3000 ? '...[truncated]' : ''}</content>

Respond in JSON format:
{"name": "...", "summary": "..."}`;

    try {
      const response = await this.llm.generate({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 200,
      });

      const parsed = JSON.parse(response.content ?? '{}');
      // Validate that we got both name and summary
      if (parsed.name && parsed.summary) {
        return parsed;
      }
      // If JSON is invalid or missing fields, fall through to fallback
      debugLog(`[GenericAgent] WARNING: Metadata response missing fields: ${JSON.stringify(parsed)}`);
    } catch (err) {
      debugLog(`[GenericAgent] ERROR: Failed to generate content metadata: ${err}`);
      // Re-throw so caller can handle it
      throw err;
    }

    // Fallback if JSON parsing failed or missing fields
    return {
      name: `${contentType}: ${task.slice(0, 30)}`,
      summary: `${contentType} content for: ${task.slice(0, 100)}`,
    };
  }

  /**
   * Check if there's an active planning session awaiting user input.
   */
  isPlanningActive(): boolean {
    return this.planningState?.active ?? false;
  }

  /**
   * Check if there's an active content creation session awaiting user input.
   */
  isContentActive(): boolean {
    return this.contentState?.active ?? false;
  }

  /**
   * Try to resolve a context reference from project files.
   * This is a fallback when the context isn't found in the context store.
   * Supports both variable names ($plan) and direct file paths (script/story.md or plans/story-plan.md).
   */
  private tryResolveFromProjectFiles(ref: string): { label: string; content: string; file: string } | null {
    // Map of context ref patterns to project file paths (relative to .kshana directory)
    const projectFileMap: Record<string, { file: string; label: string }> = {
      '$plan': { file: 'agent/plans/story-plan.md', label: 'Story Plan' },
      '$plot': { file: 'agent/script/plot.md', label: 'Plot' },
      '$story': { file: 'agent/script/story.md', label: 'Story' },
      '$scenes': { file: 'agent/plans/scenes-plan.md', label: 'Scenes Plan' },
      '$images': { file: 'agent/plans/images.md', label: 'Images Plan' },
      '$video': { file: 'agent/plans/video.md', label: 'Video Plan' },
      '$original_input': { file: 'agent/original_input.md', label: 'Original Input' },
      '$transcript': { file: 'agent/content/transcript.md', label: 'Transcript' },
      '$content_plan': { file: 'agent/plans/content-plan.md', label: 'Content Plan' },
      '$image_placements': { file: 'agent/content/image-placements.md', label: 'Image Placement Plan' },
      '$infographic_placements': { file: 'agent/content/infographic-placements.md', label: 'Infographic Placement Plan' },
    };

    // Use getCurrentProjectBasePath() to get the correct project directory
    // This ensures we look in the user's project directory, not process.cwd()
    const basePath = getCurrentProjectBasePath();
    const projectDir = path.join(basePath, '.kshana');

    // Check if ref is a direct file path (e.g., "script/story.md" or "plans/story-plan.md")
    if (ref.includes('/') || ref.endsWith('.md')) {
      const filePath = path.join(projectDir, ref);
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.trim().length > 0) {
            // Generate label from filename
            const filename = path.basename(ref, '.md');
            const label = filename.charAt(0).toUpperCase() + filename.slice(1);
            return {
              label: label,
              content: content,
              file: ref,
            };
          }
        }
      } catch {
        // File read failed, continue to variable name lookup
      }
    }

    // Try to match the ref as a variable name (ignore numeric suffixes like $plan_2)
    const baseRef = ref.replace(/_\d+$/, '');
    const mapping = projectFileMap[baseRef] || projectFileMap[ref];

    if (!mapping) {
      return null;
    }

    // Try to read from project directory
    const filePath = path.join(projectDir, mapping.file);

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.trim().length > 0) {
          return {
            label: mapping.label,
            content: content,
            file: mapping.file,
          };
        }
      }
    } catch {
      // File read failed, return null
    }

    return null;
  }

  private buildContextFromRefs(contextRefs?: string[]): { context?: string; missingRefs: string[] } {
    const contextParts: Array<{ variableName: string; label: string; content: string }> = [];
    const missingRefs: string[] = [];

    if (contextRefs && contextRefs.length > 0) {
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push({
            variableName: ref,
            label: stored.label,
            content: stored.content,
          });
          debugLog(`[GenericAgent] Resolved context_ref ${ref} (${stored.label}, ${stored.content.length} chars)`);
        } else {
          const projectFileContent = this.tryResolveFromProjectFiles(ref);
          if (projectFileContent) {
            contextParts.push({
              variableName: ref,
              label: projectFileContent.label,
              content: projectFileContent.content,
            });
            debugLog(`[GenericAgent] Resolved context_ref ${ref} from project file: ${projectFileContent.file}`);
          } else {
            missingRefs.push(ref);
          }
        }
      }
    }

    if (contextParts.length === 0) {
      return { missingRefs, context: undefined };
    }

    const context = contextParts.map(part =>
      `## ${part.variableName} (${part.label})\n\n${part.content}`
    ).join('\n\n---\n\n');
    return { missingRefs, context };
  }

  /**
   * Handle dispatch_content_agent tool - spawns a sub-agent for creative content generation.
   * Unlike dispatch_agent (for technical planning), this creates actual creative content
   * like stories, character descriptions, and scene narratives.
   */
  private async handleDispatchContentAgent(toolCall: ToolCall): Promise<unknown> {
    // Set mode for UI display
    this.currentMode = 'content';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contentType = args['content_type'] as ContentType;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_content_agent' };
    }

    if (!contentType) {
      this.currentMode = 'orchestrator';
      return { error: 'No content_type provided for dispatch_content_agent' };
    }

    // Validate content_type is one of the allowed types
    const validContentTypes = [
      'plot',
      'story',
      'character',
      'setting',
      'scene',
      'narration',
      'transcript_analysis',
      'image_placement_plan',
      'image_prompt',
    ];
    if (!validContentTypes.includes(contentType)) {
      this.currentMode = 'orchestrator';
      return {
        error: `Invalid content_type "${contentType}". Must be one of: ${validContentTypes.join(', ')}`,
        suggestion: 'Use the appropriate content_type for your task. For example, use "character" for character profiles, "scene" for scene descriptions.',
      };
    }

    const taskLower = task.toLowerCase();
    const isMasterPlanRequest =
      taskLower.includes('master plan') ||
      (outputFile ? outputFile.toLowerCase().includes('master-plan.md') : false);
    if (isMasterPlanRequest && (contentType === 'plot' || contentType === 'story' || contentType === 'narration')) {
      this.currentMode = 'orchestrator';
      return {
        error: 'Master plans must be created by the Plan subagent, not the content-creator.',
        suggestion: 'Use Task with subagent_type="Plan" and output_file="agent/plans/master-plan.md" in plan mode.',
      };
    }

    // Resolve all context_refs into a combined context
    const contextParts: Array<{ variableName: string; label: string; content: string }> = [];
    const missingRefs: string[] = [];

    if (contextRefs && contextRefs.length > 0) {
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push({
            variableName: ref,
            label: stored.label,
            content: stored.content,
          });
          debugLog(`[GenericAgent] Resolved context_ref ${ref} for content agent (${stored.label}, ${stored.content.length} chars)`);
        } else {
          // Try to resolve from project files if this looks like a plan reference
          // e.g., $plan -> script/plot.md or script/story.md
          const projectFileContent = this.tryResolveFromProjectFiles(ref);
          if (projectFileContent) {
            contextParts.push({
              variableName: ref,
              label: projectFileContent.label,
              content: projectFileContent.content,
            });
            debugLog(`[GenericAgent] Resolved context_ref ${ref} from project file: ${projectFileContent.file}`);
          } else {
            debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
            missingRefs.push(ref);
          }
        }
      }
    }

    // FALLBACK: Auto-inject $original_input for plot phase if no context was provided or if wrong context_ref was used
    // This ensures the content agent always has access to the user's story idea
    if (contentType === 'plot') {
      // Check if $original_input is already in contextParts
      const hasOriginalInput = contextParts.some(part => part.variableName === '$original_input');

      if (!hasOriginalInput) {
        // First, try to get it from context store
        let originalInput = contextStore.get('$original_input');

        // If not in context store, try to load from project files
        if (!originalInput) {
          const projectFileContent = this.tryResolveFromProjectFiles('$original_input');
          if (projectFileContent) {
            // Store it in context store for future use
            const stored = contextStore.store(
              projectFileContent.content,
              projectFileContent.label,
              { source: 'manual', variableBaseName: 'original_input' }
            );
            // Get the stored item to get the full object
            const storedItem = contextStore.get(stored.variableName);
            if (storedItem) {
              originalInput = storedItem;
              debugLog(`[GenericAgent] Loaded $original_input from project file and stored in context store as ${stored.variableName}`);
            }
          }
        }

        if (originalInput) {
          contextParts.push({
            variableName: '$original_input',
            label: originalInput.label,
            content: originalInput.content,
          });
          if (contextRefs && contextRefs.length > 0) {
            debugLog(`[GenericAgent] WARNING: Plot phase requested context_refs: ${contextRefs.join(', ')}, but $original_input was missing. AUTO-INJECTED $original_input (${originalInput.content.length} chars)`);
          } else {
            debugLog(`[GenericAgent] AUTO-INJECTED $original_input for plot phase (${originalInput.content.length} chars)`);
          }
        } else {
          debugLog(`[GenericAgent] ERROR: No context_refs provided for plot and $original_input not found in context store or project files`);
        }
      }
    }

    // Log error for missing refs to help debug
    if (missingRefs.length > 0) {
      debugLog(`[GenericAgent] ERROR: Could not resolve context_refs: ${missingRefs.join(', ')}`);
      const availableContexts = contextStore.list().map(c => c.variableName);
      debugLog(`[GenericAgent] Available context variables: ${availableContexts.join(', ') || 'none'}`);

      // For plot phase, provide helpful error message
      if (contentType === 'plot' && missingRefs.length > 0) {
        debugLog(`[GenericAgent] ERROR: Plot generation requires $original_input. Make sure to use context_refs: ["$original_input"] (not $user_input)`);
      }
    }

    // Validate that we have context before proceeding (critical for plot phase)
    if (contextParts.length === 0) {
      const errorMsg = contentType === 'plot'
        ? 'Plot generation requires $original_input context, but it was not found. Ensure the project has original_input.md file.'
        : `Content generation requires context, but none was provided or resolved.`;
      debugLog(`[GenericAgent] ERROR: ${errorMsg}`);
      this.currentMode = 'orchestrator';
      return {
        error: errorMsg,
        suggestion: contentType === 'plot'
          ? 'Use context_refs: ["$original_input"] when calling Task for plot generation. The $original_input is automatically loaded from agent/original_input.md.'
          : 'Provide valid context_refs when calling Task for content generation.',
      };
    }

    // Validate context usage: warn if $original_input is used for characters/settings
    // The approved $story should be used instead for consistency
    // NOTE: This is now just a soft warning - execution continues regardless
    const usesOriginalInput = contextRefs?.some(ref => ref === '$original_input');
    const isCharacterOrSetting = contentType === 'character' || contentType === 'setting';
    if (usesOriginalInput && isCharacterOrSetting) {
      debugLog(`[GenericAgent] WARNING: Using $original_input for ${contentType} creation. Consider using $story instead for approved content.`);
      // Log warning but continue execution - don't block content generation
      const storyAvailable = contextStore.get('$story') || this.tryResolveFromProjectFiles('$story');
      if (storyAvailable) {
        debugLog(`[GenericAgent] NOTE: $story is available and would be preferred for ${contentType} creation.`);
      }
    }

    // Build combined context with clear sections
    let context: string | undefined;
    if (contextParts.length > 0) {
      context = contextParts.map(part =>
        `## ${part.variableName} (${part.label})\n\n${part.content}`
      ).join('\n\n---\n\n');
      debugLog(`[GenericAgent] Combined ${contextParts.length} contexts for content agent (${context.length} chars total)`);
      debugLog(`[GenericAgent] Context variables used: ${contextParts.map(p => p.variableName).join(', ')}`);
    } else {
      debugLog(`[GenericAgent] WARNING: No context available for content generation`);
    }

    // Check if we're resuming an existing content session
    if (this.contentState?.active) {
      return { error: 'Content creation already in progress' };
    }

    // Initialize content state with content prompt
    const contentSystemPrompt = buildContentPrompt(task, contentType, context);

    this.contentState = {
      active: true,
      task,
      contentType,
      context,
      outputFile,
      messages: [
        { role: 'system', content: contentSystemPrompt },
        { role: 'user', content: `<request>\nCreate the ${contentType} content for this task.\n</request>` },
      ],
      currentContent: '',
      iterations: 0,
      toolCallId: toolCall.id,
    };

    // Generate the initial content
    return this.continueContentLoop();
  }

  /**
   * Continue the content creation loop - generates content and asks for user verification.
   */
  private async continueContentLoop(): Promise<unknown> {
    if (!this.contentState) {
      return { error: 'No active content session' };
    }

    const maxIterations = 10;

    if (this.contentState.iterations >= maxIterations) {
      const result = {
        status: 'max_iterations',
        content: this.contentState.currentContent,
        content_type: this.contentState.contentType,
        task: this.contentState.task,
        output_file: this.contentState.outputFile,
        message: 'Reached maximum iterations for content refinement. Using the last version.',
      };
      this.contentState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    this.contentState.iterations++;

    try {
      // Generate or refine the content with streaming
      let content = '';
      let isFirstChunk = true;

      // If this is a subsequent iteration (after feedback), we need to reset the streaming display
      const shouldReset = this.contentState.iterations > 1;

      for await (const chunk of this.llm.generateStream({
        messages: this.contentState.messages,
        temperature: 0.8, // Slightly higher temperature for creative content
      })) {
        if (chunk.content) {
          content += chunk.content;
          // Emit tool_streaming to show content inside the ToolCallDisplay
          // On first chunk of a regeneration, include reset flag to clear old content and show display
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.contentState.toolCallId,
            chunk: chunk.content,
            done: false,
            agentName: this.getEffectiveAgentName(),
            toolName: 'dispatch_content_agent',
            reset: shouldReset && isFirstChunk,
          });
          isFirstChunk = false;
        }
        if (chunk.done) {
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.contentState.toolCallId,
            chunk: '',
            done: true,
            agentName: this.getEffectiveAgentName(),
          });
        }
      }

      this.contentState.currentContent = content.trim() || 'No content generated';

      // Check if the content is actually an error message instead of valid content
      const contentLower = this.contentState.currentContent.toLowerCase();
      const isErrorResponse =
        contentLower.includes('cannot create') ||
        contentLower.includes('cannot generate') ||
        contentLower.includes('not mentioned') ||
        contentLower.includes('not found') ||
        contentLower.includes('not present') ||
        contentLower.includes('not available') ||
        contentLower.includes('does not exist') ||
        contentLower.includes('unable to') ||
        (contentLower.includes('error') && contentLower.length < 200) ||
        (contentLower.startsWith('i cannot') || contentLower.startsWith('i cannot'));

      if (isErrorResponse) {
        // This is an error message, not actual content
        const errorMessage = this.contentState.currentContent;
        const failedTask = this.contentState.task;
        const contentType = this.contentState.contentType;
        debugLog(`[GenericAgent] Content Agent returned error message instead of content: ${errorMessage.slice(0, 100)}`);
        this.contentState = null;
        this.currentMode = 'orchestrator';
        return {
          error: `Content creation failed: ${errorMessage}`,
          content_type: contentType,
          task: failedTask,
          suggestion: 'The requested content could not be generated. Please check if the character/setting exists in the story context.',
        };
      }

      // Add assistant response to history
      this.contentState.messages.push({
        role: 'assistant',
        content: this.contentState.currentContent,
      });

      // Return status indicating we need user verification
      // The main agent will pause and wait for user input
      // NOTE: This uses the same "awaiting_verification" status as planning, which is
      // handled by the patched executeTool to trigger a question event.

      const verificationQuestion = this.contentState.iterations === 1
        ? `I've created the ${this.contentState.contentType} content. Would you like to accept it or provide feedback?`
        : `I've updated the ${this.contentState.contentType} content based on your feedback. Would you like to accept it or provide more feedback?`;

      const verificationResult = {
        status: 'awaiting_verification',
        content: this.contentState.currentContent,
        content_type: this.contentState.contentType,
        task: this.contentState.task,
        iterations: this.contentState.iterations,
        question: verificationQuestion,
        options: [
          { label: 'Accept content', description: 'Save and proceed to next step' },
          { label: 'Provide feedback', description: 'Modify the content with your input' },
        ],
        // Context for the UI to display (using the content we just generated)
        prompt: this.contentState.currentContent,
      };

      debugLog(`[GenericAgent] continueContentLoop returning: ${JSON.stringify({
        status: verificationResult.status,
        question: verificationResult.question?.slice(0, 50),
        contentType: verificationResult.content_type,
      }, null, 2)}`);
      return verificationResult;
    } catch (error) {
      const failedTask = this.contentState?.task;
      this.contentState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Content creation failed: ${String(error)}`,
        task: failedTask,
      };
    }
  }

  /**
   * Handle user response to content verification.
   * Uses LLM to classify whether the response is approval or feedback.
   */
  async handleContentResponse(userResponse: string): Promise<unknown> {
    if (!this.contentState) {
      return { error: 'No active content session' };
    }

    // Use LLM to classify the user's intent (reuse same classification logic as planning)
    // Wrap in try-catch to handle potential API errors
    let isApproval: boolean;
    try {
      isApproval = await this.classifyPlanResponse(userResponse);
    } catch (err) {
      debugLog(`[GenericAgent] ERROR: Failed to classify content response: ${err}. Assuming approval based on response pattern.`);
      // Fallback: check for common approval patterns
      const lower = userResponse.toLowerCase().trim();
      isApproval = ['accept', 'yes', 'ok', 'proceed', 'approve', '1'].some(word => lower.includes(word)) &&
        !['feedback', 'change', 'modify', 'revise'].some(word => lower.includes(word));
    }

    if (isApproval) {
      const cleanedContent = this.contentState.currentContent
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();
      if (cleanedContent.length > 0) {
        this.contentState.currentContent = cleanedContent;
      }

      // Write content to output file if specified
      let fileSaved = false;
      let normalizedContentPath: string | undefined;
      // Always ensure outputFile is set for plot/story/narration content types
      let outputFileToUse = this.contentState.outputFile;
      if (!outputFileToUse) {
        if (this.contentState.contentType === 'plot' || this.contentState.contentType === 'story' || this.contentState.contentType === 'narration') {
          // Fallback: use default path from CONTENT_TYPE_OUTPUT_FILES
          outputFileToUse = CONTENT_TYPE_OUTPUT_FILES[this.contentState.contentType] || `agent/script/${this.contentState.contentType}.md`;
          debugLog(`[GenericAgent] No outputFile specified, using default: ${outputFileToUse}`);
        } else if (this.contentState.contentType === 'character' || this.contentState.contentType === 'setting') {
          // For character/setting, use directory path - name will be extracted from task
          outputFileToUse = CONTENT_TYPE_OUTPUT_FILES[this.contentState.contentType] || `agent/${this.contentState.contentType}s/`;
          debugLog(`[GenericAgent] No outputFile specified for ${this.contentState.contentType}, using default directory: ${outputFileToUse}`);
        }
      }

      // Normalize filename separators for character/setting files
      // Convert underscores to hyphens in the filename to match saveSetting/saveCharacter conventions
      if (outputFileToUse && (this.contentState.contentType === 'character' || this.contentState.contentType === 'setting')) {
        // Extract directory and filename parts
        const lastSlashIndex = outputFileToUse.lastIndexOf('/');
        if (lastSlashIndex >= 0 && !outputFileToUse.endsWith('/')) {
          const dir = outputFileToUse.substring(0, lastSlashIndex + 1);
          const filename = outputFileToUse.substring(lastSlashIndex + 1);
          // Normalize filename: replace underscores with hyphens
          const normalizedFilename = filename.replace(/_/g, '-');
          if (normalizedFilename !== filename) {
            outputFileToUse = dir + normalizedFilename;
            debugLog(`[GenericAgent] Normalized filename from ${filename} to ${normalizedFilename}`);
          }
        }
      }

      if (outputFileToUse) {
        try {
          // Normalize path to ensure content is saved to correct location
          // For plot/story/narration, ensure they go to agent/script/
          normalizedContentPath = outputFileToUse;

          // If path starts with just "plans/", add "agent/" prefix
          if (normalizedContentPath.startsWith('plans/') && !normalizedContentPath.startsWith('agent/plans/')) {
            normalizedContentPath = `agent/${normalizedContentPath}`;
          }
          // If path doesn't start with "agent/", normalize based on content type
          else if (!normalizedContentPath.startsWith('agent/')) {
            // For plot/story/narration content types, put in agent/script/
            if (this.contentState.contentType === 'plot' || this.contentState.contentType === 'story' || this.contentState.contentType === 'narration') {
              if (!normalizedContentPath.includes('/')) {
                normalizedContentPath = `agent/script/${normalizedContentPath}`;
              } else {
                normalizedContentPath = `agent/${normalizedContentPath}`;
              }
            }
            // For other content types (character/setting), they already have proper paths from generateContentTool
          }
          // If path already starts with "agent/plans/" but is plot/story/narration, redirect to agent/script/
          else if (normalizedContentPath.startsWith('agent/plans/') &&
            (this.contentState.contentType === 'plot' || this.contentState.contentType === 'story' || this.contentState.contentType === 'narration')) {
            const filename = normalizedContentPath.replace('agent/plans/', '');
            normalizedContentPath = `agent/script/${filename}`;
          }
          // If path already starts with "agent/script/", use it as-is (no normalization needed)

          // Check if path ends with '/' (directory path) for character/setting content types
          // If so, extract name from task and append it
          if (normalizedContentPath.endsWith('/') &&
            (this.contentState.contentType === 'character' || this.contentState.contentType === 'setting')) {
            // Extract name from task (e.g., "Create character profile for: Joy" -> "Joy")
            // Try to find name after common patterns
            let name = '';
            const taskLower = this.contentState.task.toLowerCase();
            const patterns = [
              /(?:for|named|called|:)\s+([a-z0-9\s'-]+?)(?:\s|$|\.|,)/i,
              /(?:create|generate|write).*?(?:character|setting).*?(?:for|named|called|:)\s+([a-z0-9\s'-]+?)(?:\s|$|\.|,)/i,
            ];

            for (const pattern of patterns) {
              const match = this.contentState.task.match(pattern);
              if (match && match[1]) {
                name = match[1].trim();
                break;
              }
            }

            // Fallback: try to extract from task by splitting on common delimiters
            if (!name) {
              const parts = this.contentState.task.split(/[:,\-]/);
              if (parts.length > 1) {
                const lastPart = parts[parts.length - 1];
                if (lastPart) {
                  name = lastPart.trim();
                }
              } else {
                // Last resort: use first few words after "for" or similar
                const words = this.contentState.task.split(/\s+/);
                const forIndex = words.findIndex(w => /^(for|named|called|:)$/i.test(w));
                if (forIndex >= 0 && forIndex < words.length - 1) {
                  name = words.slice(forIndex + 1, forIndex + 4).join(' ').trim();
                }
              }
            }

            // If still no name, use a fallback based on content type
            if (!name || name.length === 0) {
              name = `unnamed-${this.contentState.contentType}`;
            }

            // Create safe filename (same logic as in generateContentTool)
            const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            normalizedContentPath = `${normalizedContentPath}${safeName}.md`;
            debugLog(`[GenericAgent] Extracted name "${name}" from task, using filename: ${safeName}.md`);
          }

          // Use getCurrentProjectBasePath() to get the correct project directory
          const basePath = getCurrentProjectBasePath();
          const projectDir = path.join(basePath, '.kshana');
          const filePath = path.join(projectDir, normalizedContentPath);
          debugLog(`[GenericAgent] Attempting to save content to: ${filePath} (normalized from: ${outputFileToUse}, contentType: ${this.contentState.contentType})`);

          // Validate content before saving (especially for character/setting)
          const content = this.contentState.currentContent.trim();
          const isCharacterOrSetting = this.contentState.contentType === 'character' || this.contentState.contentType === 'setting';

          if (isCharacterOrSetting) {
            // Check if content is truncated or incomplete
            const isVariableRef = content.startsWith('$') || /^\$\w+/.test(content);
            const isEmpty = content.length < 100; // Very short content likely incomplete
            // Check if there's actual content after headers (not just headers)
            const hasActualContent = /##\s+\w+[\s\S]{30,}/.test(content) || content.split('\n').filter(line => line.trim() && !line.trim().startsWith('#')).length > 3;

            // Check if file already exists with content - don't overwrite with truncated content
            if (fs.existsSync(filePath)) {
              const existingContent = fs.readFileSync(filePath, 'utf-8').trim();
              if (existingContent.length > content.length && existingContent.length > 100) {
                debugLog(`[GenericAgent] WARNING: Existing file has more content (${existingContent.length} vs ${content.length} bytes). Skipping save to prevent truncation.`);
                fileSaved = false;
              } else if (isVariableRef || isEmpty || !hasActualContent) {
                debugLog(`[GenericAgent] WARNING: Content appears truncated or incomplete (variableRef: ${isVariableRef}, empty: ${isEmpty}, hasActualContent: ${hasActualContent}). Skipping save.`);
                fileSaved = false;
              } else {
                // Content looks good, proceed with save
                fileSaved = true;
              }
            } else if (isVariableRef || isEmpty || !hasActualContent) {
              debugLog(`[GenericAgent] WARNING: Content appears truncated or incomplete (variableRef: ${isVariableRef}, empty: ${isEmpty}, hasActualContent: ${hasActualContent}). Skipping save.`);
              fileSaved = false;
            } else {
              // Content looks good, proceed with save
              fileSaved = true;
            }
          } else {
            // For other content types, always save
            fileSaved = true;
          }

          if (fileSaved) {
            // Ensure parent directory exists
            const parentDir = path.dirname(filePath);
            if (!fs.existsSync(parentDir)) {
              debugLog(`[GenericAgent] Creating parent directory: ${parentDir}`);
              fs.mkdirSync(parentDir, { recursive: true });
            }

            fs.writeFileSync(filePath, content, 'utf-8');
            debugLog(`[GenericAgent] Successfully saved content to ${normalizedContentPath} (${content.length} bytes)`);
          } else {
            debugLog(`[GenericAgent] Skipped saving truncated/incomplete content to ${normalizedContentPath}`);
          }
        } catch (err) {
          debugLog(`[GenericAgent] ERROR: Failed to save content to ${outputFileToUse}: ${err}`);
          console.error(`[GenericAgent] File save error:`, err);
        }
      } else {
        debugLog(`[GenericAgent] WARNING: No outputFile specified for ${this.contentState.contentType}, content will not be saved to disk`);
      }

      // Generate content name and summary using LLM (similar to planning)
      // If this fails, we still want to save the content, so wrap in try-catch
      let name: string;
      let summary: string;
      try {
        const metadata = await this.generateContentMetadata(
          this.contentState.task,
          this.contentState.contentType,
          this.contentState.currentContent
        );
        name = metadata.name;
        summary = metadata.summary;
      } catch (err) {
        debugLog(`[GenericAgent] WARNING: Failed to generate content metadata: ${err}. Using fallback.`);
        // Fallback metadata if LLM call fails
        name = `${this.contentState.contentType}: ${this.contentState.task.slice(0, 30)}`;
        summary = `${this.contentState.contentType} content for: ${this.contentState.task.slice(0, 100)}`;
      }

      // Store reference to the saved file instead of duplicating content
      // This prevents duplicate storage - content is already in agent/ files
      // IMPORTANT: Always store reference in context store, even if metadata generation failed
      let variableName: string;
      if (fileSaved && normalizedContentPath) {
        // Store reference to the file instead of duplicating content
        variableName = contextStore.storeReference(
          normalizedContentPath,
          name,
          undefined,
          'tool'
        ).variableName;
        debugLog(`[GenericAgent] Stored reference to ${this.contentState.contentType} file in context store as ${variableName} (file: ${normalizedContentPath})`);
      } else {
        // Fallback: store content if file wasn't saved (shouldn't happen in normal flow)
        variableName = contextStore.store(
          this.contentState.currentContent,
          name,
          { source: 'tool', variableBaseName: this.contentState.contentType }
        ).variableName;
        debugLog(`[GenericAgent] Stored ${this.contentState.contentType} content in context store as ${variableName} (no file saved)`);
      }

      const result = {
        status: 'approved',
        name,
        summary,
        content_ref: variableName,
        content_type: this.contentState.contentType,
        task: this.contentState.task,
        output_file: normalizedContentPath || this.contentState.outputFile,
        file_saved: fileSaved,
        iterations: this.contentState.iterations,
        message: fileSaved
          ? `${this.contentState.contentType} content "${name}" approved and saved to ${normalizedContentPath || this.contentState.outputFile}. Summary: ${summary}\n\nTo read the full content, use fetch_context with ${variableName}.`
          : `${this.contentState.contentType} content "${name}" approved. Summary: ${summary}\n\nTo read the full content, use fetch_context with ${variableName}.`,
        next_steps: 'IMPORTANT: Now update the project state - call update_project with action "update_phase" to mark the current phase as "completed", then use "transition_phase" to move to the next phase.',
      };
      this.contentState = null;
      // Reset mode back to orchestrator
      this.currentMode = 'orchestrator';
      return result;
    }

    // User wants to provide feedback - use their input directly with XML tags
    this.contentState.messages.push({
      role: 'user',
      content: `<user_feedback>\n${userResponse}\n</user_feedback>\n\n<request>\nPlease revise the ${this.contentState.contentType} content based on the feedback above.\n</request>`,
    });

    // Continue the content loop
    return this.continueContentLoop();
  }

  private async runOneShotSubagent(
    state: {
      task: string;
      messages: Message[];
      toolCallId: string;
      iterations: number;
      currentOutput: string;
    },
    toolName: string,
    temperature: number
  ): Promise<unknown> {
    let content = '';
    let isFirstChunk = true;

    for await (const chunk of this.llm.generateStream({
      messages: state.messages,
      temperature,
    })) {
      if (chunk.content) {
        content += chunk.content;
        this.emit({
          type: 'tool_streaming',
          toolCallId: state.toolCallId,
          chunk: chunk.content,
          done: false,
          agentName: this.getEffectiveAgentName(),
          toolName,
          reset: isFirstChunk,
        });
        isFirstChunk = false;
      }
      if (chunk.done) {
        this.emit({
          type: 'tool_streaming',
          toolCallId: state.toolCallId,
          chunk: '',
          done: true,
          agentName: this.getEffectiveAgentName(),
        });
      }
    }

    state.currentOutput = content.trim() || 'No output generated';
    this.currentMode = 'orchestrator';

    return {
      status: 'completed',
      output: state.currentOutput,
      task: state.task,
      iterations: state.iterations,
    };
  }

  private async handleDispatchTranscriptParser(toolCall: ToolCall): Promise<unknown> {
    this.currentMode = 'content';
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_transcript_parser' };
    }

    if (this.transcriptParserState?.active) {
      return { error: 'Transcript parsing already in progress' };
    }

    const { context, missingRefs } = this.buildContextFromRefs(contextRefs);
    if (missingRefs.length > 0) {
      debugLog(`[GenericAgent] WARNING: Missing context_refs for transcript parser: ${missingRefs.join(', ')}`);
    }

    // Build system prompt with tools available
    const systemPrompt = buildTranscriptParserPrompt(context);
    
    // Create a temporary tool registry with parse_srt tool for the subagent
    const subagentTools = new Map<string, ToolDefinition>();
    const parseSrtTool = this.tools.get('parse_srt');
    if (parseSrtTool) {
      subagentTools.set('parse_srt', parseSrtTool);
    }
    
    const fullSystemPrompt = buildSystemMessage(true, subagentTools, systemPrompt);

    this.transcriptParserState = {
      active: true,
      task,
      context,
      messages: [
        { role: 'system', content: fullSystemPrompt },
        { role: 'user', content: `<request>\n${task}\n</request>` },
      ],
      currentOutput: '',
      iterations: 1,
      toolCallId: toolCall.id,
    };

    // Run subagent with tool calling support
    let result = await this.runSubagentWithTools(this.transcriptParserState, 'dispatch_transcript_parser', 0.3, subagentTools);
    
    // If content filtering occurred, try direct fallback: call parse_srt tool directly
    const isContentFiltered = result && typeof result === 'object' && 'status' in result && result.status === 'error' && 
        'error' in result && typeof result.error === 'string' && 
        (result.error.includes('content may have been filtered') || result.error.includes('empty response'));
    
    if (isContentFiltered) {
      console.warn('[GenericAgent] Content filtering detected for transcript parser, attempting direct tool call fallback');
      
      // Try to directly call parse_srt with context variable
      if (parseSrtTool && parseSrtTool.handler && contextRefs && contextRefs.length > 0) {
        try {
          const handler = parseSrtTool.handler; // Store handler to help TypeScript narrow type
          const contextVar = contextRefs[0]; // Use first context ref (usually $original_input)
          const directToolCall: ToolCall = {
            id: `fallback-${Date.now()}`,
            name: 'parse_srt',
            arguments: { srt_text: contextVar },
          };
          
          const directResult = await Promise.resolve(handler(directToolCall.arguments));
          
          if (directResult && typeof directResult === 'object' && 'status' in directResult && directResult.status === 'success') {
            console.log('[GenericAgent] Direct parse_srt tool call succeeded, bypassing content filter');
            this.transcriptParserState = null;
            return {
              status: 'completed',
              output: `Transcript parsed successfully using direct tool call (bypassed content filter).\nTRANSCRIPT_DURATION: ${(directResult as any).duration || 'unknown'}\nTOTAL_ENTRIES: ${(directResult as any).entryCount || 'unknown'}\nFORMAT: ${(directResult as any).format || 'unknown'}`,
              task: task,
              iterations: 1,
            };
          }
        } catch (fallbackError) {
          console.error('[GenericAgent] Direct tool call fallback failed:', fallbackError);
        }
      }
    }
    
    this.transcriptParserState = null;
    return result;
  }

  /**
   * Handle dispatch_image_generator tool - spawns a sub-agent for image generation.
   * This is different from handleDispatchImageAgent which is for prompt crafting with user approval.
   * This version directly generates images using generate_image and wait_for_job tools.
   */
  private async handleDispatchImageGeneratorSubagent(toolCall: ToolCall): Promise<unknown> {
    this.currentMode = 'image';
    const args = toolCall.arguments;
    const task = args['task'] as string;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_image_generator' };
    }

    // Check if we're already in a session (could reuse state if needed, but for now just check)
    // Note: We don't maintain persistent state for this subagent - it's one-shot per call

    // Extract placement number from task if available
    // Task format: "Generate image for Placement [NUMBER]. Prompt: ..."
    let placementNumber = 1;
    const placementMatch = task.match(/Placement\s+(\d+)/i);
    if (placementMatch && placementMatch[1]) {
      placementNumber = parseInt(placementMatch[1], 10);
    }

    // Build system prompt for image generator
    const systemPrompt = buildImageGenerationPrompt(task);

    // Create a temporary tool registry with generate_image and wait_for_job tools for the subagent
    const subagentTools = new Map<string, ToolDefinition>();
    const generateImageTool = this.tools.get('generate_image');
    const waitForJobTool = this.tools.get('wait_for_job');
    
    if (generateImageTool) {
      subagentTools.set('generate_image', generateImageTool);
    }
    if (waitForJobTool) {
      subagentTools.set('wait_for_job', waitForJobTool);
    }

    if (!generateImageTool || !waitForJobTool) {
      this.currentMode = 'orchestrator';
      return {
        error: 'Image generation tools not available',
        missing_tools: {
          generate_image: !generateImageTool,
          wait_for_job: !waitForJobTool,
        },
      };
    }

    // Build full system message with tools
    const fullSystemPrompt = buildSystemMessage(true, subagentTools, systemPrompt);

    // Create state for the subagent (matching runSubagentWithTools signature)
    const imageGenSubagentState = {
      task,
      messages: [
        { role: 'system' as const, content: fullSystemPrompt },
        { role: 'user' as const, content: `<request>\n${task}\n</request>` },
      ] as Message[],
      currentOutput: '',
      iterations: 0,
      toolCallId: toolCall.id,
    };

    // Run subagent with tool calling support
    // Use slightly higher temperature for creative prompt crafting
    const result = await this.runSubagentWithTools(imageGenSubagentState, 'dispatch_image_generator', 0.7, subagentTools);
    
    this.currentMode = 'orchestrator';
    return result;
  }

  /**
   * Run a subagent that supports tool calls (unlike runOneShotSubagent which only streams text).
   */
  private async runSubagentWithTools(
    state: {
      task: string;
      messages: Message[];
      toolCallId: string;
      iterations: number;
      currentOutput: string;
    },
    toolName: string,
    temperature: number,
    tools: Map<string, ToolDefinition>
  ): Promise<unknown> {
    const maxIterations = 5;
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;
      
      // Generate response with tool calling support
      let response;
      try {
        response = await this.llm.generate({
          messages: state.messages,
          temperature,
          tools: Array.from(tools.values()),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const subagentName = this.getEffectiveAgentName();
        console.error(`[GenericAgent] LLM API call failed in ${subagentName} (${toolName}):`, errorMessage);
        console.error(`[GenericAgent] Context: task="${state.task}", iteration=${iterations}/${maxIterations}`);
        
        // Return error with context
        this.currentMode = 'orchestrator';
        return {
          status: 'error',
          error: `LLM API call failed: ${errorMessage}`,
          task: state.task,
          subagent: subagentName,
          tool: toolName,
          iteration: iterations,
          suggestion: 'Check LLM API connection and response format. The API may have returned an unexpected response structure.',
        };
      }

      // Check for empty response (likely content filtering)
      if (!response.content && (!response.toolCalls || response.toolCalls.length === 0)) {
        const subagentName = this.getEffectiveAgentName();
        console.warn(`[GenericAgent] Empty response received in ${subagentName} (${toolName}) - likely content filtering`);
        console.warn(`[GenericAgent] Context: task="${state.task}", iteration=${iterations}/${maxIterations}`);
        
        // Return error indicating content filtering
        this.currentMode = 'orchestrator';
        return {
          status: 'error',
          error: 'LLM API returned empty response - content may have been filtered by safety settings',
          task: state.task,
          subagent: subagentName,
          tool: toolName,
          iteration: iterations,
          suggestion: 'The prompt may have triggered content safety filters. Try rephrasing the prompt or adjusting API safety settings.',
        };
      }

      // Add assistant message to history
      state.messages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls,
      });

      // If no tool calls, we're done - return the output
      if (!response.toolCalls || response.toolCalls.length === 0) {
        state.currentOutput = response.content?.trim() || 'No output generated';
        this.currentMode = 'orchestrator';
        return {
          status: 'completed',
          output: state.currentOutput,
          task: state.task,
          iterations: iterations,
        };
      }

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        const tool = tools.get(toolCall.name);
        if (!tool?.handler) {
          state.messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
          });
          continue;
        }

        try {
          const toolResult = await Promise.resolve(tool.handler(toolCall.arguments));
          state.messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          });
        } catch (error) {
          state.messages.push({
            role: 'tool',
            toolCallId: toolCall.id,
            content: JSON.stringify({ error: String(error) }),
          });
        }
      }
    }

    // Max iterations reached
    state.currentOutput = state.messages[state.messages.length - 1]?.content || 'Max iterations reached';
    this.currentMode = 'orchestrator';
    return {
      status: 'completed',
      output: state.currentOutput,
      task: state.task,
      iterations: iterations,
    };
  }

  private async handleDispatchPlacementPlanner(toolCall: ToolCall): Promise<unknown> {
    this.currentMode = 'planning';
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_placement_planner' };
    }

    if (this.placementPlannerState?.active) {
      return { error: 'Placement planning already in progress' };
    }

    const { context, missingRefs } = this.buildContextFromRefs(contextRefs);
    if (missingRefs.length > 0) {
      debugLog(`[GenericAgent] WARNING: Missing context_refs for placement planner: ${missingRefs.join(', ')}`);
    }

      // Default output file if not provided
      let outputFileToUse = outputFile || 'agent/plans/content-plan.md';
      // If orchestrator mistakenly passes image-placements path to content-planner, fix it
      if (outputFileToUse.includes('image-placement')) {
        debugLog('[GenericAgent] WARNING: content-planner received image-placements path. Overriding to agent/plans/content-plan.md');
        outputFileToUse = 'agent/plans/content-plan.md';
      }
      debugLog(`[GenericAgent] handleDispatchPlacementPlanner: outputFile=${outputFileToUse}`);

    const systemPrompt = buildPlacementPlannerPrompt(context);
    this.placementPlannerState = {
      active: true,
      task,
      context,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>\n${task}\n</request>` },
      ],
      currentOutput: '',
      iterations: 1,
      toolCallId: toolCall.id,
      outputFile: outputFileToUse,
    };

    const result = await this.runOneShotSubagent(this.placementPlannerState, 'dispatch_placement_planner', 0.4);
    
    // Save the output to file if we have output
    const resultObj = result as Record<string, unknown>;
    if (resultObj['status'] === 'completed' && resultObj['output']) {
      const output = resultObj['output'] as string;
      let fileSaved = false;
      let normalizedPath: string | undefined;

      // Normalize path
      normalizedPath = outputFileToUse;
      if (normalizedPath.startsWith('plans/') && !normalizedPath.startsWith('agent/plans/')) {
        normalizedPath = `agent/${normalizedPath}`;
      } else if (!normalizedPath.startsWith('agent/')) {
        if (!normalizedPath.includes('/')) {
          normalizedPath = `agent/plans/${normalizedPath}`;
        } else {
          normalizedPath = `agent/${normalizedPath}`;
        }
      }

      try {
        // Use writeProjectFile from ProjectManager to ensure correct base path (handles desktop vs CLI)
        writeProjectFile(normalizedPath, output);
        fileSaved = true;
        debugLog(`[GenericAgent] Successfully saved content plan to ${normalizedPath}`);

        // Store reference in context store
        const variableName = contextStore.storeReference(
          normalizedPath,
          'Content Plan',
          undefined,
          'tool'
        ).variableName;
        debugLog(`[GenericAgent] Stored reference to content plan file in context store as ${variableName}`);

        // Generate preview for display (clean markdown, no code fences)
        let preview = output.length > 800 ? output.substring(0, 800) + '...' : output;
        // Remove markdown code fences if present
        preview = preview.replace(/^```[\w]*\n/gm, '').replace(/^```$/gm, '');
        const previewLines = preview.split('\n').slice(0, 20).join('\n');
        const truncatedPreview = previewLines.length < preview.length ? previewLines + '\n...' : previewLines;

        // Update result with file info and preview
        resultObj['output_file'] = normalizedPath;
        resultObj['file_saved'] = fileSaved;
        resultObj['content_plan_ref'] = variableName;
        resultObj['file_path'] = normalizedPath; // For compatibility with write_file format
        resultObj['bytes_written'] = output.length;
        resultObj['total_lines'] = output.split('\n').length;
        resultObj['preview'] = truncatedPreview;
        resultObj['content'] = output; // Also add to content for display
      } catch (err) {
        debugLog(`[GenericAgent] ERROR: Failed to save content plan to ${outputFileToUse}: ${err}`);
        resultObj['file_saved'] = false;
        resultObj['error'] = `Failed to save content plan: ${String(err)}`;
      }
    }

    this.placementPlannerState = null;
    return result;
  }

  private async handleDispatchImagePlacer(toolCall: ToolCall): Promise<unknown> {
    this.currentMode = 'content';
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_image_placer' };
    }

    if (this.imagePlacerState?.active) {
      return { error: 'Image placement already in progress' };
    }

    // Image-placer ALWAYS needs $transcript - ensure it's included even if not passed
    const requiredRefs = contextRefs || [];
    if (!requiredRefs.includes('$transcript')) {
      debugLog(`[GenericAgent] Auto-adding $transcript to context_refs for image-placer (required but not provided)`);
      requiredRefs.push('$transcript');
    }

    const { context, missingRefs } = this.buildContextFromRefs(requiredRefs);
    if (missingRefs.length > 0) {
      debugLog(`[GenericAgent] WARNING: Missing context_refs for image placer: ${missingRefs.join(', ')}`);
    }

      // Default output file if not provided
      let outputFileToUse = outputFile || 'agent/content/image-placements.md';
      // If orchestrator mistakenly passes content-plan path to image-placer, fix it
      if (outputFileToUse.includes('content-plan')) {
        debugLog('[GenericAgent] WARNING: image-placer received content-plan path. Overriding to agent/content/image-placements.md');
        outputFileToUse = 'agent/content/image-placements.md';
      }
      debugLog(`[GenericAgent] handleDispatchImagePlacer: outputFile=${outputFileToUse}`);

    const systemPrompt = buildImagePlacerPrompt(context);
    this.imagePlacerState = {
      active: true,
      task,
      context,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>\n${task}\n</request>` },
      ],
      currentOutput: '',
      iterations: 1,
      toolCallId: toolCall.id,
      outputFile: outputFileToUse,
    };

    const result = await this.runOneShotSubagent(this.imagePlacerState, 'dispatch_image_placer', 0.4);
    
    // Save the output to file if we have output
    const resultObj = result as Record<string, unknown>;
    if (resultObj['status'] === 'completed' && resultObj['output']) {
      const output = resultObj['output'] as string;
      let fileSaved = false;
      let normalizedPath: string | undefined;

      // Normalize path
      normalizedPath = outputFileToUse;
      if (normalizedPath.startsWith('content/') && !normalizedPath.startsWith('agent/content/')) {
        normalizedPath = `agent/${normalizedPath}`;
      } else if (!normalizedPath.startsWith('agent/')) {
        if (!normalizedPath.includes('/')) {
          normalizedPath = `agent/content/${normalizedPath}`;
        } else {
          normalizedPath = `agent/${normalizedPath}`;
        }
      }

      try {
        // Use getCurrentProjectBasePath() to get the correct project directory
        const basePath = getCurrentProjectBasePath();
        const projectDir = path.join(basePath, '.kshana');
        const filePath = path.join(projectDir, normalizedPath);
        debugLog(`[GenericAgent] Attempting to save image placement plan to: ${filePath} (normalized from: ${outputFileToUse})`);

        // Ensure parent directory exists
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
          debugLog(`[GenericAgent] Creating parent directory: ${parentDir}`);
          fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.writeFileSync(filePath, output, 'utf-8');
        fileSaved = true;
        debugLog(`[GenericAgent] Successfully saved image placement plan to ${normalizedPath}`);

        // Store reference in context store
        const variableName = contextStore.storeReference(
          normalizedPath,
          'Image Placement Plan',
          undefined,
          'tool'
        ).variableName;
        debugLog(`[GenericAgent] Stored reference to image placement plan file in context store as ${variableName}`);

        // Generate preview for display (clean markdown, no code fences)
        let preview = output.length > 800 ? output.substring(0, 800) + '...' : output;
        // Remove markdown code fences if present
        preview = preview.replace(/^```[\w]*\n/gm, '').replace(/^```$/gm, '');
        const previewLines = preview.split('\n').slice(0, 20).join('\n');
        const truncatedPreview = previewLines.length < preview.length ? previewLines + '\n...' : previewLines;

        // Update result with file info and preview
        resultObj['output_file'] = normalizedPath;
        resultObj['file_saved'] = fileSaved;
        resultObj['image_placements_ref'] = variableName;
        resultObj['file_path'] = normalizedPath; // For compatibility with write_file format
        resultObj['bytes_written'] = output.length;
        resultObj['total_lines'] = output.split('\n').length;
        resultObj['preview'] = truncatedPreview;
        resultObj['content'] = output; // Also add to content for display
      } catch (err) {
        debugLog(`[GenericAgent] ERROR: Failed to save image placement plan to ${outputFileToUse}: ${err}`);
        resultObj['file_saved'] = false;
        resultObj['error'] = `Failed to save image placement plan: ${String(err)}`;
      }
    }

    this.imagePlacerState = null;
    return result;
  }

  private async handleDispatchVideoPlacer(toolCall: ToolCall): Promise<unknown> {
    this.currentMode = 'content';
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_video_placer' };
    }

    if (this.videoPlacerState?.active) {
      return { error: 'Video placement already in progress' };
    }

    // Video-placer needs $transcript, $image_placements, and $infographic_placements (to avoid collisions)
    const requiredRefs = contextRefs || [];
    if (!requiredRefs.includes('$transcript')) {
      debugLog(`[GenericAgent] Auto-adding $transcript to context_refs for video-placer (required but not provided)`);
      requiredRefs.push('$transcript');
    }
    if (!requiredRefs.includes('$image_placements')) {
      debugLog(`[GenericAgent] Auto-adding $image_placements to context_refs for video-placer (required but not provided)`);
      requiredRefs.push('$image_placements');
    }
    if (!requiredRefs.includes('$infographic_placements')) {
      debugLog(`[GenericAgent] Auto-adding $infographic_placements to context_refs for video-placer (required but not provided)`);
      requiredRefs.push('$infographic_placements');
    }

    const { context, missingRefs } = this.buildContextFromRefs(requiredRefs);
    if (missingRefs.length > 0) {
      debugLog(`[GenericAgent] WARNING: Missing context_refs for video placer: ${missingRefs.join(', ')}`);
    }

    // Default output file if not provided
    let outputFileToUse = outputFile || 'agent/content/video-placements.md';
    // If orchestrator mistakenly passes content-plan path to video-placer, fix it
    if (outputFileToUse.includes('content-plan')) {
      debugLog('[GenericAgent] WARNING: video-placer received content-plan path. Overriding to agent/content/video-placements.md');
      outputFileToUse = 'agent/content/video-placements.md';
    }
    debugLog(`[GenericAgent] handleDispatchVideoPlacer: outputFile=${outputFileToUse}`);

    const systemPrompt = buildVideoPlacerPrompt(context);
    this.videoPlacerState = {
      active: true,
      task,
      context,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>\n${task}\n</request>` },
      ],
      currentOutput: '',
      iterations: 1,
      toolCallId: toolCall.id,
      outputFile: outputFileToUse,
    };

    const result = await this.runOneShotSubagent(this.videoPlacerState, 'dispatch_video_placer', 0.4);
    
    // Save the output to file if we have output
    const resultObj = result as Record<string, unknown>;
    if (resultObj['status'] === 'completed' && resultObj['output']) {
      const output = resultObj['output'] as string;
      let fileSaved = false;
      let normalizedPath: string | undefined;

      // Normalize path
      normalizedPath = outputFileToUse;
      if (normalizedPath.startsWith('content/') && !normalizedPath.startsWith('agent/content/')) {
        normalizedPath = `agent/${normalizedPath}`;
      } else if (!normalizedPath.startsWith('agent/')) {
        if (!normalizedPath.includes('/')) {
          normalizedPath = `agent/content/${normalizedPath}`;
        } else {
          normalizedPath = `agent/${normalizedPath}`;
        }
      }

      try {
        // Use getCurrentProjectBasePath() to get the correct project directory
        const basePath = getCurrentProjectBasePath();
        const projectDir = path.join(basePath, '.kshana');
        const filePath = path.join(projectDir, normalizedPath);
        debugLog(`[GenericAgent] Attempting to save video placement plan to: ${filePath} (normalized from: ${outputFileToUse})`);

        // Ensure parent directory exists
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
          debugLog(`[GenericAgent] Creating parent directory: ${parentDir}`);
          fs.mkdirSync(parentDir, { recursive: true });
        }

        fs.writeFileSync(filePath, output, 'utf-8');
        fileSaved = true;
        debugLog(`[GenericAgent] Successfully saved video placement plan to ${normalizedPath}`);

        // Store reference in context store
        const variableName = contextStore.storeReference(
          normalizedPath,
          'Video Placement Plan',
          undefined,
          'tool'
        ).variableName;
        debugLog(`[GenericAgent] Stored reference to video placement plan file in context store as ${variableName}`);

        // Generate preview for display (clean markdown, no code fences)
        let preview = output.length > 800 ? output.substring(0, 800) + '...' : output;
        // Remove markdown code fences if present
        preview = preview.replace(/^```[\w]*\n/gm, '').replace(/^```$/gm, '');
        const previewLines = preview.split('\n').slice(0, 20).join('\n');
        const truncatedPreview = previewLines.length < preview.length ? previewLines + '\n...' : previewLines;

        // Update result with file info and preview
        resultObj['output_file'] = normalizedPath;
        resultObj['file_saved'] = fileSaved;
        resultObj['video_placements_ref'] = variableName;
        resultObj['file_path'] = normalizedPath; // For compatibility with write_file format
        resultObj['bytes_written'] = output.length;
        resultObj['total_lines'] = output.split('\n').length;
        resultObj['preview'] = truncatedPreview;
        resultObj['content'] = output; // Also add to content for display
      } catch (err) {
        debugLog(`[GenericAgent] ERROR: Failed to save video placement plan to ${outputFileToUse}: ${err}`);
        resultObj['file_saved'] = false;
        resultObj['error'] = `Failed to save video placement plan: ${String(err)}`;
      }
    }

    this.videoPlacerState = null;
    return result;
  }

  private async handleDispatchInfographicsPlacer(toolCall: ToolCall): Promise<unknown> {
    this.currentMode = 'content';
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_infographics_placer' };
    }

    if (this.infographicsPlacerState?.active) {
      return { error: 'Infographics placement already in progress' };
    }

    const requiredRefs = contextRefs || [];
    if (!requiredRefs.includes('$transcript')) {
      debugLog(`[GenericAgent] Auto-adding $transcript to context_refs for infographics-placer (required but not provided)`);
      requiredRefs.push('$transcript');
    }
    if (!requiredRefs.includes('$content_plan')) {
      debugLog(`[GenericAgent] Auto-adding $content_plan to context_refs for infographics-placer (required but not provided)`);
      requiredRefs.push('$content_plan');
    }
    if (!requiredRefs.includes('$image_placements')) {
      debugLog(`[GenericAgent] Auto-adding $image_placements to context_refs for infographics-placer (required but not provided)`);
      requiredRefs.push('$image_placements');
    }

    const { context, missingRefs } = this.buildContextFromRefs(requiredRefs);
    if (missingRefs.length > 0) {
      debugLog(`[GenericAgent] WARNING: Missing context_refs for infographics placer: ${missingRefs.join(', ')}`);
    }

    let outputFileToUse = outputFile || 'agent/content/infographic-placements.md';
    if (outputFileToUse.includes('content-plan') || outputFileToUse.includes('image-placements')) {
      debugLog('[GenericAgent] WARNING: infographics-placer received wrong path. Overriding to agent/content/infographic-placements.md');
      outputFileToUse = 'agent/content/infographic-placements.md';
    }
    debugLog(`[GenericAgent] handleDispatchInfographicsPlacer: outputFile=${outputFileToUse}`);

    const systemPrompt = buildInfographicsPlacerPrompt(context);
    this.infographicsPlacerState = {
      active: true,
      task,
      context,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>\n${task}\n</request>` },
      ],
      currentOutput: '',
      iterations: 1,
      toolCallId: toolCall.id,
      outputFile: outputFileToUse,
    };

    const result = await this.runOneShotSubagent(this.infographicsPlacerState, 'dispatch_infographics_placer', 0.4);

    const resultObj = result as Record<string, unknown>;
    if (resultObj['status'] === 'completed' && resultObj['output']) {
      const output = resultObj['output'] as string;
      let fileSaved = false;
      let normalizedPath: string | undefined = outputFileToUse;
      if (normalizedPath.startsWith('content/') && !normalizedPath.startsWith('agent/content/')) {
        normalizedPath = `agent/${normalizedPath}`;
      } else if (!normalizedPath.startsWith('agent/')) {
        normalizedPath = normalizedPath.includes('/') ? `agent/${normalizedPath}` : `agent/content/${normalizedPath}`;
      }

      try {
        const basePath = getCurrentProjectBasePath();
        const projectDir = path.join(basePath, '.kshana');
        const filePath = path.join(projectDir, normalizedPath);
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(filePath, output, 'utf-8');
        fileSaved = true;
        const { variableName } = contextStore.storeReference(
          normalizedPath,
          'Infographic Placement Plan',
          undefined,
          'tool'
        );
        debugLog(`[GenericAgent] Stored reference to infographic placement plan as ${variableName}`);

        let preview = output.length > 800 ? output.substring(0, 800) + '...' : output;
        preview = preview.replace(/^```[\w]*\n/gm, '').replace(/^```$/gm, '');
        const previewLines = preview.split('\n').slice(0, 20).join('\n');
        const truncatedPreview = previewLines.length < preview.length ? previewLines + '\n...' : previewLines;

        resultObj['output_file'] = normalizedPath;
        resultObj['file_saved'] = fileSaved;
        resultObj['infographic_placements_ref'] = variableName;
        resultObj['file_path'] = normalizedPath;
        resultObj['bytes_written'] = output.length;
        resultObj['total_lines'] = output.split('\n').length;
        resultObj['preview'] = truncatedPreview;
        resultObj['content'] = output;
      } catch (err) {
        debugLog(`[GenericAgent] ERROR: Failed to save infographic placement plan: ${String(err)}`);
        resultObj['file_saved'] = false;
        resultObj['error'] = `Failed to save infographic placement plan: ${String(err)}`;
      }
    }

    this.infographicsPlacerState = null;
    return result;
  }

  private async handleDispatchVideoReplacer(toolCall: ToolCall): Promise<unknown> {
    this.currentMode = 'video';
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contextRefs = args['context_refs'] as string[] | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_video_replacer' };
    }

    if (this.videoReplacerState?.active) {
      return { error: 'Video replacement already in progress' };
    }

    const { context, missingRefs } = this.buildContextFromRefs(contextRefs);
    if (missingRefs.length > 0) {
      debugLog(`[GenericAgent] WARNING: Missing context_refs for video replacer: ${missingRefs.join(', ')}`);
    }

    const systemPrompt = buildVideoReplacerPrompt(context);
    this.videoReplacerState = {
      active: true,
      task,
      context,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>\n${task}\n</request>` },
      ],
      currentOutput: '',
      iterations: 1,
      toolCallId: toolCall.id,
    };

    const result = await this.runOneShotSubagent(this.videoReplacerState, 'dispatch_video_replacer', 0.3);
    this.videoReplacerState = null;
    return result;
  }

  /**
   * Check if there's an active image generation session awaiting user input.
   */
  isImageGenActive(): boolean {
    return this.imageGenState?.active ?? false;
  }

  /**
   * Handle dispatch_image_agent tool - spawns a sub-agent for image prompt crafting.
   * The sub-agent crafts detailed prompts, gets user feedback, and generates the image once approved.
   *
   * Supports two modes:
   * 1. Text-to-Image: For character_ref/setting_ref (no reference images needed)
   * 2. Image+Text-to-Image: For scenes (requires reference images for consistency)
   */
  private async handleDispatchImageAgent(toolCall: ToolCall): Promise<unknown> {
    // Set mode for UI display
    this.currentMode = 'image';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    let context = args['context'] as string | undefined;
    const contextRef = args['context_ref'] as string | undefined;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const sceneNumber = (args['scene_number'] as number) ?? 1;
    const imageType = args['image_type'] as 'scene' | 'character_ref' | 'setting_ref' | undefined;
    const characterName = args['character_name'] as string | undefined;
    const settingName = args['setting_name'] as string | undefined;
    const referenceImages = args['reference_images'] as Array<{
      image_id: string;
      type: 'character' | 'setting';
      name: string;
    }> | undefined;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_image_agent' };
    }

    // Resolve context_refs (array) if provided - combines multiple contexts
    if (contextRefs && contextRefs.length > 0) {
      const contextParts: string[] = [];
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push(`## ${ref} (${stored.label})\n\n${stored.content}`);
          debugLog(`[GenericAgent] Resolved context_ref ${ref} for image agent (${stored.label}, ${stored.content.length} chars)`);
        } else {
          debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
        }
      }
      if (contextParts.length > 0) {
        context = contextParts.join('\n\n---\n\n');
      }
    }
    // Fallback to singular context_ref if provided
    else if (contextRef) {
      const stored = contextStore.get(contextRef);
      if (stored) {
        context = stored.content;
        debugLog(`[GenericAgent] Resolved context_ref ${contextRef} for image agent (${stored.label}, ${stored.content.length} chars)`);
      } else {
        return { error: `Context reference not found: ${contextRef}` };
      }
    }

    // Warn about long inline context that should use context_ref
    if (context && context.length > 500 && !contextRef && !contextRefs) {
      debugLog(`[GenericAgent] WARNING: Long context (${context.length} chars) passed to dispatch_image_agent without context_ref. Consider using store_context.`);
    }

    // Check if we're resuming an existing session
    if (this.imageGenState?.active) {
      return { error: 'Image generation already in progress' };
    }

    // Determine generation mode based on image type and reference availability
    const isSceneImage = imageType === 'scene';
    const hasReferences = referenceImages && referenceImages.length > 0;
    const generationMode: 'text_to_image' | 'image_text_to_image' =
      isSceneImage && hasReferences ? 'image_text_to_image' : 'text_to_image';

    // Warn if scene image requested without references
    if (isSceneImage && !hasReferences) {
      return {
        error: 'Scene images require reference_images for character/setting consistency.',
        suggestion: 'Please provide reference_images array with character and setting references, or generate reference images first using image_type "character_ref" or "setting_ref".',
        image_type: imageType,
      };
    }

    // Build enhanced context for image+text-to-image mode
    let enhancedContext = context ?? '';
    if (generationMode === 'image_text_to_image' && referenceImages) {
      const refDescriptions = referenceImages.map(ref =>
        `- ${ref.type === 'character' ? 'Character' : 'Setting'} "${ref.name}" (ref: ${ref.image_id})`
      ).join('\n');
      enhancedContext += `\n\n<reference_images>\nThe following reference images will be used for visual consistency:\n${refDescriptions}\n\nIMPORTANT: The generated image must maintain visual consistency with these references. Characters should look the same as in their reference images. Settings should match their reference style.\n</reference_images>`;
    }

    // Initialize image gen state with the specialized prompt
    const imageGenSystemPrompt = buildImageGenerationPrompt(task, enhancedContext);

    this.imageGenState = {
      active: true,
      task,
      context: enhancedContext,
      messages: [
        { role: 'system', content: imageGenSystemPrompt },
        { role: 'user', content: '<request>\nPlease craft a detailed image generation prompt for this task.\n</request>' },
      ],
      currentPrompt: '',
      negativePrompt: '',
      aspectRatio: '16:9',
      iterations: 0,
      imageParams: {
        scene_number: sceneNumber,
        image_type: imageType,
        character_name: characterName,
        setting_name: settingName,
      },
      referenceImages,
      generationMode,
      toolCallId: toolCall.id,
    };

    // Generate the initial prompt
    return this.continueImageGenLoop();
  }

  /**
   * Continue the image generation loop - generates prompt and asks for user approval.
   */
  private async continueImageGenLoop(): Promise<unknown> {
    if (!this.imageGenState) {
      return { error: 'No active image generation session' };
    }

    const maxIterations = 10;

    if (this.imageGenState.iterations >= maxIterations) {
      const result = {
        status: 'max_iterations',
        prompt: this.imageGenState.currentPrompt,
        negative_prompt: this.imageGenState.negativePrompt,
        aspect_ratio: this.imageGenState.aspectRatio,
        task: this.imageGenState.task,
        message: 'Reached maximum iterations for prompt refinement. Using the last version.',
      };
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    this.imageGenState.iterations++;

    try {
      // Generate or refine the prompt with streaming
      let promptContent = '';
      let isFirstChunk = true;

      // If this is a subsequent iteration (after feedback), we need to reset the streaming display
      const shouldReset = this.imageGenState.iterations > 1;

      for await (const chunk of this.llm.generateStream({
        messages: this.imageGenState.messages,
        temperature: 0.7,
      })) {
        if (chunk.content) {
          promptContent += chunk.content;
          // Emit tool_streaming to show content inside the ToolCallDisplay
          // On first chunk of a regeneration, include reset flag to clear old content and show display
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.imageGenState.toolCallId,
            chunk: chunk.content,
            done: false,
            agentName: this.getEffectiveAgentName(),
            toolName: 'dispatch_image_agent',
            reset: shouldReset && isFirstChunk,
          });
          isFirstChunk = false;
        }
        if (chunk.done) {
          this.emit({
            type: 'tool_streaming',
            toolCallId: this.imageGenState.toolCallId,
            chunk: '',
            done: true,
            agentName: this.getEffectiveAgentName(),
          });
        }
      }

      // Parse the prompt components from the response
      const parsed = this.parseImagePromptResponse(promptContent);
      this.imageGenState.currentPrompt = parsed.prompt;
      this.imageGenState.negativePrompt = parsed.negativePrompt;
      this.imageGenState.aspectRatio = parsed.aspectRatio;

      // Add assistant response to history
      this.imageGenState.messages.push({
        role: 'assistant',
        content: promptContent,
      });

      // Return status indicating we need user approval
      const verificationQuestion = this.imageGenState.iterations === 1
        ? 'I\'ve crafted an image prompt. Would you like to generate the image or provide feedback?'
        : 'I\'ve updated the prompt based on your feedback. Would you like to generate the image or provide more feedback?';

      return {
        status: 'awaiting_prompt_approval',
        prompt: this.imageGenState.currentPrompt,
        negative_prompt: this.imageGenState.negativePrompt,
        aspect_ratio: this.imageGenState.aspectRatio,
        task: this.imageGenState.task,
        iterations: this.imageGenState.iterations,
        question: verificationQuestion,
        options: [
          { label: 'Generate image', description: 'Proceed with this prompt and generate the image' },
          { label: 'Provide feedback', description: 'Modify the prompt with your input' },
        ],
        autoApproveTimeoutMs: 15000, // 15 seconds countdown for image prompt approval
      };
    } catch (error) {
      const failedTask = this.imageGenState?.task;
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Image prompt generation failed: ${String(error)}`,
        task: failedTask,
      };
    }
  }

  /**
   * Parse the image prompt response to extract prompt, negative prompt, and aspect ratio.
   */
  private parseImagePromptResponse(response: string): {
    prompt: string;
    negativePrompt: string;
    aspectRatio: string;
  } {
    let prompt = '';
    let negativePrompt = 'blurry, distorted, low quality, deformed, ugly, bad anatomy';
    let aspectRatio = '16:9';

    // Try to extract Image Prompt section
    const promptMatch = response.match(/\*\*Image Prompt:\*\*\s*\n([^\n*]+(?:\n(?!\*\*)[^\n*]+)*)/i);
    if (promptMatch?.[1]) {
      prompt = promptMatch[1].trim();
    }

    // Try to extract Negative Prompt section
    const negativeMatch = response.match(/\*\*Negative Prompt:\*\*\s*\n([^\n*]+(?:\n(?!\*\*)[^\n*]+)*)/i);
    if (negativeMatch?.[1]) {
      negativePrompt = negativeMatch[1].trim();
    }

    // Try to extract Aspect Ratio section
    const aspectMatch = response.match(/\*\*Aspect Ratio:\*\*\s*\n?\s*([^\n]+)/i);
    if (aspectMatch?.[1]) {
      const ratio = aspectMatch[1].trim();
      // Validate aspect ratio format
      if (/^\d+:\d+$/.test(ratio)) {
        aspectRatio = ratio;
      }
    }

    // If no structured prompt found, use the whole response as the prompt
    if (!prompt) {
      // Remove markdown headers and rationale sections
      prompt = response
        .replace(/\*\*[^*]+\*\*/g, '')
        .replace(/##[^\n]+\n/g, '')
        .trim()
        .split('\n')[0] || response.slice(0, 500);
    }

    return { prompt, negativePrompt, aspectRatio };
  }

  /**
   * Handle user response to image generation prompt approval.
   * Uses LLM to classify whether the response is approval or feedback.
   */
  async handleImageGenResponse(userResponse: string): Promise<unknown> {
    if (!this.imageGenState) {
      return { error: 'No active image generation session' };
    }

    // Use LLM to classify the user's intent
    const isApproval = await this.classifyImageGenResponse(userResponse);

    if (isApproval) {
      // User approved - execute the actual image generation
      return this.executeImageGeneration();
    }

    // User wants to provide feedback - use their input with XML tags
    this.imageGenState.messages.push({
      role: 'user',
      content: `<user_feedback>\n${userResponse}\n</user_feedback>\n\n<request>\nPlease revise the image prompt based on the feedback above.\n</request>`,
    });

    // Continue the image gen loop
    return this.continueImageGenLoop();
  }

  /**
   * Use LLM to classify whether user response indicates approval or feedback for image generation.
   */
  private async classifyImageGenResponse(userResponse: string): Promise<boolean> {
    // Load classification prompt from file
    const classificationPrompt = loadAndRenderMarkdown('system/classification/image-approval.md', {
      user_response: userResponse,
    });

    try {
      const response = await this.llm.generate({
        messages: [
          { role: 'user', content: classificationPrompt },
        ],
        temperature: 0,
        maxTokens: 10,
      });

      const result = (response.content ?? '').trim().toUpperCase();
      return result.includes('APPROVE');
    } catch {
      // On error, fall back to simple pattern matching
      const lower = userResponse.toLowerCase().trim();
      const approvalPatterns = ['yes', 'ok', 'okay', 'generate', 'go', 'create', 'make', 'proceed', 'lgtm', 'y', '1'];
      return approvalPatterns.some(p => lower === p || lower.includes(p));
    }
  }

  /**
   * Execute the actual image generation after user approval.
   */
  private async executeImageGeneration(): Promise<unknown> {
    if (!this.imageGenState) {
      return { error: 'No active image generation session' };
    }

    const {
      currentPrompt,
      negativePrompt,
      aspectRatio,
      imageParams,
      task,
      referenceImages,
      generationMode,
    } = this.imageGenState;

    // Get the generate_image tool
    const generateImageTool = this.tools.get('generate_image');
    if (!generateImageTool?.handler) {
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'generate_image tool not available',
        prompt: currentPrompt,
        task,
      };
    }

    // Get the wait_for_job tool
    const waitForJobTool = this.tools.get('wait_for_job');
    if (!waitForJobTool?.handler) {
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'wait_for_job tool not available',
        prompt: currentPrompt,
        task,
      };
    }

    // Build arguments for generate_image
    const generateArgs: Record<string, unknown> = {
      prompt: currentPrompt,
      negative_prompt: negativePrompt,
      aspect_ratio: aspectRatio,
      scene_number: imageParams.scene_number,
      generation_mode: generationMode,
    };

    if (imageParams.image_type) {
      generateArgs['image_type'] = imageParams.image_type;
    }
    if (imageParams.character_name) {
      generateArgs['character_name'] = imageParams.character_name;
    }
    if (imageParams.setting_name) {
      generateArgs['setting_name'] = imageParams.setting_name;
    }

    // Include reference images for image+text-to-image mode
    if (generationMode === 'image_text_to_image' && referenceImages && referenceImages.length > 0) {
      generateArgs['reference_images'] = referenceImages;
    }

    const toolCallId = `img-gen-${Date.now()}`;

    // Emit that we're generating the image
    this.emit({
      type: 'tool_call',
      toolCallId,
      toolName: 'generate_image',
      arguments: generateArgs,
      agentName: this.getEffectiveAgentName(),
    });

    try {
      // Step 1: Submit the image generation job
      const submitResult = await Promise.resolve(generateImageTool.handler(generateArgs));
      const submitResultObj = submitResult as Record<string, unknown>;

      // Check if submission failed
      if (submitResultObj['status'] === 'error') {
        const finalState = { ...this.imageGenState };
        this.imageGenState = null;
        this.currentMode = 'orchestrator';

        this.emit({
          type: 'tool_result',
          toolCallId,
          toolName: 'generate_image',
          result: submitResult,
          isError: true,
          agentName: this.getEffectiveAgentName(),
        });

        return {
          status: 'error',
          error: submitResultObj['error'] as string,
          prompt: finalState.currentPrompt,
          task: finalState.task,
        };
      }

      const jobId = submitResultObj['job_id'] as string;
      if (!jobId) {
        throw new Error('No job_id returned from generate_image');
      }

      // Emit tool result for generate_image with job_id prominently displayed
      this.emit({
        type: 'tool_result',
        toolCallId,
        toolName: 'generate_image',
        result: submitResult,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });

      // Emit that we're waiting for the job
      const waitToolCallId = `wait-job-${Date.now()}`;
      this.emit({
        type: 'tool_call',
        toolCallId: waitToolCallId,
        toolName: 'wait_for_job',
        arguments: { job_id: jobId },
        agentName: this.getEffectiveAgentName(),
      });

      // Step 2: Wait for the job to complete
      const waitResult = await Promise.resolve(waitForJobTool.handler({ job_id: jobId }));
      const waitResultObj = waitResult as Record<string, unknown>;

      // Clear the state
      const finalState = { ...this.imageGenState };
      this.imageGenState = null;
      this.currentMode = 'orchestrator';

      // Emit tool result for wait_for_job
      this.emit({
        type: 'tool_result',
        toolCallId: waitToolCallId,
        toolName: 'wait_for_job',
        result: waitResult,
        isError: waitResultObj['status'] === 'error' || waitResultObj['status'] === 'failed',
        agentName: this.getEffectiveAgentName(),
      });

      // Check if job failed
      if (waitResultObj['status'] === 'error' || waitResultObj['status'] === 'failed') {
        return {
          status: 'error',
          error: waitResultObj['error'] as string || 'Job failed',
          prompt: finalState.currentPrompt,
          task: finalState.task,
          job_id: jobId,
        };
      }

      return {
        status: 'completed',
        prompt: finalState.currentPrompt,
        negative_prompt: finalState.negativePrompt,
        aspect_ratio: finalState.aspectRatio,
        task: finalState.task,
        iterations: finalState.iterations,
        job_id: jobId,
        artifact_id: waitResultObj['artifact_id'],
        file_path: waitResultObj['file_path'],
        message: 'Image generated successfully.',
      };
    } catch (error) {
      this.imageGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Image generation failed: ${String(error)}`,
        prompt: currentPrompt,
        task,
      };
    }
  }

  /**
   * Handle dispatch_video_agent tool - spawns a sub-agent for video generation.
   * Presents video parameters to user for approval before generating.
   */
  private async handleDispatchVideoAgent(toolCall: ToolCall): Promise<unknown> {
    // Set mode for UI display
    this.currentMode = 'video';

    const args = toolCall.arguments;
    const task = args['task'] as string;
    const sceneImageArtifactId = args['scene_image_artifact_id'] as string | undefined;
    const sceneNumber = (args['scene_number'] as number) ?? 1;
    const motionDescription = args['motion_description'] as string | undefined;
    const contextRef = args['context_ref'] as string | undefined;
    const contextRefs = args['context_refs'] as string[] | undefined;
    const duration = (args['duration'] as number) ?? 4;

    if (!task) {
      this.currentMode = 'orchestrator';
      return { error: 'No task provided for dispatch_video_agent' };
    }

    // Check if we're in YouTube workflow (VIDEO_GENERATION phase) or legacy workflow (VIDEO phase)
    // In YouTube workflow, scene_image_artifact_id is NOT required (videos are generated from text prompts)
    // In legacy workflow, scene_image_artifact_id IS required (videos are generated from scene images)
    let requiresSceneImage = true;
    try {
      const project = loadProject();
      if (project) {
        const isYouTube = isYouTubeWorkflow(project.inputType);
        const isVideoGenerationPhase = project.currentPhase === WorkflowPhase.VIDEO_GENERATION;
        const isLegacyVideoPhase = project.currentPhase === WorkflowPhase.VIDEO;
        
        // YouTube workflow's VIDEO_GENERATION phase doesn't require scene images
        // Legacy workflow's VIDEO phase does require scene images
        if (isYouTube && isVideoGenerationPhase) {
          requiresSceneImage = false;
          debugLog(`[GenericAgent] YouTube workflow VIDEO_GENERATION phase - scene_image_artifact_id not required`);
        } else if (isLegacyVideoPhase) {
          requiresSceneImage = true;
          debugLog(`[GenericAgent] Legacy workflow VIDEO phase - scene_image_artifact_id required`);
        }
      }
    } catch (err) {
      debugLog(`[GenericAgent] Failed to check workflow type, defaulting to requiring scene_image_artifact_id: ${err}`);
      // Default to requiring it if we can't determine
      requiresSceneImage = true;
    }

    // Validate scene_image_artifact_id based on workflow requirements
    const isStitchOperation = task.toLowerCase().includes('stitch');
    if (requiresSceneImage && !sceneImageArtifactId && !isStitchOperation) {
      this.currentMode = 'orchestrator';
      return { error: 'scene_image_artifact_id is required for video generation in this workflow' };
    }

    // Resolve context_refs (array) if provided - combines multiple contexts
    let context = '';
    if (contextRefs && contextRefs.length > 0) {
      const contextParts: string[] = [];
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push(`## ${ref} (${stored.label})\n\n${stored.content}`);
          debugLog(`[GenericAgent] Resolved context_ref ${ref} for video agent (${stored.label}, ${stored.content.length} chars)`);
        } else {
          debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
        }
      }
      if (contextParts.length > 0) {
        context = contextParts.join('\n\n---\n\n');
      }
    }
    // Fallback to singular context_ref if provided
    else if (contextRef) {
      const stored = contextStore.get(contextRef);
      if (stored) {
        context = stored.content;
        debugLog(`[GenericAgent] Resolved context_ref ${contextRef} for video agent (${stored.label}, ${stored.content.length} chars)`);
      } else {
        return { error: `Context reference not found: ${contextRef}` };
      }
    }

    // Check if we're already in a video generation session
    if (this.videoGenState?.active) {
      return { error: 'Video generation already in progress' };
    }

    // Initialize video gen state
    // Note: sceneImageArtifactId may be undefined for YouTube workflow (VIDEO_GENERATION phase)
    this.videoGenState = {
      active: true,
      task,
      sceneNumber,
      sceneImageArtifactId: sceneImageArtifactId ?? undefined,
      motionDescription,
      context,
      messages: [],
      currentParams: {
        duration,
        fps: 24,
        motionStrength: 0.7,
      },
      iterations: 0,
      toolCallId: toolCall.id,
    };

    // Build a summary for user approval
    const imageInfo = sceneImageArtifactId 
      ? `- Source Image: ${sceneImageArtifactId}`
      : `- Source: Text prompt (YouTube workflow)`;
    const paramSummary = `**Video Generation Parameters:**
- Scene: #${sceneNumber}
${imageInfo}
- Duration: ${duration} seconds
- Motion: ${motionDescription ?? 'Auto-determined based on scene'}
- Task: ${task}`;

    // Return status indicating we need user approval
    // videoGenState is guaranteed to be set after initialization above
    if (!this.videoGenState) {
      return { error: 'Video generation state not initialized' };
    }
    return {
      status: 'awaiting_approval',
      params: this.videoGenState.currentParams,
      scene_number: sceneNumber,
      image_artifact_id: sceneImageArtifactId,
      motion_description: motionDescription,
      task,
      question: `I'm ready to generate video for scene ${sceneNumber}. Here are the parameters:\n\n${paramSummary}\n\nWould you like to proceed or adjust the parameters?`,
      options: [
        { label: 'Generate video', description: 'Proceed with these parameters' },
        { label: 'Provide feedback', description: 'Modify the parameters' },
      ],
      autoApproveTimeoutMs: 15000, // 15 seconds countdown
    };
  }

  /**
   * Handle user response to video generation approval.
   */
  async handleVideoGenResponse(userResponse: string): Promise<unknown> {
    if (!this.videoGenState) {
      return { error: 'No active video generation session' };
    }

    // Use simple pattern matching to classify response
    const lower = userResponse.toLowerCase().trim();
    const approvalPatterns = ['yes', 'ok', 'okay', 'generate', 'go', 'proceed', 'create', 'make', 'lgtm', 'y', '1'];
    const isApproval = approvalPatterns.some(p => lower === p || lower.startsWith(p));

    if (isApproval) {
      // User approved - execute video generation
      return this.executeVideoGeneration();
    }

    // User wants to provide feedback
    this.videoGenState.iterations++;
    if (this.videoGenState.iterations >= 5) {
      const result = {
        status: 'max_iterations',
        params: this.videoGenState.currentParams,
        task: this.videoGenState.task,
        message: 'Reached maximum iterations for parameter refinement. Using the last version.',
      };
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    // Parse feedback for parameter changes (simple parsing)
    if (lower.includes('duration') && /\d+/.test(lower)) {
      const match = lower.match(/(\d+)\s*(?:s|sec|seconds?)?/);
      if (match?.[1]) {
        this.videoGenState.currentParams.duration = parseInt(match[1], 10);
      }
    }

    // Return updated parameters for approval
    return {
      status: 'awaiting_approval',
      params: this.videoGenState.currentParams,
      scene_number: this.videoGenState.sceneNumber,
      image_artifact_id: this.videoGenState.sceneImageArtifactId,
      motion_description: this.videoGenState.motionDescription,
      task: this.videoGenState.task,
      iterations: this.videoGenState.iterations,
      question: `I've updated the parameters based on your feedback. Would you like to proceed or make more adjustments?`,
      options: [
        { label: 'Generate video', description: 'Proceed with these parameters' },
        { label: 'Provide feedback', description: 'Make more changes' },
      ],
      autoApproveTimeoutMs: 15000,
    };
  }

  /**
   * Execute the actual video generation after user approval.
   */
  private async executeVideoGeneration(): Promise<unknown> {
    if (!this.videoGenState) {
      return { error: 'No active video generation session' };
    }

    const {
      task,
      sceneNumber,
      sceneImageArtifactId,
      motionDescription,
      currentParams,
    } = this.videoGenState;

    // Get the generate_video tool
    const generateVideoTool = this.tools.get('generate_video');
    if (!generateVideoTool?.handler) {
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'generate_video tool not available',
        task,
      };
    }

    // Get the wait_for_job tool
    const waitForJobTool = this.tools.get('wait_for_job');
    if (!waitForJobTool?.handler) {
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'wait_for_job tool not available',
        task,
      };
    }

    // For YouTube workflow, sceneImageArtifactId may be undefined
    // In that case, we should not use generate_video (which requires scene images)
    // Instead, YouTube workflow should use generate_all_videos tool
    if (!sceneImageArtifactId) {
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: 'scene_image_artifact_id is required for generate_video tool. For YouTube workflow VIDEO_GENERATION phase, use generate_all_videos tool instead of dispatch_video_agent.',
        suggestion: 'Use generate_all_videos tool to process all video placements from video-placements.md file',
      };
    }

    // Build arguments for generate_video
    const generateArgs: Record<string, unknown> = {
      scene_number: sceneNumber,
      scene_image_artifact_id: sceneImageArtifactId,
      prompt: motionDescription, // generate_video uses 'prompt' for motion description
      // duration and fps may be handled by the workflow
    };

    const toolCallId = `vid-gen-${Date.now()}`;

    // Emit that we're generating the video
    this.emit({
      type: 'tool_call',
      toolCallId,
      toolName: 'generate_video',
      arguments: generateArgs,
      agentName: this.getEffectiveAgentName(),
    });

    try {
      // Step 1: Submit the video generation job
      const submitResult = await Promise.resolve(generateVideoTool.handler(generateArgs));
      const submitResultObj = submitResult as Record<string, unknown>;

      // Check if submission failed
      if (submitResultObj['status'] === 'error') {
        const finalState = { ...this.videoGenState };
        this.videoGenState = null;
        this.currentMode = 'orchestrator';

        this.emit({
          type: 'tool_result',
          toolCallId,
          toolName: 'generate_video',
          result: submitResult,
          isError: true,
          agentName: this.getEffectiveAgentName(),
        });

        return {
          status: 'error',
          error: submitResultObj['error'] as string,
          scene_number: finalState.sceneNumber,
          task: finalState.task,
        };
      }

      const jobId = submitResultObj['job_id'] as string;
      if (!jobId) {
        throw new Error('No job_id returned from generate_video');
      }

      // Emit tool result for generate_video with job_id prominently displayed
      this.emit({
        type: 'tool_result',
        toolCallId,
        toolName: 'generate_video',
        result: submitResult,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });

      // Emit that we're waiting for the job
      const waitToolCallId = `wait-job-${Date.now()}`;
      this.emit({
        type: 'tool_call',
        toolCallId: waitToolCallId,
        toolName: 'wait_for_job',
        arguments: { job_id: jobId },
        agentName: this.getEffectiveAgentName(),
      });

      // Step 2: Wait for the job to complete
      const waitResult = await Promise.resolve(waitForJobTool.handler({ job_id: jobId }));
      const waitResultObj = waitResult as Record<string, unknown>;

      // Clear the state
      const finalState = { ...this.videoGenState };
      this.videoGenState = null;
      this.currentMode = 'orchestrator';

      // Emit tool result for wait_for_job
      this.emit({
        type: 'tool_result',
        toolCallId: waitToolCallId,
        toolName: 'wait_for_job',
        result: waitResult,
        isError: waitResultObj['status'] === 'error' || waitResultObj['status'] === 'failed',
        agentName: this.getEffectiveAgentName(),
      });

      // Check if job failed
      if (waitResultObj['status'] === 'error' || waitResultObj['status'] === 'failed') {
        return {
          status: 'error',
          error: waitResultObj['error'] as string || 'Job failed',
          scene_number: finalState.sceneNumber,
          task: finalState.task,
          job_id: jobId,
        };
      }

      return {
        status: 'completed',
        scene_number: finalState.sceneNumber,
        image_artifact_id: finalState.sceneImageArtifactId,
        params: finalState.currentParams,
        task: finalState.task,
        iterations: finalState.iterations,
        job_id: jobId,
        artifact_id: waitResultObj['artifact_id'],
        file_path: waitResultObj['file_path'],
        message: 'Video generated successfully.',
      };
    } catch (error) {
      this.videoGenState = null;
      this.currentMode = 'orchestrator';
      return {
        error: `Video generation failed: ${String(error)}`,
        task,
      };
    }
  }

  /**
   * Handle ask_user tool - pauses execution.
   * Supports confirmation, free-form, and multiple choice questions.
   * Supports auto_approve_timeout_ms for automatic approval after timeout.
   *
   * Default behavior: All non-confirmation questions get default options and 15s auto-approve.
   */
  private handleAskUser(toolCall: ToolCall): GenericAgentResult | null {
    const args = toolCall.arguments;
    // Support both legacy ask_user schema and Claude SDK-style AskUserQuestion schema.
    const question =
      (args['question'] as string | undefined) ??
      (args['prompt'] as string | undefined) ??
      '';

    // Legacy-only fields (kept for back-compat)
    const isConfirmation = (args['is_confirmation'] as boolean | undefined) ?? false;
    const providedOptions = args['options'] as Array<{ label: string; description?: string }> | string[] | undefined;
    const providedTimeout = args['auto_approve_timeout_ms'] as number | undefined;

    // Claude SDK-style multiSelect (currently informational; UI supports single-select)
    const multiSelect = (args['multiSelect'] as boolean | undefined) ?? false;

    // Default options for non-confirmation questions without explicit options
    const DEFAULT_OPTIONS: Array<{ label: string; description?: string }> = [
      { label: 'Proceed', description: 'Continue with the suggested approach' },
      { label: 'Provide feedback', description: 'Enter your own response or modifications' },
    ];
    const DEFAULT_AUTO_APPROVE_TIMEOUT_MS = 15000; // 15 seconds

    // Normalize options to {label, description?}[]
    let normalizedOptions: Array<{ label: string; description?: string }> | undefined;
    if (Array.isArray(providedOptions) && providedOptions.length > 0) {
      if (typeof providedOptions[0] === 'string') {
        normalizedOptions = (providedOptions as string[]).map(label => ({ label }));
      } else {
        normalizedOptions = providedOptions as Array<{ label: string; description?: string }>;
      }
    }

    // Ensure "Other" is always available as per Claude SDK usage notes (for non-confirmation questions)
    if (!isConfirmation) {
      const opts = normalizedOptions ?? DEFAULT_OPTIONS;
      const hasOther = opts.some(o => o.label.toLowerCase() === 'other');
      normalizedOptions = hasOther ? opts : [...opts, { label: 'Other', description: 'Provide custom input' }];
    }

    // Use provided options or defaults (only for non-confirmation questions)
    const options = isConfirmation ? undefined : (normalizedOptions ?? DEFAULT_OPTIONS);
    const autoApproveTimeoutMs = isConfirmation ? undefined : (providedTimeout ?? DEFAULT_AUTO_APPROVE_TIMEOUT_MS);

    this.waitingForUser = true;
    this.pendingQuestion = question;

    const toolResult = {
      status: 'waiting_for_user',
      question,
      is_confirmation: isConfirmation,
      options: options ?? null,
      auto_approve_timeout_ms: autoApproveTimeoutMs ?? null,
      multiSelect,
    };

    this.messages.push({
      role: 'tool',
      content: JSON.stringify(toolResult),
      toolCallId: toolCall.id,
      name: toolCall.name,
    });

    // Emit question event with options and timeout
    debugLog(`[GenericAgent] ask_user emitting question: ${JSON.stringify({
      question: question?.slice(0, 50),
      optionsCount: options?.length,
      options,
      isConfirmation,
      autoApproveTimeoutMs,
    }, null, 2)}`);
    this.emit({
      type: 'question',
      question,
      isConfirmation,
      options,
      data: args['data'] as Record<string, unknown> | undefined,
      autoApproveTimeoutMs,
    });

    return {
      status: 'waiting_for_user',
      output: question,
      todos: this.todoManager.getTodos(),
      pendingQuestion: question,
      isConfirmation,
      options,
      autoApproveTimeoutMs,
    };
  }

  /**
   * Handle user response to a question.
   */
  private handleUserResponse(response: string): void {
    // Find the last ask_user tool message and update it
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg?.role === 'tool' && msg.content) {
        try {
          const content = JSON.parse(msg.content) as Record<string, unknown>;
          if (content['status'] === 'waiting_for_user') {
            const isConfirmation = (content['is_confirmation'] as boolean | undefined) ?? false;

            if (isConfirmation) {
              const approvalKeywords = [
                'yes',
                'yeah',
                'yep',
                'ok',
                'okay',
                'sure',
                'go ahead',
                'proceed',
                'continue',
                'approved',
                'confirm',
              ];
              const approved = approvalKeywords.some(kw =>
                response.toLowerCase().includes(kw)
              );

              this.messages[i] = {
                ...msg,
                content: JSON.stringify({
                  approved,
                  user_response: response,
                  original_question: content['question'],
                }),
              };
            } else {
              this.messages[i] = {
                ...msg,
                content: JSON.stringify({
                  status: 'user_responded',
                  user_response: response,
                  original_question: content['question'],
                }),
              };
            }
            break;
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  /**
   * Build the system message for this agent.
   */
  private buildSystemMessage(): string {
    return buildSystemMessage(this.isSubAgent, this.tools, this.customPrompt);
  }

  /**
   * Inject todo reminder and context variables after the first system message.
   */
  private injectTodoReminder(): Message[] {
    const hasTodos = this.todoManager.getTodos().length > 0;
    const hasContextVars = this.activeContextVariables.length > 0;

    if (!hasTodos && !hasContextVars) {
      return [...this.messages];
    }

    // Build reminder content
    const parts: string[] = [];

    if (hasTodos) {
      parts.push(this.todoManager.toReminderText());
    }

    if (hasContextVars) {
      parts.push(buildContextVariablesSection(this.activeContextVariables));
    }

    const reminder: Message = {
      role: 'system',
      content: parts.join('\n\n'),
    };

    // Insert after the first system message
    const firstMsg = this.messages[0];
    if (firstMsg) {
      return [firstMsg, reminder, ...this.messages.slice(1)];
    }
    return [reminder, ...this.messages];
  }

  /**
   * Get active context variables.
   */
  getContextVariables(): ContextVariable[] {
    return [...this.activeContextVariables];
  }

  /**
   * Check if context window is approaching capacity.
   * Returns true if we should compress old messages.
   */
  private shouldCompressContext(): boolean {
    const threshold = this.maxContextTokens * GenericAgent.CONTEXT_THRESHOLD;

    // Method 1: Check based on actual token usage from last call
    if (this.tokenUsage.lastPromptTokens > 0) {
      const shouldCompress = this.tokenUsage.lastPromptTokens > threshold;
      if (shouldCompress) {
        debugLog(`[GenericAgent] Context at ${Math.round((this.tokenUsage.lastPromptTokens / this.maxContextTokens) * 100)}% (${this.tokenUsage.lastPromptTokens}/${this.maxContextTokens} tokens) - compression needed`);
        return true;
      }
    }

    // Method 2: Estimate based on message count and content length
    // This helps catch cases where we haven't had a successful LLM call yet
    // Conservative estimate: ~3 chars per token (models vary, better to overestimate)
    // Plus overhead for tool definitions (~250 tokens each) and message formatting
    const estimatedContentTokens = this.messages.reduce((sum, msg) => {
      return sum + Math.ceil((msg.content?.length ?? 0) / 3) + 10; // +10 for message overhead
    }, 0);
    const estimatedToolTokens = this.tools.size * 250; // ~250 tokens per tool definition
    const estimatedTotal = estimatedContentTokens + estimatedToolTokens;

    if (estimatedTotal > threshold) {
      debugLog(`[GenericAgent] Estimated context at ${Math.round((estimatedTotal / this.maxContextTokens) * 100)}% (~${estimatedTotal}/${this.maxContextTokens} tokens) - compression needed`);
      return true;
    }

    // Method 3: Trigger compression if we have many messages regardless
    // This is a safety net for long conversations
    // Lower threshold to be more aggressive with compression
    const MESSAGE_COUNT_THRESHOLD = 20;
    if (this.messages.length > MESSAGE_COUNT_THRESHOLD) {
      debugLog(`[GenericAgent] Message count (${this.messages.length}) exceeds threshold (${MESSAGE_COUNT_THRESHOLD}) - compression needed`);
      return true;
    }

    return false;
  }

  /**
   * Compress conversation history when context approaches limit.
   * Uses LLM to summarize old messages while preserving system + recent.
   */
  private async compressConversationHistory(): Promise<void> {
    const { compressMessages, SUMMARIZER_SYSTEM_PROMPT } = await import('../context/MessageCompressor.js');

    debugLog(`[GenericAgent] Starting context compression. Current messages: ${this.messages.length}`);

    const result = await compressMessages(this.messages, async (content) => {
      // Use LLM to summarize the conversation
      const summaryResponse = await this.llm.generate({
        messages: [
          { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        maxTokens: 1000,
      });
      return summaryResponse.content ?? 'Conversation history compressed.';
    });

    if (result.wasCompressed) {
      this.messages = result.messages;
      debugLog(`[GenericAgent] Compressed ${result.removedCount} messages. New count: ${this.messages.length}`);

      // Log compression with phase context
      phaseLogger.info('GenericAgent', 'context_compression', 'Conversation history compressed', {
        removedCount: result.removedCount,
        newMessageCount: this.messages.length,
        maxContextTokens: this.maxContextTokens,
      });

      // Emit event so UI can show compression occurred
      this.emit({
        type: 'notification',
        level: 'info',
        message: `Context compressed: ${result.removedCount} messages summarized to stay within limits`,
      });
    }
  }
}

// Re-export tool categories for external use
export { SIMPLE_TOOLS, COMPLEX_TOOLS, isComplexTool };

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
  buildContentPrompt,
  buildImageGenerationPrompt,
  buildExplorePrompt,
  buildSkillPrompt,
  wrapUserTask,
  type ContentType,
  type SkillType,
} from '../prompts/index.js';
import { loadAndRenderMarkdown } from '../prompts/loader.js';
import type { AgentConfig, AgentStatus, GenericAgentResult } from './AgentResult.js';
import {
  contextStore,
  condenseUserInput,
  generateContentLabel,
  shouldCondense,
  LONG_CONTENT_THRESHOLD,
} from '../context/index.js';
import { CONTENT_TYPE_OUTPUT_FILES } from '../tools/builtin/generateContentTool.js';
import { PromptDAGExecutor, type PromptDAGParams } from '../tools/builtin/promptDAG.js';
import { getContentCreatorTools, clearKnownProjectFiles, ReadCache, ListFilesCache } from '../tools/builtin/contentCreatorTools.js';
import { buildContextVariablesSection, type ContextVariable } from '../prompts/index.js';
import { getPhaseLogger } from '../../utils/phaseLogger.js';
import { FlowRecorder } from '../../utils/FlowRecorder.js';
import { ToolAnalytics } from '../../utils/ToolAnalytics.js';
import { buildPreloadedContext } from './contentContext.js';
import {
  getProjectDir,
  loadProject,
  saveProject,
  saveCharacter,
  saveSetting,
  updateContentStatus,
  projectExists,
  saveTodos,
  loadTodos,
  registerFile,
} from '../../tasks/video/workflow/ProjectManager.js';
import type {
  CharacterData,
  SettingData,
  ContentTypeName,
} from '../../tasks/video/workflow/types.js';
import {
  createDefaultCharacterData,
  createDefaultSettingData,
} from '../../tasks/video/workflow/types.js';
import { comfyProgressBus, type ComfyProgressHandler } from '../../services/comfyui/index.js';
import { createTimelineSkeleton, loadTimeline, saveTimeline } from '../timeline/TimelineManager.js';
import { parseSceneBreakdown } from './sceneBreakdownParser.js';
import { computeDurationBudget } from '../../utils/durationUtils.js';

// Get the phase logger instance
const phaseLogger = getPhaseLogger();

// Legacy debug logging (wraps phaseLogger for backward compatibility during migration)
function debugLog(message: string) {
  // Parse the message to extract component and content
  const match = message.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match && match[1] && match[2]) {
    const component = match[1];
    const content = match[2];
    phaseLogger.debug(component, 'legacy', content);
  } else {
    phaseLogger.debug('GenericAgent', 'legacy', message);
  }
}

/**
 * Framework-managed persistence: Auto-update project registry when content is approved.
 * This removes the need for agents to manually call update_project for every content type.
 */
function persistApprovedContent(
  contentType: string,
  name: string | undefined,
  content: string,
  outputFile: string | undefined
): { persisted: boolean; action?: string; error?: string } {
  if (!projectExists()) {
    return { persisted: false, error: 'No project exists' };
  }

  const project = loadProject();
  if (!project) {
    return { persisted: false, error: 'Failed to load project' };
  }

  try {
    // Extract first 200 chars as description for registry
    const extractDescription = (text: string): string => {
      const firstParagraph = text.split('\n\n')[0] || text;
      return firstParagraph.slice(0, 200).trim();
    };

    switch (contentType) {
      case 'character':
        if (name) {
          const character: CharacterData = {
            ...createDefaultCharacterData(name),
            description: extractDescription(content),
            approvalStatus: 'approved' as const,
          };
          saveCharacter(character);
          debugLog(`[GenericAgent] Auto-persisted character "${name}" to project registry`);
          return { persisted: true, action: `add_character: ${name}` };
        }
        break;

      case 'setting':
        if (name) {
          const setting: SettingData = {
            ...createDefaultSettingData(name),
            description: extractDescription(content),
            approvalStatus: 'approved' as const,
          };
          saveSetting(setting);
          debugLog(`[GenericAgent] Auto-persisted setting "${name}" to project registry`);
          return { persisted: true, action: `add_setting: ${name}` };
        }
        break;

      case 'plot':
      case 'story':
        // Update content registry status
        updateContentStatus(project, contentType as ContentTypeName, 'available');
        debugLog(
          `[GenericAgent] Auto-updated ${contentType} status to available in project registry`
        );
        return { persisted: true, action: `update_content_status: ${contentType}` };

      case 'scene':
      case 'scene_breakdown':
        // Update scenes content registry status
        updateContentStatus(project, 'scenes' as ContentTypeName, 'available');
        debugLog(
          `[GenericAgent] Auto-updated scenes status to available in project registry`
        );
        return { persisted: true, action: 'update_content_status: scenes' };

      default:
        // For other content types, just log that we're not auto-persisting
        debugLog(`[GenericAgent] Content type "${contentType}" does not require auto-persistence`);
        return { persisted: false };
    }

    return { persisted: false };
  } catch (error) {
    debugLog(`[GenericAgent] Error in auto-persistence: ${String(error)}`);
    return { persisted: false, error: String(error) };
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
  'dispatch_explore', // New skill-based architecture
  'dispatch_skill', // New skill-based architecture
  'generate_content', // Deterministic content generation
  'generate_prompt',  // DAG-driven prompt generation
  'TodoWrite',
  'TodoRead',
  'todo_write', // back-compat during migration
]);

const COMPLEX_TOOLS = new Set(['generate_image', 'generate_video', 'edit_image']);

/** Tools that trigger ComfyUI jobs and should relay real-time progress to the UI */
const COMFY_PROGRESS_TOOLS = new Set([
  'generate_video_from_image',
  'generate_image',
  'generate_video',
  'edit_image',
]);

function isComplexTool(name: string): boolean {
  return COMPLEX_TOOLS.has(name);
}

function isBuiltinTodoTool(name: string): boolean {
  return name === 'TodoWrite' || name === 'todo_write' || name === 'TodoRead';
}

function isTaskTool(name: string): boolean {
  return name === 'Task';
}

function isPlanModeTool(name: string): boolean {
  return name === 'EnterPlanMode' || name === 'ExitPlanMode';
}

/** Checkpoint interval: save project state every 3 minutes */
const CHECKPOINT_INTERVAL_MS = 180_000;

export class GenericAgent extends TypedEventEmitter {
  private tools: Map<string, ToolDefinition>;
  private llm: LLMClient;
  private isSubAgent: boolean;
  private maxIterations: number;
  private name: string;
  private customPrompt?: string;
  private autonomousMode: boolean;
  private lastCheckpointAt: number = 0;

  // State
  private todoManager = new ExpandableTodoManager();
  private messages: Message[] = [];
  private iteration = 0;
  private waitingForUser = false;
  private maxIterationsReached = false;
  private pendingQuestion?: string;
  private pendingConfirmations = new Map<string, Record<string, unknown>>();

  // Interruption state
  private aborted = false;
  private pendingUserInput: string | null = null;

  // Active context variables for this session
  private activeContextVariables: ContextVariable[] = [];

  // Loop detection state
  private recentToolCalls: string[] = [];
  private consecutiveLoopWarnings = 0;
  private static readonly LOOP_DETECTION_WINDOW = 6;
  private static readonly LOOP_THRESHOLD = 3; // Same tool called 3+ times in window
  // Track consecutive text-only responses (no tool calls) to prevent infinite nudge loops
  private consecutiveTextOnlyResponses = 0;
  private static readonly MAX_TEXT_ONLY_NUDGES = 3;
  private static readonly MAX_CONSECUTIVE_LOOP_WARNINGS = 3; // Force stop after this many warnings
  // Track total generate_content calls to catch slow-burn loops where args differ each time
  private generateContentCallCount = 0;
  private static readonly MAX_GENERATE_CONTENT_CALLS = 50; // Safety ceiling for a single session

  // Context window tracking
  private tokenUsage = {
    lastPromptTokens: 0,
    lastCompletionTokens: 0,
  };
  // Lower threshold (60%) to leave room for response generation
  // llama.cpp servers often can't handle mid-generation overflow
  private static readonly CONTEXT_THRESHOLD = 0.6;
  private maxContextTokens: number = 16000; // Will be updated from LLM client

  // Current mode for more descriptive agent names in UI
  private currentMode: 'orchestrator' | 'content' | 'image' | 'video' | 'planning' = 'orchestrator';

  // Claude SDK-style plan mode state
  private planModeActive = false;

  // Think tag streaming filter state
  private thinkTagBuffer: string = '';
  private insideThinkTag: boolean = false;

  // Analytics session ID (stable per agent instance)
  private analyticsSessionId: string;

  // Per-session caches to avoid redundant file reads and directory listings
  private readCache = new ReadCache();
  private listFilesCache = new ListFilesCache();

  constructor(tools: Map<string, ToolDefinition>, llm: LLMClient, config: AgentConfig = {}) {
    super();
    this.tools = tools;
    this.llm = llm;
    this.isSubAgent = config.isSubAgent ?? false;
    this.maxIterations = config.maxIterations ?? 100;
    this.name = config.name ?? `agent-${nanoid(6)}`;
    this.customPrompt = config.customPrompt;
    this.autonomousMode = config.autonomousMode ?? false;
    this.currentMode = config.initialMode ?? 'orchestrator';
    this.analyticsSessionId = `${this.name}_${Date.now()}_${nanoid(6)}`;
  }

  /**
   * Run a sub-agent with the given tools and prompt.
   * This creates a NEW GenericAgent instance that uses the same run() loop,
   * ensuring consistent event emission and behavior.
   *
   * RECURSION PROTECTION: Sub-agents are created with isSubAgent=true and
   * should only be given tools that cannot spawn more sub-agents.
   */
  private async runSubAgent(config: {
    name: string;
    tools: ToolDefinition[];
    prompt: string;
    task: string;
    maxIterations?: number;
    parentToolCallId?: string;
  }): Promise<GenericAgentResult> {
    // Prevent infinite recursion - sub-agents cannot spawn more sub-agents
    if (this.isSubAgent) {
      throw new Error('Sub-agents cannot spawn nested sub-agents');
    }

    // Convert Tool[] to Map<string, ToolDefinition>
    const toolMap = new Map<string, ToolDefinition>();
    for (const tool of config.tools) {
      toolMap.set(tool.name, {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        handler: tool.handler,
      });
    }

    // Create the sub-agent with appropriate initialMode based on agent name
    const initialMode = config.name === 'Content Agent' ? 'content' : 'orchestrator';
    const subAgent = new GenericAgent(toolMap, this.llm, {
      customPrompt: config.prompt,
      name: config.name,
      isSubAgent: true,
      maxIterations: config.maxIterations ?? 10,
      initialMode,
    });

    // Forward all events from sub-agent to parent
    // This ensures the CLI sees everything the sub-agent does
    subAgent.on('tool_call', event => this.emit(event));
    subAgent.on('tool_result', event => this.emit(event));
    subAgent.on('streaming_text', event => this.emit(event));
    subAgent.on('agent_status', event => this.emit(event));
    subAgent.on('agent_text', event => this.emit(event));
    subAgent.on('notification', event => this.emit(event));
    subAgent.on('context_usage', event => this.emit(event));

    // Track sub-agent context for flow recording
    if (config.parentToolCallId) {
      FlowRecorder.getSession()?.enterSubAgent(config.name, config.parentToolCallId);
    }

    // Initialize and run the sub-agent using the SAME run() loop as main agent
    await subAgent.initialize();
    const result = await subAgent.run(config.task);

    // Exit sub-agent context for flow recording
    if (config.parentToolCallId) {
      FlowRecorder.getSession()?.exitSubAgent();
    }

    // Clean up event listeners
    subAgent.removeAllListeners();

    return result;
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

    // Load persisted todos from project file (for resuming work)
    if (projectExists() && !this.isSubAgent) {
      let persistedTodos = loadTodos();

      // Safety: if project is complete, clear all todos and fix goal status
      const project = loadProject();
      const projRec = project as unknown as Record<string, unknown> | null;
      if (projRec?.['productionCompletedAt']) {
        // Clear all todos — project is done, no stale todos should confuse next session
        if (persistedTodos.length > 0) {
          debugLog(`[GenericAgent] Project complete — clearing ${persistedTodos.length} stale todos`);
          persistedTodos = [];
          saveTodos([]);
        }
        // Ensure goal status reflects completion — prevents agent from re-executing an achieved goal
        if (project?.goal?.status === 'active') {
          debugLog(`[GenericAgent] Project complete but goal still active — marking as achieved`);
          project.goal.status = 'achieved';
          project.goal.achievedAt = projRec['productionCompletedAt'] as number;
          saveProject(project);
        }
      }

      if (persistedTodos.length > 0) {
        // Convert persisted todos to the format expected by todoManager
        const todosForManager = persistedTodos.map(t => ({
          id: t.id,
          content: t.content,
          activeForm: t.activeForm,
          status: t.status,
          visible: t.visible,
          depth: t.depth,
        }));
        this.todoManager.writeTodos(todosForManager);
        debugLog(`[GenericAgent] Loaded ${persistedTodos.length} persisted todos from project`);

        // Emit todo update so UI can display them
        this.emit({
          type: 'todo_update',
          todos: this.todoManager.getTodos(),
          agentName: this.getEffectiveAgentName(),
        });
      }
    }
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
    this.emit({
      type: 'agent_status',
      status: 'interrupted',
      agentName: this.getEffectiveAgentName(),
    });
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
   * Get the effective list of tools to use for LLM calls.
   * If the LLM has implicit thinking enabled, the explicit 'think' tool is filtered out
   * since it would be redundant.
   */
  private getEffectiveTools(): ToolDefinition[] {
    const allTools = Array.from(this.tools.values());

    // If LLM has implicit thinking, filter out the explicit 'think' tool
    if (this.llm.hasImplicitThinking) {
      return allTools.filter(tool => tool.name !== 'think');
    }

    return allTools;
  }

  /**
   * Check if a string could be a prefix of a tag.
   * This is used to determine if we should keep content in the buffer.
   */
  private couldBeTagPrefix(str: string, tag: string): boolean {
    // Check if the string ends with any prefix of the tag
    for (let i = 1; i <= Math.min(str.length, tag.length - 1); i++) {
      const suffix = str.slice(-i);
      const prefix = tag.slice(0, i);
      if (suffix === prefix) {
        return true;
      }
    }
    return false;
  }

  /**
   * Process a streaming chunk and separate <think> tag content from regular content.
   * Uses a buffer to handle tags that span multiple chunks.
   * Returns both regular content and thinking content.
   */
  private processStreamChunk(chunk: string): { output: string; thinking: string } {
    // Add chunk to buffer
    this.thinkTagBuffer += chunk;

    let output = '';
    let thinking = '';

    while (this.thinkTagBuffer.length > 0) {
      if (this.insideThinkTag) {
        // Look for closing </think> tag
        const closeIndex = this.thinkTagBuffer.indexOf('</think>');
        if (closeIndex !== -1) {
          // Found closing tag - capture thinking content up to it
          thinking += this.thinkTagBuffer.slice(0, closeIndex);
          this.thinkTagBuffer = this.thinkTagBuffer.slice(closeIndex + '</think>'.length);
          this.insideThinkTag = false;
          // Continue processing - there might be more content or tags after
        } else {
          // No closing tag yet - check if buffer could end with partial </think>
          // Only keep content if it could actually be a prefix of </think>
          if (this.couldBeTagPrefix(this.thinkTagBuffer, '</think>')) {
            // Find where the potential partial starts
            for (let i = 1; i < '</think>'.length && i <= this.thinkTagBuffer.length; i++) {
              const suffix = this.thinkTagBuffer.slice(-i);
              const prefix = '</think>'.slice(0, i);
              if (suffix === prefix) {
                // Emit everything before the potential partial
                thinking += this.thinkTagBuffer.slice(0, -i);
                this.thinkTagBuffer = suffix;
                break;
              }
            }
          } else {
            // No potential partial - emit all as thinking content
            thinking += this.thinkTagBuffer;
            this.thinkTagBuffer = '';
          }
          // Wait for more data
          break;
        }
      } else {
        // Look for opening <think> tag
        const openIndex = this.thinkTagBuffer.indexOf('<think>');
        if (openIndex !== -1) {
          // Emit everything before the tag as output
          output += this.thinkTagBuffer.slice(0, openIndex);
          this.thinkTagBuffer = this.thinkTagBuffer.slice(openIndex + '<think>'.length);
          this.insideThinkTag = true;
          // Continue processing - there might be think content after
        } else {
          // No opening tag - also check for orphan </think> tags (malformed LLM output)
          const orphanCloseIndex = this.thinkTagBuffer.indexOf('</think>');
          if (orphanCloseIndex !== -1) {
            // Strip orphan closing tag - emit content before it as output
            output += this.thinkTagBuffer.slice(0, orphanCloseIndex);
            this.thinkTagBuffer = this.thinkTagBuffer.slice(orphanCloseIndex + '</think>'.length);
            // Continue processing - there might be more content after
          } else {
            // Check if buffer could end with partial <think> or partial </think>
            const couldBeOpenPartial = this.couldBeTagPrefix(this.thinkTagBuffer, '<think>');
            const couldBeClosePartial = this.couldBeTagPrefix(this.thinkTagBuffer, '</think>');

            if (couldBeOpenPartial || couldBeClosePartial) {
              // Find where the potential partial starts (check both tags)
              let partialLen = 0;

              // Check for partial <think>
              for (let i = 1; i < '<think>'.length && i <= this.thinkTagBuffer.length; i++) {
                const suffix = this.thinkTagBuffer.slice(-i);
                const prefix = '<think>'.slice(0, i);
                if (suffix === prefix) {
                  partialLen = Math.max(partialLen, i);
                }
              }

              // Check for partial </think>
              for (let i = 1; i < '</think>'.length && i <= this.thinkTagBuffer.length; i++) {
                const suffix = this.thinkTagBuffer.slice(-i);
                const prefix = '</think>'.slice(0, i);
                if (suffix === prefix) {
                  partialLen = Math.max(partialLen, i);
                }
              }

              if (partialLen > 0) {
                // Emit everything before the potential partial
                output += this.thinkTagBuffer.slice(0, -partialLen);
                this.thinkTagBuffer = this.thinkTagBuffer.slice(-partialLen);
              }
            } else {
              // No potential partial - emit all as output
              output += this.thinkTagBuffer;
              this.thinkTagBuffer = '';
            }
            // Wait for more data
            break;
          }
        }
      }
    }

    return { output, thinking };
  }

  /**
   * Reset think tag filter state for a new streaming session.
   */
  private resetThinkTagFilter(): void {
    this.thinkTagBuffer = '';
    this.insideThinkTag = false;
  }

  /**
   * Flush any remaining content from the think tag buffer.
   * Called when streaming is done to emit any buffered content.
   * Returns both regular content and any remaining thinking content.
   */
  private flushThinkTagBuffer(): { output: string; thinking: string } {
    if (this.insideThinkTag) {
      // Still inside a think tag - return buffer as thinking content
      const thinking = this.thinkTagBuffer;
      this.thinkTagBuffer = '';
      return { output: '', thinking };
    }
    // Outside think tag - return remaining buffer as output
    const output = this.thinkTagBuffer;
    this.thinkTagBuffer = '';
    return { output, thinking: '' };
  }

  /**
   * Check if an error is a retryable network error.
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Common network errors that are worth retrying
      return (
        message.includes('premature close') ||
        message.includes('econnreset') ||
        message.includes('econnrefused') ||
        message.includes('etimedout') ||
        message.includes('socket hang up') ||
        message.includes('network error') ||
        message.includes('fetch failed')
      );
    }
    return false;
  }

  /**
   * Sleep for a given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate LLM response with streaming, emitting chunks as they arrive.
   * Accumulates content and tool calls, returning the complete response.
   *
   * If the LLM has implicit thinking enabled, <think> content is emitted as
   * 'streaming_think' events for the UI to display in a dedicated area.
   *
   * Includes retry logic for transient network errors.
   */
  private async generateWithStreaming(
    messages: Message[],
    tools: ToolDefinition[]
  ): Promise<LLMResponse> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Reset state for each attempt
      let content = '';
      const toolCalls: ToolCall[] = [];
      const toolCallAccumulators: Map<number, { id: string; name: string; arguments: string }> =
        new Map();
      let usage:
        | { promptTokens: number; completionTokens: number; totalTokens: number }
        | undefined;

      // Check if LLM has implicit thinking - if so, emit think content to UI
      const hasImplicitThinking = this.llm.hasImplicitThinking;

      // Reset think tag filter for this streaming session
      this.resetThinkTagFilter();

      try {
        for await (const chunk of this.llm.generateStream({ messages, tools, temperature: 0.7 })) {
          // Check for abort
          if (this.aborted) {
            if (hasImplicitThinking) {
              this.emit({ type: 'streaming_think', chunk: '', done: true });
            }
            this.emit({ type: 'streaming_text', chunk: '', done: true });
            break;
          }

          // Handle content chunks
          if (chunk.content) {
            // Accumulate raw content for final response
            content += chunk.content;

            // Separate <think> content from regular output
            const { output, thinking } = this.processStreamChunk(chunk.content);

            // Emit thinking content if LLM has implicit thinking
            if (hasImplicitThinking && thinking) {
              this.emit({ type: 'streaming_think', chunk: thinking, done: false });
            }

            // Emit regular content
            if (output) {
              debugLog(
                `[GenericAgent] streaming_text emit: chunk=${output.length} chars (filtered from ${chunk.content.length}), total=${content.length} chars`
              );
              this.emit({ type: 'streaming_text', chunk: output, done: false });
            }
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
            // Flush any remaining buffered content
            const { output: remainingOutput, thinking: remainingThinking } =
              this.flushThinkTagBuffer();

            // Emit any remaining thinking content
            if (hasImplicitThinking && remainingThinking) {
              this.emit({ type: 'streaming_think', chunk: remainingThinking, done: false });
            }
            if (hasImplicitThinking) {
              this.emit({ type: 'streaming_think', chunk: '', done: true });
            }

            // Emit any remaining regular content
            if (remainingOutput) {
              this.emit({ type: 'streaming_text', chunk: remainingOutput, done: false });
            }

            debugLog(
              `[GenericAgent] streaming_text DONE: total content=${content.length} chars, toolCallCount=${toolCallAccumulators.size}`
            );
            this.emit({ type: 'streaming_text', chunk: '', done: true });
            if (chunk.usage) {
              usage = chunk.usage;
            }
          }
        }
        // Success! Convert accumulated tool calls to final format
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

        // Clean content (remove <think> tags including orphaned ones)
        const cleanedContent = content
          ? content
              .replace(/<think>.*?<\/think>/gs, '') // Complete think blocks
              .replace(/<think>.*$/gs, '') // Orphan opening tag
              .replace(/<\/think>/g, '') // Orphan closing tag
              .trim()
          : null;

        debugLog(
          `[GenericAgent] generateWithStreaming result: rawContent=${content.length} chars, cleanedContent=${cleanedContent?.length ?? 0} chars, toolCalls=${toolCalls.length}`
        );
        if (cleanedContent) {
          debugLog(
            `[GenericAgent] generateWithStreaming content preview: "${cleanedContent.slice(0, 200)}${cleanedContent.length > 200 ? '...' : ''}"`
          );
        }

        return {
          content: cleanedContent,
          toolCalls,
          finishReason: 'stop',
          usage,
        };
      } catch (error) {
        lastError = error;

        // Reset filter state
        this.resetThinkTagFilter();

        // Check if this is a retryable error
        if (this.isRetryableError(error) && attempt < MAX_RETRIES - 1) {
          const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
          debugLog(
            `[GenericAgent] Retryable error on attempt ${attempt + 1}/${MAX_RETRIES}: ${error instanceof Error ? error.message : String(error)}. Retrying in ${delayMs}ms...`
          );

          // Emit notification about retry
          this.emit({
            type: 'notification',
            level: 'warning',
            message: `Connection interrupted. Retrying... (attempt ${attempt + 2}/${MAX_RETRIES})`,
          });

          await this.sleep(delayMs);
          continue; // Retry
        }

        // Non-retryable error or max retries exceeded - emit done and throw
        if (hasImplicitThinking) {
          this.emit({ type: 'streaming_think', chunk: '', done: true });
        }
        this.emit({ type: 'streaming_text', chunk: '', done: true });
        throw error;
      }
    }

    // Should not reach here, but if we do, throw the last error
    throw lastError ?? new Error('generateWithStreaming failed after all retries');
  }

  /**
   * Run the agent on a task.
   * Returns when completed, errored, or waiting for user input.
   */
  async run(task: string, userResponse?: string): Promise<GenericAgentResult> {
    // Reset abort state for new run
    this.aborted = false;

    // Start flow recording session (only for main orchestrator, not sub-agents)
    if (!this.isSubAgent && !userResponse) {
      FlowRecorder.startSession(task);
    }

    // Emit started status
    this.emit({ type: 'agent_status', status: 'started', agentName: this.getEffectiveAgentName() });

    // Resume from user question or start fresh
    if (userResponse && this.waitingForUser) {
      // Check if there's an active planning session (from dispatch_agent)
      if (this.planningState?.active) {
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
            questionContext: planResultObj['content'] as string | undefined,
          };
        }

        // Planning is complete (approved, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Find the dispatch_agent tool call and add its result
        // The main agent will continue processing
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(planResult),
          toolCallId: 'planning-result',
          name: 'dispatch_agent',
        });

        // Emit status change back to thinking
        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.getEffectiveAgentName(),
        });
      } else if (this.imageGenState?.active) {
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
            questionContext: imageResultObj['content'] as string | undefined,
          };
        }

        // Image generation is complete (generated, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Add the dispatch_image_agent result to messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(imageResult),
          toolCallId: 'image-gen-result',
          name: 'dispatch_image_agent',
        });

        // Emit status change back to thinking
        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.getEffectiveAgentName(),
        });
      } else if (this.videoGenState?.active) {
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
            questionContext: videoResultObj['content'] as string | undefined,
          };
        }

        // Video generation is complete (generated, cancelled, or max_iterations)
        // Add the result to messages and continue
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // Add the dispatch_video_agent result to messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(videoResult),
          toolCallId: 'video-gen-result',
          name: 'dispatch_video_agent',
        });

        // Emit status change back to thinking
        this.emit({
          type: 'agent_status',
          status: 'thinking',
          agentName: this.getEffectiveAgentName(),
        });
      } else {
        // Regular ask_user response
        this.handleUserResponse(userResponse);
        this.waitingForUser = false;
        this.pendingQuestion = undefined;

        // If resuming from max iterations, check user response and reset counter
        if (this.maxIterationsReached) {
          this.maxIterationsReached = false;
          const stopKeywords = ['stop', 'cancel', 'abort', 'use current'];
          const shouldStop = stopKeywords.some(kw => userResponse.toLowerCase().includes(kw));
          if (shouldStop) {
            return {
              status: 'interrupted',
              output: 'Agent stopped at user request after reaching max iterations.',
              todos: this.todoManager.getTodos(),
              error: 'user_stopped_at_max_iterations',
            };
          }
          // User chose to continue — reset iteration counter to resume the loop
          this.iteration = 0;
          this.recentToolCalls = [];
        }
      }
    } else if (!this.waitingForUser) {
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
          debugLog(
            `[GenericAgent] Condensed long user input (${task.length} chars) to ${result.variableName}`
          );
        }
      }

      // Start fresh - wrap user task in XML tags for structured prompts
      this.messages = [
        { role: 'system', content: this.buildSystemMessage() },
        { role: 'user', content: wrapUserTask(taskContent) },
      ];
      this.iteration = 0;
      this.recentToolCalls = []; // Reset loop detection
      this.consecutiveTextOnlyResponses = 0; // Reset text-only nudge counter
    }

    let finalOutput = '';

    // Main while(tool_use) loop
    while (this.iteration < this.maxIterations) {
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
        this.emit({
          type: 'agent_text',
          text: `User: ${userInput.slice(0, 200)}${userInput.length > 200 ? '...' : ''}`,
          isFinal: false,
        });
      }

      this.iteration++;

      // Periodic checkpoint: save project state every few minutes
      if (!this.isSubAgent && Date.now() - this.lastCheckpointAt > CHECKPOINT_INTERVAL_MS) {
        this.performCheckpoint();
      }

      // Emit thinking status
      this.emit({
        type: 'agent_status',
        status: 'thinking',
        agentName: this.getEffectiveAgentName(),
      });

      // Check if we need to compress context before making LLM call
      if (this.shouldCompressContext()) {
        await this.compressConversationHistory();
      }

      // Build messages with todo reminder injected
      const messagesWithReminder = this.injectTodoReminder();

      // Stream LLM response
      // Use getEffectiveTools() to filter out 'think' tool if LLM has implicit thinking
      const response = await this.generateWithStreaming(
        messagesWithReminder,
        this.getEffectiveTools()
      );

      // Track token usage for context window management
      if (response.usage) {
        this.tokenUsage.lastPromptTokens = response.usage.promptTokens;
        this.tokenUsage.lastCompletionTokens = response.usage.completionTokens;
        debugLog(
          `[GenericAgent] Token usage: prompt=${response.usage.promptTokens}, completion=${response.usage.completionTokens}, total=${response.usage.totalTokens}`
        );

        // Log context usage for phase-aware monitoring
        phaseLogger.contextUsage(
          'GenericAgent',
          response.usage.promptTokens,
          this.maxContextTokens
        );

        // Emit context usage event for UI display
        const percentage = Math.round((response.usage.promptTokens / this.maxContextTokens) * 100);
        this.emit({
          type: 'context_usage',
          promptTokens: response.usage.promptTokens,
          maxTokens: this.maxContextTokens,
          percentage,
          wasCompressed: false,
          iteration: this.iteration,
        });
      }

      // Add assistant message to history
      this.messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });

      // If no tool calls, check if we should really stop
      if (response.toolCalls.length === 0) {
        this.consecutiveTextOnlyResponses++;

        // Skip nudging if the project is complete — the agent is allowed to
        // stop naturally once the final video has been assembled. The user
        // will drive the next interaction (e.g. editing specific artifacts).
        const projectComplete = (() => {
          try {
            const proj = loadProject();
            return !!(proj?.productionCompletedAt);
          } catch {
            return false;
          }
        })();

        // In video mode, the agent should never complete on its own —
        // it must always use tools to drive the workflow forward.
        // Inject a nudge message and continue the loop (up to MAX_TEXT_ONLY_NUDGES times).
        // BUT: once the project is complete, let the agent stop — the user
        // will come back with edit requests ("redo scene 3", etc.).
        if (
          this.name === 'kshana-video' &&
          !this.isSubAgent &&
          !projectComplete &&
          this.iteration < this.maxIterations - 1 &&
          this.consecutiveTextOnlyResponses <= GenericAgent.MAX_TEXT_ONLY_NUDGES
        ) {
          debugLog(`[GenericAgent] Video mode: LLM responded with text only (${this.consecutiveTextOnlyResponses}/${GenericAgent.MAX_TEXT_ONLY_NUDGES}) — nudging to use tools`);
          this.messages.push({
            role: 'user',
            content: '<system_nudge>You must not stop here. Use your tools (read_project, update_project, create_backward_plan, etc.) to continue driving the workflow. If no project exists, use update_project with action "create" to create one. Never respond with text alone — always use a tool call.</system_nudge>',
          });
          continue;
        }

        if (projectComplete) {
          debugLog(`[GenericAgent] Project complete (productionCompletedAt set) — allowing agent to stop naturally`);
          // Clear any todos created during this session — project is done
          const remainingTodos = this.todoManager.getTodos();
          if (remainingTodos.length > 0) {
            debugLog(`[GenericAgent] Project complete — clearing ${remainingTodos.length} session todos`);
            this.todoManager.writeTodos([]);
            this.emit({ type: 'todo_update', todos: [] });
            if (projectExists()) {
              saveTodos([]);
            }
          }
        }

        finalOutput = response.content ?? '';
        break;
      } else {
        // Reset text-only counter when tool calls are made
        this.consecutiveTextOnlyResponses = 0;
      }

      // Extract preceding message (LLM reasoning that led to these tool calls)
      const precedingMessage = typeof response.content === 'string' ? response.content : undefined;

      // Execute tool calls
      for (const toolCall of response.toolCalls) {
        // Special handling for ask_user - pause execution
        if (toolCall.name === 'ask_user' || toolCall.name === 'AskUserQuestion') {
          const result = this.handleAskUser(toolCall);
          if (result) {
            this.emit({
              type: 'agent_status',
              status: 'waiting',
              agentName: this.getEffectiveAgentName(),
            });
            return result;
          }
          continue;
        }

        // Record analytics start
        const analyticsRowId = ToolAnalytics.instance()?.recordStart(
          toolCall.id,
          toolCall.name,
          this.getEffectiveAgentName(),
          toolCall.arguments,
          this.analyticsSessionId,
          precedingMessage
        ) ?? null;

        // Execute the tool
        const result = await this.executeTool(toolCall);
        const resultObj = result as Record<string, unknown>;

        // Record analytics completion
        const isToolError = resultObj['status'] === 'loop_blocked' ||
          resultObj['error'] !== undefined ||
          resultObj['status'] === 'error';
        const errorMsg = isToolError
          ? (resultObj['error'] as string) ?? (resultObj['warning'] as string) ?? undefined
          : undefined;
        if (analyticsRowId !== null) {
          ToolAnalytics.instance()?.recordComplete(toolCall.id, analyticsRowId, isToolError, errorMsg);
        }

        // Check if a generate tool (image/video) completed successfully
        const isGenerateSuccess = COMFY_PROGRESS_TOOLS.has(toolCall.name) &&
          (resultObj['status'] === 'completed' || resultObj['artifact_id']);

        // Reset iteration counter when project state is updated — this signals real progress
        // and prevents hitting max_iterations on long-running workflows.
        if (
          toolCall.name === 'update_project' &&
          resultObj['status'] === 'success'
        ) {
          debugLog(`[GenericAgent] Progress detected (update_project success) — resetting iteration counter from ${this.iteration}`);
          this.iteration = 0;
        }

        // Reset iteration counter on generate_content or generate tool success
        if (
          (toolCall.name === 'generate_content' && resultObj['status'] === 'approved') ||
          isGenerateSuccess
        ) {
          debugLog(`[GenericAgent] Progress detected (${toolCall.name} success) — resetting iteration counter from ${this.iteration}`);
          this.iteration = 0;
        }

        // Clear all todos when final assembly succeeds — assembly is terminal, no todos should survive
        if (toolCall.name === 'assemble_from_timeline' && resultObj['success'] === true) {
          const todoCount = this.todoManager.getTodos().length;
          if (todoCount > 0) {
            debugLog(`[GenericAgent] Assembly complete — clearing all ${todoCount} todos`);
            this.todoManager.writeTodos([]);
            this.emit({ type: 'todo_update', todos: [] });
            if (projectExists()) {
              saveTodos([]);
            }
          }
        }

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
            questionContext: resultObj['content'] as string | undefined,
          };
        }

        // Add tool result to messages
        this.messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: toolCall.id,
          name: toolCall.name,
        });
      }
    }

    // Check if max iterations reached — ask user instead of silently stopping
    if (this.iteration >= this.maxIterations) {
      this.maxIterationsReached = true;

      // Create a synthetic ask_user tool call to pause and ask the user
      const syntheticToolCall: ToolCall = {
        id: `max-iter-${nanoid(8)}`,
        name: 'ask_user',
        arguments: {
          question: 'The agent has reached the maximum number of iterations. How would you like to proceed?',
          options: [
            { label: 'Continue', description: 'Resume from where we left off' },
            { label: 'Stop', description: 'Stop and use the current results' },
          ],
          auto_approve_timeout_ms: 0,
        },
      };

      // Add the assistant message that "called" ask_user
      this.messages.push({
        role: 'assistant',
        content: 'I have reached the maximum number of iterations. Let me check with you on how to proceed.',
        toolCalls: [syntheticToolCall],
      });

      const askResult = this.handleAskUser(syntheticToolCall);
      if (askResult) return askResult;

      // Fallback if handleAskUser returned null (shouldn't happen)
      return {
        status: 'interrupted',
        output: 'Agent reached maximum iterations without completing.',
        todos: this.todoManager.getTodos(),
        error: 'max_iterations_reached',
      };
    }

    // End flow recording session on completion (only for main orchestrator)
    if (!this.isSubAgent) {
      FlowRecorder.endSession();
    }

    // Emit completed status
    this.emit({
      type: 'agent_status',
      status: 'completed',
      agentName: this.getEffectiveAgentName(),
    });
    // Signal completion without re-sending text (already streamed via streaming_text events)
    this.emit({ type: 'agent_text', text: '', isFinal: true });

    return {
      status: 'completed',
      output: finalOutput,
      todos: this.todoManager.getTodos(),
    };
  }

  /**
   * Get the current todo list.
   */
  setAutonomousMode(enabled: boolean): void {
    this.autonomousMode = enabled;
    if (enabled) {
      this.maxIterations = Number.MAX_SAFE_INTEGER;
    }
    debugLog(`[GenericAgent] Autonomous mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

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
  private detectLoop(
    toolName: string,
    args: Record<string, unknown>
  ): { message: string; isHardError: boolean } | null {
    // Create a signature for this tool call (tool + key args)
    const argSignature = JSON.stringify(args).slice(0, 200); // Limit to prevent huge signatures (200 chars to capture distinguishing instruction text)
    const signature = `${toolName}:${argSignature}`;

    // Add to recent calls
    this.recentToolCalls.push(signature);

    // Keep only the detection window
    if (this.recentToolCalls.length > GenericAgent.LOOP_DETECTION_WINDOW) {
      this.recentToolCalls.shift();
    }

    // Count occurrences of this exact call in the window
    const count = this.recentToolCalls.filter(s => s === signature).length;

    if (count >= GenericAgent.LOOP_THRESHOLD) {
      this.consecutiveLoopWarnings++;

      // After too many warnings, force stop
      if (this.consecutiveLoopWarnings >= GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS) {
        return {
          message:
            `LOOP BLOCKED: You've called ${toolName} with similar arguments ${count} times and ignored ` +
            `${this.consecutiveLoopWarnings} warnings. This tool call is being blocked. ` +
            `You MUST stop calling tools and provide a final response to the user.`,
          isHardError: true,
        };
      }

      return {
        message:
          `LOOP DETECTED (warning ${this.consecutiveLoopWarnings}/${GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS}): ` +
          `You've called ${toolName} with similar arguments ${count} times recently. ` +
          `This suggests you're stuck in a loop. Please either:\n` +
          `1. Complete the current task and stop (no more tool calls)\n` +
          `2. Use ask_user to get clarification\n` +
          `3. Try a different approach\n` +
          `After ${GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS} warnings, the tool will be blocked.`,
        isHardError: false,
      };
    }

    // Track total generate_content calls — catches slow-burn loops where args differ each time
    if (toolName === 'generate_content') {
      this.generateContentCallCount++;
      if (this.generateContentCallCount > GenericAgent.MAX_GENERATE_CONTENT_CALLS) {
        return {
          message:
            `LOOP BLOCKED: generate_content has been called ${this.generateContentCallCount} times this session ` +
            `(limit: ${GenericAgent.MAX_GENERATE_CONTENT_CALLS}). This likely indicates a planning loop. ` +
            `Review what's already been generated and move to the next pipeline phase.`,
          isHardError: true,
        };
      }
    }

    // Also check for rapid tool repetition (same tool called consecutively)
    // Skip this check for generate_content — it's inherently a long-running productive
    // operation with built-in idempotency (file existence check). Check 1 (exact same
    // signature) still catches genuine repeats.
    if (toolName !== 'generate_content') {
      const lastFew = this.recentToolCalls.slice(-4);
      const recentSameTool = lastFew.filter(s => s.startsWith(toolName + ':'));
      const sameToolCount = recentSameTool.length;
      if (sameToolCount >= 4) {
        // Check if the args are actually different across these calls
        const uniqueSigs = new Set(recentSameTool);

        // If all/most signatures are unique, this is productive work, not a loop
        if (uniqueSigs.size >= recentSameTool.length - 1) {
          // Different args each time — not a loop, skip warning
        } else {
          // Same args repeated — real loop
          this.consecutiveLoopWarnings++;

          if (this.consecutiveLoopWarnings >= GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS) {
            return {
              message:
                `LOOP BLOCKED: You've called ${toolName} 4+ times in a row with similar arguments and ignored warnings. ` +
                `This tool call is being blocked. Provide a final response to the user.`,
              isHardError: true,
            };
          }

          return {
            message:
              `WARNING (${this.consecutiveLoopWarnings}/${GenericAgent.MAX_CONSECUTIVE_LOOP_WARNINGS}): ` +
              `You've called ${toolName} 4 times in a row with similar arguments. ` +
              `If you're done with the task, stop calling tools and provide a final response.`,
            isHardError: false,
          };
        }
      }
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

    // Record tool start for flow tracking
    FlowRecorder.getSession()?.onToolStart(
      toolCall.id,
      toolCall.name,
      toolCall.arguments,
      this.getEffectiveAgentName()
    );

    // Check for looping (skip for think + TodoWrite - these may be called frequently)
    // - Hard errors (loop_blocked): Block execution completely
    // - Soft warnings: Record but let tool run, warning will be included in result
    let loopWarningMessage: string | null = null;
    if (toolCall.name !== 'think' && !isBuiltinTodoTool(toolCall.name)) {
      const loopResult = this.detectLoop(toolCall.name, toolCall.arguments);
      if (loopResult) {
        if (loopResult.isHardError) {
          // Hard error - block execution completely
          const warningResult = {
            status: 'loop_blocked',
            warning: loopResult.message,
            tool: toolCall.name,
            blocked: true,
          };
          this.emit({
            type: 'tool_result',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            result: warningResult,
            isError: true,
            agentName: this.getEffectiveAgentName(),
          });
          FlowRecorder.getSession()?.onToolComplete(toolCall.id, warningResult, true);
          return warningResult;
        } else {
          // Soft warning - record it, tool will still run
          // Warning will be included in the tool result
          loopWarningMessage = loopResult.message;
        }
      }
    }

    // Handle TodoRead specially — return current todos with instructions
    if (toolCall.name === 'TodoRead') {
      const result = this.handleTodoReadTool();
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
      return result;
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
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
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
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
      return result;
    }

    // Handle Task tool specially - unified subagent entrypoint (Claude SDK style)
    if (isTaskTool(toolCall.name)) {
      const result = await this.handleTask(toolCall);
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
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
        const questionOptions = resultObj['options'] as Array<{
          label: string;
          description?: string;
        }>;
        const questionTimeout = resultObj['autoApproveTimeoutMs'] as number | undefined;
        debugLog(
          `[GenericAgent] dispatch_agent result: ${JSON.stringify(
            {
              status: resultObj['status'],
              question: (resultObj['question'] as string)?.slice(0, 50),
              optionsCount: questionOptions?.length,
              options: questionOptions,
              autoApproveTimeoutMs: questionTimeout,
            },
            null,
            2
          )}`
        );
        debugLog(
          `[GenericAgent] dispatch_agent emitting question event with options: ${JSON.stringify(questionOptions)}`
        );
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
        FlowRecorder.getSession()?.onToolComplete(toolCall.id, resultObj, false);
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
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
      return result;
    }

    // Handle generate_prompt - DAG-driven prompt generation (image/video prompts)
    if (toolCall.name === 'generate_prompt') {
      const args = toolCall.arguments as unknown as PromptDAGParams;

      debugLog(`[GenericAgent] generate_prompt: type=${args.prompt_type}, name=${args.name}, scene=${args.scene_number}, shot=${args.shot_number}`);

      const executor = new PromptDAGExecutor(this.llm, getProjectDir());
      const result = await executor.execute(args);

      // Include loop warning in result if present
      const finalResult = loopWarningMessage
        ? { ...result, loop_warning: loopWarningMessage }
        : result;

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: finalResult,
        isError: result.status === 'error',
        agentName: this.getEffectiveAgentName(),
      });
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, finalResult, result.status === 'error');
      return finalResult;
    }

    // Handle generate_content - content generation with instruction-based approach
    if (toolCall.name === 'generate_content') {
      const args = toolCall.arguments;
      const contentType = args['content_type'] as string;
      const name = args['name'] as string | undefined;
      const instruction = args['instruction'] as string | undefined;
      const sceneNumber = args['scene_number'] as number | undefined;
      const shotNumber = args['shot_number'] as number | undefined;
      const chapterNumber = args['chapter_number'] as number | undefined;

      if (!contentType) {
        const errorResult = { error: 'content_type is required for generate_content' };
        FlowRecorder.getSession()?.onToolComplete(toolCall.id, errorResult, true);
        return errorResult;
      }

      if (!instruction) {
        const errorResult = {
          error: 'instruction is required for generate_content',
          suggestion:
            'Provide a clear instruction describing what content to create, e.g., "Create a detailed character profile for Alice including physical appearance and personality."',
        };
        FlowRecorder.getSession()?.onToolComplete(toolCall.id, errorResult, true);
        return errorResult;
      }

      debugLog(
        `[GenericAgent] generate_content: content_type=${contentType}, instruction=${instruction.substring(0, 100)}...`
      );

      // Build the output file path
      let outputFile = CONTENT_TYPE_OUTPUT_FILES[contentType] || `plans/${contentType}.md`;

      // Handle different content types that need name/number appended
      if ((contentType === 'character' || contentType === 'setting') && name) {
        // For character/setting, append {name}.profile.md
        const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        outputFile = `${outputFile.replace(/\/$/, '')}/${safeName}.profile.md`;
      } else if (contentType === 'story') {
        // For story, append chapter-{n}.story.md
        const chapter = chapterNumber ?? 1;
        outputFile = `${outputFile.replace(/\/$/, '')}/chapter-${chapter}.story.md`;
      } else if (
        (contentType === 'character_image_prompt' || contentType === 'setting_image_prompt') &&
        name
      ) {
        // For character/setting image prompts, append {name}.prompt.md
        const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        outputFile = `${outputFile.replace(/\/$/, '')}/${safeName}.prompt.md`;
      } else if (contentType === 'scene' && sceneNumber !== undefined) {
        // For scene descriptions, append scene-{n}.md
        outputFile = `${outputFile.replace(/\/$/, '')}/scene-${sceneNumber}.md`;
      } else if (contentType === 'scene_image_prompt' && sceneNumber !== undefined) {
        // For scene image prompts, append scene-{n}.prompt.md
        outputFile = `${outputFile.replace(/\/$/, '')}/scene-${sceneNumber}.prompt.md`;
      } else if (contentType === 'scene_video_prompt' && sceneNumber !== undefined) {
        // For scene video prompts, append scene-{n}.motion.json
        outputFile = `${outputFile.replace(/\/$/, '')}/scene-${sceneNumber}.motion.json`;
      } else if (contentType === 'shot_image_prompt' && sceneNumber !== undefined && shotNumber !== undefined) {
        // For shot image prompts, append scene-{n}-shot-{m}.prompt.md
        outputFile = `${outputFile.replace(/\/$/, '')}/scene-${sceneNumber}-shot-${shotNumber}.prompt.md`;
      }

      // Check if the output file already exists (skip regeneration unless overwrite is true)
      const overwrite = args['overwrite'] as boolean | undefined;
      if (!overwrite) {
        const projectDir = getProjectDir();
        const fullOutputPath = path.join(projectDir, outputFile);
        if (fs.existsSync(fullOutputPath)) {
          try {
            const existingContent = fs.readFileSync(fullOutputPath, 'utf-8');
            if (existingContent.trim().length > 0) {
              debugLog(
                `[GenericAgent] generate_content: file already exists at ${outputFile}, returning existing content`
              );
              const result = {
                already_exists: true,
                content_type: contentType,
                output_file: outputFile,
                content: existingContent,
                message: `Content already exists at ${outputFile}. Use overwrite: true to regenerate.`,
              };
              FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
              return result;
            }
          } catch {
            // File exists but can't be read — fall through to regeneration
          }
        }
      }

      // Build content system prompt and route through contentState loop
      // This activates streaming + approval + feedback support
      const contentPromptResult = buildContentPrompt(instruction, contentType as ContentType, undefined, getProjectDir());
      const contentSystemPrompt = contentPromptResult.prompt;

      // Skills loaded info is debug-only — don't emit to UI to avoid message clutter

      // Auto-inject duration context from project
      let durationSection = '';
      const cachedProject = loadProject();
      if (cachedProject?.targetDuration) {
        const totalDuration = cachedProject.targetDuration;
        const budget = computeDurationBudget(totalDuration);

        if (budget) {
          let scopeGuidance: string;
          if (totalDuration <= 30) scopeGuidance = 'This is a very short video — focus on ONE key moment, 2-3 scenes max.';
          else if (totalDuration <= 60) scopeGuidance = 'This is a short video — cover only the core dramatic arc.';
          else if (totalDuration <= 120) scopeGuidance = 'This is a medium-length video — cover the main narrative with moderate detail.';
          else scopeGuidance = 'This is a longer video — a fuller narrative is appropriate.';

          durationSection = `\n<duration_constraints>\nTarget video duration: ${totalDuration} seconds\nMinimum total shots needed: ${budget.minTotalShots} (across all scenes)\nSuggested scene range: ${budget.suggestedSceneRange.min}-${budget.suggestedSceneRange.max} (let the narrative determine the exact count)\nAverage shot duration: ~${budget.avgShotDuration} seconds\nEach scene may have 1-3 shots based on its complexity.\nCRITICAL: Minimum shot duration is 4 seconds. The video model produces empty/failed output below 4s. Prefer 5-8 second shots.\n${scopeGuidance}\n</duration_constraints>\n`;
        }
      }

      // Try to pre-fetch context to eliminate subagent read_file() calls
      const preloaded = buildPreloadedContext(contentType, name, sceneNumber, shotNumber, chapterNumber, cachedProject);
      let subAgentTask: string;

      if (preloaded) {
        // Context pre-loaded: instruct subagent to use it directly
        debugLog(
          `[GenericAgent] Pre-loaded context for ${contentType}: ${preloaded.filesRead.length} files read (${preloaded.filesRead.join(', ')})`
        );
        subAgentTask = `${durationSection}ALL context has been pre-loaded below. DO NOT call any tools — no read_file(), no read_project(). Everything you need is provided. Generate the ${contentType} content directly.\n\nInstruction: ${instruction}\n\n${preloaded.contextBlock}`;

        if (contentType === 'shot_image_prompt' && shotNumber !== undefined) {
          subAgentTask += `\n\n**Shot Number:** ${shotNumber}\n**Note:** Generate an image prompt specifically for this shot's framing and composition. Use only the reference images relevant to this shot.\n`;
        }
      } else {
        // No pre-loaded context available (unknown type or no project) — fall back to discovery
        subAgentTask = `${durationSection}First, use read_project() to understand the project structure, template type, and available files. Then use read_file() to fetch the relevant source material listed in the project files. Finally, generate the ${contentType} content based on this instruction:\n\n${instruction}`;
      }

      debugLog(
        `[GenericAgent] generate_content initializing contentState for: "${instruction.substring(0, 100)}..."`
      );

      // Clear known project files and read caches from previous content sessions
      clearKnownProjectFiles();
      this.readCache.clear();
      this.listFilesCache.clear();

      // Initialize contentState for streaming + approval
      this.contentState = {
        active: true,
        task: instruction,
        contentType: contentType as ContentType,
        outputFile,
        messages: [
          { role: 'system', content: contentSystemPrompt },
          { role: 'user', content: subAgentTask },
        ],
        currentContent: '',
        iterations: 0,
        toolCallId: toolCall.id,
        gatheringContext: !preloaded, // Skip gathering phase when context is pre-loaded
      };
      this.currentMode = 'content';
      const result = await this.continueContentLoop();

      // Auto-create timeline skeleton after scene_breakdown is generated
      if (contentType === 'scene_breakdown' || contentType === 'scene') {
        try {
          const resultObj = result as Record<string, unknown>;
          const generatedContent = (resultObj['content'] as string) ?? '';
          const projectDir = getProjectDir();
          const timelineProject = loadProject();

          if (generatedContent && projectDir && timelineProject?.targetDuration) {
            // Only auto-create if no timeline exists yet
            const existingTimeline = loadTimeline(projectDir);
            if (!existingTimeline) {
              const parsedScenes = parseSceneBreakdown(generatedContent);
              if (parsedScenes.length > 0) {
                const descriptors = parsedScenes.map(s => ({
                  label: s.label,
                  suggestedDuration: s.suggestedDuration,
                }));
                const timeline = createTimelineSkeleton(timelineProject.targetDuration, descriptors);
                saveTimeline(projectDir, timeline);
                debugLog(
                  `[GenericAgent] Auto-created timeline skeleton with ${parsedScenes.length} segments from ${contentType}`
                );
                this.emit({
                  type: 'notification',
                  level: 'info',
                  message: `Timeline skeleton auto-created with ${parsedScenes.length} segments (${timelineProject.targetDuration}s total)`,
                });
              }
            } else {
              debugLog('[GenericAgent] Timeline already exists, skipping auto-creation');
            }
          }
        } catch (err) {
          debugLog(`[GenericAgent] Auto-timeline creation failed (non-fatal): ${err}`);
        }
      }

      // Include loop warning in result if present
      const finalResult = loopWarningMessage
        ? { ...(result as Record<string, unknown>), loop_warning: loopWarningMessage }
        : result;

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: finalResult,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, finalResult, false);
      return finalResult;
    }

    // Handle dispatch_content_agent specially - spawn a sub-agent for creative content
    if (toolCall.name === 'dispatch_content_agent') {
      const result = await this.handleDispatchContentAgent(toolCall);

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
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
        FlowRecorder.getSession()?.onToolComplete(toolCall.id, resultObj, false);
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
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
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
        FlowRecorder.getSession()?.onToolComplete(toolCall.id, resultObj, false);
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
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
      return result;
    }

    // Handle dispatch_explore - spawns explore agent for documentation research
    if (toolCall.name === 'dispatch_explore') {
      const result = await this.handleDispatchExplore(toolCall);
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
      return result;
    }

    // Handle dispatch_skill - spawns skill agent for specialized work
    if (toolCall.name === 'dispatch_skill') {
      const result = await this.handleDispatchSkill(toolCall);
      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
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
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, errorResult, true);
      return errorResult;
    }

    // Framework-enforced confirmation for complex tools (skip in autonomous mode)
    if (isComplexTool(toolCall.name) && !this.autonomousMode) {
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
        FlowRecorder.getSession()?.onToolComplete(toolCall.id, confirmResult, false);
        return confirmResult;
      } else {
        // Second call after confirmation - execute and clear pending
        this.pendingConfirmations.delete(toolCall.name);
      }
    }

    // Execute the tool handler
    // For ComfyUI generation tools, subscribe to real-time progress and relay as tool_streaming
    let progressHandler: ComfyProgressHandler | undefined;
    if (COMFY_PROGRESS_TOOLS.has(toolCall.name)) {
      progressHandler = (event) => {
        // Show the message from ComfyUI (includes setup phases, node execution, and step progress)
        const chunk = event.step && event.maxSteps
          ? `Step ${event.step}/${event.maxSteps} (${event.percentage}%)`
          : event.message || `${event.percentage}%`;
        this.emit({
          type: 'tool_streaming',
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          chunk,
          done: event.done,
          reset: true,
          agentName: this.getEffectiveAgentName(),
        });
      };
      comfyProgressBus.onProgress(progressHandler);
    }

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

      this.emit({
        type: 'tool_result',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        isError: false,
        agentName: this.getEffectiveAgentName(),
      });
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, result, false);
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
      FlowRecorder.getSession()?.onToolComplete(toolCall.id, errorResult, true);
      return errorResult;
    } finally {
      if (progressHandler) {
        comfyProgressBus.offProgress(progressHandler);
      }
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
      return await this.handleDispatchAgent({
        ...toolCall,
        name: 'dispatch_agent',
      });
    }

    if (subagentType === 'content-creator') {
      return await this.handleDispatchContentAgent({
        ...toolCall,
        name: 'dispatch_content_agent',
      });
    }

    if (subagentType === 'image-generator') {
      return await this.handleDispatchImageAgent({
        ...toolCall,
        name: 'dispatch_image_agent',
      });
    }

    if (subagentType === 'video-assembler') {
      return await this.handleDispatchVideoAgent({
        ...toolCall,
        name: 'dispatch_video_agent',
      });
    }

    // New skill-based architecture types
    if (subagentType === 'Explore') {
      return await this.handleDispatchExplore({
        ...toolCall,
        name: 'dispatch_explore',
      });
    }

    // Map skill types to dispatch_skill
    const skillTypes: SkillType[] = [
      'content-writing',
      'image-prompting',
      'video-direction',
      'research-synthesis',
      'narration-scripting',
    ];
    if (skillTypes.includes(subagentType as SkillType)) {
      return await this.handleDispatchSkill({
        ...toolCall,
        name: 'dispatch_skill',
        arguments: {
          ...args,
          skill_name: subagentType,
        },
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
  private handleTodoReadTool(): unknown {
    const todos = this.todoManager.getTodos().filter(t => t.visible);
    if (todos.length === 0) {
      return { todos: [], message: 'No todos found. Use TodoWrite to create todos.' };
    }
    const todoList = todos.map(t => ({
      id: t.id,
      status: t.status,
      content: t.content,
    }));
    return {
      todos: todoList,
      instructions: 'Use TodoWrite(merge=true) with the todo id to update specific todos. Set status to "completed" for finished tasks, "in_progress" for the next task to work on.',
    };
  }

  private handleTodoTool(toolCall: ToolCall): unknown {
    const args = toolCall.arguments;
    const merge = (args['merge'] as boolean | undefined) ?? false;
    const todos = (args['todos'] as Array<Record<string, unknown>> | undefined) ?? [];
    const removedIds = (args['removed_ids'] as string[] | undefined) ?? [];

    // Remove specified todos first
    if (removedIds.length > 0) {
      this.todoManager.removeTodosById(removedIds);
    }

    // Claude SDK guidance: never create single-item todo lists.
    // Only applies to replace mode (merge=false) — merging a single status update is valid.
    if (!merge && todos.length > 0 && todos.length < 2) {
      return {
        error:
          'Never create single-item todo lists. If you only have one task, just do it directly.',
      };
    }

    // If only removed_ids was provided (no todos), still emit update and persist
    if (todos.length === 0) {
      const updatedTodos = this.todoManager.getTodos();

      if (projectExists()) {
        const persistedTodos = updatedTodos.map(t => ({
          id: t.id,
          content: t.content,
          activeForm: t.activeForm,
          status: t.status,
          visible: t.visible,
          depth: t.depth,
        }));
        saveTodos(persistedTodos);
      }

      this.emit({
        type: 'todo_update',
        todos: updatedTodos,
        agentName: this.getEffectiveAgentName(),
      });

      return {
        status: 'success',
        message: removedIds.length > 0 ? `Removed ${removedIds.length} todo(s)` : 'No changes',
        todos: updatedTodos,
      };
    }

    // Check for tool call patterns in todo content (forbidden)
    const toolCallPatterns = [
      /\b(dispatch_\w+|update_project|read_project|import_file|read_file|todo_write|TodoWrite|TodoRead|ask_user|AskUserQuestion)\b/i,
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
            suggestion:
              'Rewrite todos to be task-focused. Good: "Create character profile for Alice". Bad: "Use dispatch_content_agent to create Alice".',
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
    debugLog(
      `[GenericAgent] handleTodoTool: merge=${merge}, inputTodos=${todos.length}, resultTodos=${updatedTodos.length}`
    );
    debugLog(
      `[GenericAgent] handleTodoTool emitting todo_update with ${updatedTodos.length} todos: ${JSON.stringify(updatedTodos.map(t => ({ id: t.id, status: t.status, content: t.content?.slice(0, 30) })))}`
    );

    // Automatically persist todos to project file for resumption
    if (projectExists()) {
      const persistedTodos = updatedTodos.map(t => ({
        id: t.id,
        content: t.content,
        activeForm: t.activeForm,
        status: t.status,
        visible: t.visible,
        depth: t.depth,
      }));
      saveTodos(persistedTodos);
      debugLog(`[GenericAgent] Auto-persisted ${persistedTodos.length} todos to project`);
    }

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
  } | null = null;

  // State for dispatch_content_agent sub-agent (creative content generation)
  private contentState: {
    active: boolean;
    task: string;
    contentType: ContentType;
    outputFile?: string;
    messages: Message[];
    currentContent: string;
    iterations: number;
    /** Tool call ID for streaming events */
    toolCallId: string;
    /** Whether we're in the context-gathering phase (tool calls allowed) */
    gatheringContext: boolean;
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
  private videoGenState: {
    active: boolean;
    task: string;
    sceneNumber: number;
    sceneImageArtifactId?: string;
    motionDescription?: string;
    context?: string;
    messages: Message[];
    currentParams: {
      duration: number;
      fps: number;
      motionStrength: number;
    };
    iterations: number;
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
          debugLog(
            `[GenericAgent] Resolved context_ref ${ref} for planning agent (${stored.label}, ${stored.content.length} chars)`
          );
        } else {
          debugLog(`[GenericAgent] WARNING: Context reference not found: ${ref}`);
        }
      }
    }

    // Build combined context with clear sections
    let context: string | undefined;
    if (contextParts.length > 0) {
      context = contextParts
        .map(part => `## ${part.variableName} (${part.label})\n\n${part.content}`)
        .join('\n\n---\n\n');
      debugLog(
        `[GenericAgent] Combined ${contextParts.length} contexts for planning agent (${context.length} chars total)`
      );
    }

    // Check if we're resuming an existing planning session
    if (this.planningState?.active) {
      // This shouldn't happen - dispatch_agent shouldn't be called while planning is active
      return { error: 'Planning already in progress' };
    }

    // Initialize planning state with imported prompt
    const planningSystemPrompt = buildPlanningPrompt(task, context);

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
    };

    // Generate the initial plan
    return this.continuePlanningLoop();
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
      debugLog(
        `[GenericAgent] continuePlanningLoop starting generation, toolCallId=${this.planningState.toolCallId}`
      );

      // If this is a subsequent iteration (after feedback), we need to reset the streaming display
      const shouldReset = this.planningState.iterations > 1;

      for await (const chunk of this.llm.generateStream({
        messages: this.planningState.messages,
        temperature: 0.7,
      })) {
        if (chunk.content) {
          planContent += chunk.content;
          debugLog(
            `[GenericAgent] tool_streaming emit: chunk=${chunk.content.length} chars, total=${planContent.length} chars`
          );
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
          debugLog(
            `[GenericAgent] tool_streaming DONE: total planContent=${planContent.length} chars`
          );
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
      const verificationQuestion =
        this.planningState.iterations === 1
          ? "I've created a plan for this task. Would you like to proceed or provide feedback?"
          : "I've updated the plan based on your feedback. Would you like to proceed or provide more feedback?";

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
        autoApproveTimeoutMs: 15000, // 15 seconds countdown for plan approval
      };
      debugLog(
        `[GenericAgent] continuePlanningLoop returning: ${JSON.stringify(
          {
            status: verificationResult.status,
            question: verificationResult.question?.slice(0, 50),
            optionsCount: verificationResult.options.length,
            options: verificationResult.options,
            autoApproveTimeoutMs: verificationResult.autoApproveTimeoutMs,
          },
          null,
          2
        )}`
      );
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

    // Use LLM to classify the user's intent
    const isApproval = this.classifyPlanResponse(userResponse);

    if (isApproval) {
      // Generate plan name and summary using LLM
      const { name, summary } = await this.generatePlanMetadata(
        this.planningState.task,
        this.planningState.currentPlan
      );

      // Store full plan in external context file
      const { variableName } = contextStore.store(this.planningState.currentPlan, name, {
        source: 'tool',
        variableBaseName: 'plan',
      });

      const result = {
        status: 'approved',
        name,
        summary,
        plan_ref: variableName,
        task: this.planningState.task,
        iterations: this.planningState.iterations,
        message: `Plan "${name}" approved. Summary: ${summary}\n\nTo read the full plan, use fetch_context with ${variableName}.`,
        next_steps:
          'IMPORTANT: Now update the project state - call update_project to: 1) Set planner stage to "complete", 2) Mark the current phase as "completed", 3) Transition to the next phase.',
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
   * Classify whether user response indicates approval or feedback using pattern matching.
   */
  private classifyPlanResponse(userResponse: string): boolean {
    const lower = userResponse.toLowerCase().trim();

    // Explicit feedback patterns - check first
    const feedbackPatterns = [
      'provide feedback',
      'feedback',
      '2',
      'no',
      'not yet',
      'change',
      'revise',
    ];
    if (feedbackPatterns.some(p => lower === p || lower.startsWith(p))) {
      return false;
    }

    // Approval patterns
    const approvalPatterns = [
      'accept',
      'accept content',
      'approve',
      'approve content',
      'yes',
      'ok',
      'okay',
      'proceed',
      'go ahead',
      'go',
      'start',
      'continue',
      'lgtm',
      'looks good',
      'y',
      '1',
    ];

    return approvalPatterns.some(p => lower === p || lower.startsWith(p));
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

    // Try to extract a meaningful name from the content itself
    const extractNameFromContent = (text: string, type: string): string => {
      // Try markdown heading: "# Character Name" or "## Setting Name"
      const headingMatch = text.match(/^#{1,3}\s+(.+)/m);
      if (headingMatch) {
        const heading = headingMatch[1]!.trim();
        // Strip type prefix if present (e.g., "Character: Rowan" → "Rowan")
        const stripped = heading.replace(/^(character|setting|scene|plot|story)[:\s-]+/i, '').trim();
        if (stripped.length > 0 && stripped.length <= 50) return stripped;
      }
      // Try bold title: "**Name**" at start of content
      const boldMatch = text.match(/^\*\*([^*]+)\*\*/m);
      if (boldMatch) {
        const bold = boldMatch[1]!.trim();
        const stripped = bold.replace(/^(character|setting|scene|plot|story)[:\s-]+/i, '').trim();
        if (stripped.length > 0 && stripped.length <= 50) return stripped;
      }
      return `${type} content`;
    };

    const fallback = {
      name: extractNameFromContent(content, contentType),
      summary: `${contentType} content for: ${task.slice(0, 100)}`,
    };
    try {
      const response = await this.llm.generate({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        maxTokens: 200,
      });

      const parsed = JSON.parse(response.content ?? '{}');
      return {
        name: parsed.name || fallback.name,
        summary: parsed.summary || fallback.summary,
      };
    } catch {
      return fallback;
    }
  }

  /**
   * Check if there's an active planning session awaiting user input.
   */
  isPlanningActive(): boolean {
    return this.planningState?.active ?? false;
  }


  /**
   * Try to resolve a context reference from project files.
   * This is a fallback when the context isn't found in the context store.
   * Supports both variable names ($plan) and direct file paths (plans/story.md).
   */
  private tryResolveFromProjectFiles(
    ref: string
  ): { label: string; content: string; file: string } | null {
    // Map of context ref patterns to project file paths
    const projectFileMap: Record<string, { file: string; label: string }> = {
      $plan: { file: 'plans/story.md', label: 'Story Plan' },
      $plot: { file: 'plans/plot.md', label: 'Plot' },
      $story: { file: 'plans/story.md', label: 'Story' },
      $scenes: { file: 'plans/scenes.md', label: 'Scenes' },
      $images: { file: 'plans/images.md', label: 'Images Plan' },
      $video: { file: 'plans/video.md', label: 'Video Plan' },
      $original_input: { file: 'original_input.md', label: 'Original Input' },
    };

    const projectDir = getProjectDir();

    // Check if ref is a direct file path (e.g., "plans/story.md")
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

  /**
   * Handle dispatch_content_agent tool - spawns a TRUE sub-agent for creative content generation.
   * The sub-agent runs its own run() loop, using read_project and read_file tools to gather context.
   * All tool calls from the sub-agent are forwarded to the parent, making them visible in the CLI.
   */
  private async handleDispatchContentAgent(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const task = args['task'] as string;
    const contentType = args['content_type'] as ContentType;
    const outputFile = args['output_file'] as string | undefined;

    if (!task) {
      return { error: 'No task/instruction provided for dispatch_content_agent' };
    }

    if (!contentType) {
      return { error: 'No content_type provided for dispatch_content_agent' };
    }

    // Validate content_type is one of the allowed types
    const validContentTypes = [
      // Narrative types
      'plot', 'story', 'character', 'setting', 'scene', 'narration',
      // Documentary/generic types
      'outline', 'segment', 'thesis', 'research', 'script',
    ];
    if (!validContentTypes.includes(contentType)) {
      return {
        error: `Invalid content_type "${contentType}". Must be one of: ${validContentTypes.join(', ')}`,
        suggestion:
          'Use the appropriate content_type for your task. For example, use "character" for character profiles, "scene" for scene descriptions, "segment" for documentary segments.',
      };
    }

    debugLog(
      `[GenericAgent] Content creation via sub-agent: type=${contentType}, instruction="${task.substring(0, 100)}..."`
    );

    // Build the content prompt
    const contentPromptResult = buildContentPrompt(task, contentType, undefined, getProjectDir());
    const contentSystemPrompt = contentPromptResult.prompt;

    if (contentPromptResult.injectedSkills.length > 0) {
      this.emit({
        type: 'agent_text',
        text: `> **Skills loaded:** ${contentPromptResult.injectedSkills.join(', ')}\n\n`,
        isFinal: false,
      });
    }

    // Build the user task for the sub-agent
    const subAgentTask = `First, use read_project() to understand the project structure, template type, and available files. Then use read_file() to fetch the relevant source material listed in the project files. Finally, generate the ${contentType} content based on this instruction:\n\n${task}`;

    try {
      // Run the sub-agent - it uses the SAME run() loop as the main agent
      // All tool calls will be visible in the CLI via event forwarding
      const result = await this.runSubAgent({
        name: 'Content Agent',
        tools: getContentCreatorTools(),
        prompt: contentSystemPrompt,
        task: subAgentTask,
        maxIterations: 10,
        parentToolCallId: toolCall.id,
      });

      // Extract the generated content from the sub-agent's output
      const generatedContent = result.output || '';

      // Always save content to disk — auto-generate outputFile if not specified
      const effectiveOutputFile = outputFile || CONTENT_TYPE_OUTPUT_FILES[contentType] || `plans/${contentType}.md`;
      if (generatedContent) {
        try {
          const projectDir = getProjectDir();
          const filePath = path.join(projectDir, effectiveOutputFile);

          // Ensure parent directory exists
          const parentDir = path.dirname(filePath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }

          fs.writeFileSync(filePath, generatedContent, 'utf-8');
          debugLog(`[GenericAgent] Saved content to ${filePath}`);

          // Auto-persist to project registry
          persistApprovedContent(contentType, undefined, generatedContent, effectiveOutputFile);

          // Register file in project so other tools can discover it
          if (projectExists()) {
            registerFile(effectiveOutputFile, contentType, {
              summary: generatedContent.slice(0, 200).trim(),
            });
          }
        } catch (saveError) {
          debugLog(`[GenericAgent] Error saving content to file: ${String(saveError)}`);
        }
      }

      return {
        status: result.status,
        content: generatedContent,
        content_type: contentType,
        output_file: effectiveOutputFile,
        message: `Content generated successfully — saved to ${effectiveOutputFile}`,
      };
    } catch (error) {
      return {
        error: `Content creation failed: ${String(error)}`,
        task,
        content_type: contentType,
      };
    }
  }

  /**
   * Get tools available to the content creator subagent.
   * These allow it to pull context as needed.
   */
  private getContentCreatorTools(): ToolDefinition[] {
    // Use the canonical tools from contentCreatorTools.ts — single source of truth
    return getContentCreatorTools();
  }

  /**
   * Execute a tool call from the content creator.
   */
  private async executeContentCreatorTool(toolCall: ToolCall): Promise<string> {
    const projectDir = getProjectDir();

    if (toolCall.name === 'read_project') {
      try {
        const project = loadProject();
        if (!project) {
          return 'No project found. The project has not been initialized yet.';
        }
        // Return a template-agnostic view of the project
        const summary: Record<string, unknown> = {
          style: project.style,
          templateId: project.templateId ?? 'narrative',
          currentPhase: project.currentPhase,
          characters: (project.characters || []).map((char: { name: string; referenceImagePath?: string }) => {
            const refPath = char.referenceImagePath;
            const refExists = refPath ? fs.existsSync(path.join(projectDir, refPath)) : false;
            return {
              name: char.name,
              file: project.content?.characters?.itemFiles?.[char.name] ||
                `characters/${char.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.profile.md`,
              referenceImagePath: refExists ? refPath : null,
              referenceImageStatus: refPath ? (refExists ? 'exists' : 'missing') : undefined,
            };
          }),
          settings: (project.settings || []).map((setting: { name: string; referenceImagePath?: string }) => {
            const refPath = setting.referenceImagePath;
            const refExists = refPath ? fs.existsSync(path.join(projectDir, refPath)) : false;
            return {
              name: setting.name,
              file: project.content?.settings?.itemFiles?.[setting.name] ||
                `settings/${setting.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.profile.md`,
              referenceImagePath: refExists ? refPath : null,
              referenceImageStatus: refPath ? (refExists ? 'exists' : 'missing') : undefined,
            };
          }),
          scenes: (project.scenes || []).map((scene: { sceneNumber: number; title?: string; imageArtifactId?: string }) => ({
            sceneNumber: scene.sceneNumber,
            title: scene.title,
            imageArtifactId: scene.imageArtifactId,
          })),
          files: project.files || [],
        };
        return JSON.stringify(summary, null, 2);
      } catch (err) {
        return `Error reading project: ${String(err)}`;
      }
    }

    if (toolCall.name === 'read_file') {
      const filePath = (toolCall.arguments['file_path'] ?? toolCall.arguments['path']) as string;
      if (!filePath) {
        return 'Error: file_path is required';
      }
      try {
        const fullPath = path.join(projectDir, filePath);

        // Single stat call — handles both existence check and mtime
        let stats: fs.Stats;
        try {
          stats = fs.statSync(fullPath);
        } catch (statErr: unknown) {
          if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') {
            this.readCache.evict(fullPath);
            return `File not found: ${filePath}`;
          }
          throw statErr;
        }

        // Check read cache — avoid re-reading unchanged files
        const cachedLen = this.readCache.check(fullPath, stats.mtimeMs);
        if (cachedLen !== null) {
          return `[File "${filePath}" already read — ${cachedLen} chars, unchanged. Use the content from your previous read.]`;
        }

        // Read file — handle race where file is deleted between stat and read
        let content: string;
        try {
          content = fs.readFileSync(fullPath, 'utf-8');
        } catch (readErr: unknown) {
          if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
            this.readCache.evict(fullPath);
            return `File not found: ${filePath}`;
          }
          throw readErr;
        }
        this.readCache.set(fullPath, stats.mtimeMs, content.length);
        return content;
      } catch (err) {
        return `Error reading file: ${String(err)}`;
      }
    }

    if (toolCall.name === 'list_project_files') {
      // Return cached result if available and still fresh
      const cachedList = this.listFilesCache.get();
      if (cachedList) {
        return '[File listing unchanged since last call. Use the file paths from your previous list_project_files result.]\n\n' + cachedList;
      }

      try {
        const { listProjectFilesTool } = await import('../../tasks/video/workflow/FileTools.js');
        if (listProjectFilesTool.handler) {
          const result = await listProjectFilesTool.handler(toolCall.arguments || {});

          // Register known file paths for read_file validation
          try {
            const resultObj = result as Record<string, unknown>;
            const files = resultObj['files'] as Array<{ path: string }> | undefined;
            if (files && Array.isArray(files)) {
              const { registerKnownProjectFiles } = await import('../tools/builtin/contentCreatorTools.js');
              registerKnownProjectFiles(files.map(f => f.path));
            }
          } catch {
            // Non-critical: validation won't be enforced if registration fails
          }

          const resultStr = JSON.stringify(result, null, 2);
          this.listFilesCache.set(resultStr);
          return resultStr;
        }
        return 'Error: list_project_files handler not available';
      } catch (err) {
        return `Error listing project files: ${String(err)}`;
      }
    }

    return `Unknown tool: ${toolCall.name}`;
  }

  /**
   * Continue the content creation loop - handles tool calls for context gathering,
   * then generates content and asks for user verification.
   */
  private async continueContentLoop(): Promise<unknown> {
    if (!this.contentState) {
      return { error: 'No active content session' };
    }

    const maxIterations = 10;
    const maxToolCallRounds = 5; // Limit tool call rounds to prevent infinite loops

    if (this.contentState.iterations >= maxIterations) {
      debugLog(
        `[GenericAgent] Content loop reached max iterations (${maxIterations}) for ${this.contentState.contentType}. Current draft length: ${this.contentState.currentContent?.length ?? 0}`
      );
      const result = {
        status: 'max_iterations',
        content: this.contentState.currentContent,
        content_type: this.contentState.contentType,
        task: this.contentState.task,
        output_file: this.contentState.outputFile,
        message: `Content generation reached the iteration limit (${maxIterations}). The current draft may be incomplete. You can regenerate with overwrite: true.`,
      };
      this.contentState = null;
      this.currentMode = 'orchestrator';
      return result;
    }

    this.contentState.iterations++;

    try {
      // Get tools for context gathering phase
      const tools = this.contentState.gatheringContext ? this.getContentCreatorTools() : undefined;
      let toolCallRounds = 0;

      // Agentic loop: handle tool calls until content is generated
      while (true) {
        // During context gathering, use non-streaming with tools
        if (this.contentState.gatheringContext) {
          const response = await this.llm.generate({
            messages: this.contentState.messages,
            tools,
            temperature: 0.8,
          });

          // Check if there are tool calls to handle
          if (response.toolCalls && response.toolCalls.length > 0) {
            toolCallRounds++;
            if (toolCallRounds > maxToolCallRounds) {
              debugLog(
                `[GenericAgent] Content creator exceeded max tool call rounds, proceeding to generation`
              );
              this.contentState.gatheringContext = false;
              // Add message to proceed with generation
              this.contentState.messages.push({
                role: 'user',
                content:
                  'You have gathered enough context. Now please generate the content based on what you have learned.',
              });
              continue;
            }

            // Emit any text the content creator produced while deciding on tool calls
            if (response.content && response.content.trim()) {
              this.emit({
                type: 'agent_text',
                text: response.content.trim(),
                isFinal: false,
              });
            }

            // Add assistant message with tool calls
            this.contentState.messages.push({
              role: 'assistant',
              content: response.content,
              toolCalls: response.toolCalls,
            });

            // Execute each tool call and add results
            for (const tc of response.toolCalls) {
              debugLog(
                `[GenericAgent] Content creator tool call: ${tc.name}(${JSON.stringify(tc.arguments)})`
              );

              // Emit tool_call event so UI can show sub-agent activity
              this.emit({
                type: 'tool_call',
                toolCallId: tc.id,
                toolName: tc.name,
                arguments: tc.arguments,
                agentName: 'Content Creator',
                parentToolCallId: this.contentState!.toolCallId,
              });

              const result = await this.executeContentCreatorTool(tc);

              // Emit tool_result event
              this.emit({
                type: 'tool_result',
                toolCallId: tc.id,
                toolName: tc.name,
                result: result.length > 500 ? result.slice(0, 500) + '...' : result,
                agentName: 'Content Creator',
                parentToolCallId: this.contentState!.toolCallId,
              });

              this.contentState.messages.push({
                role: 'tool',
                content: result,
                toolCallId: tc.id,
              });
            }

            // Continue the loop to get next response
            continue;
          }

          // No tool calls during gathering - emit any text and switch to content generation
          if (response.content && response.content.trim()) {
            this.emit({
              type: 'agent_text',
              text: response.content.trim(),
              isFinal: false,
            });
          }
          this.contentState.gatheringContext = false;
        }

        // Content generation phase - use streaming for real-time display
        let content = '';
        let isFirstChunk = true;
        const shouldReset = this.contentState.iterations > 1;

        debugLog(`[GenericAgent] Starting content generation with streaming`);

        const streamOptions: Parameters<typeof this.llm.generateStream>[0] = {
          messages: this.contentState.messages,
          temperature: 0.8,
        };
        if (this.contentState.contentType === 'scene_video_prompt') {
          // Use json_object (broadly supported) instead of json_schema (OpenAI-only).
          // The prompt instructions already describe the required JSON structure.
          streamOptions.responseFormat = { type: 'json_object' as const };
        }

        // Reset think tag filter for content creator streaming
        this.resetThinkTagFilter();
        const hasImplicitThinking = this.llm.hasImplicitThinking;

        for await (const chunk of this.llm.generateStream(streamOptions)) {
          // Handle content chunks — separate <think> tags from output
          if (chunk.content) {
            content += chunk.content;
            const { output, thinking } = this.processStreamChunk(chunk.content);

            // Emit thinking content so UI can display it
            if (hasImplicitThinking && thinking) {
              this.emit({ type: 'streaming_think', chunk: thinking, done: false });
            }

            // Emit regular content as tool streaming
            if (output) {
              this.emit({
                type: 'tool_streaming',
                toolCallId: this.contentState.toolCallId,
                chunk: output,
                done: false,
                agentName: 'Content Creator',
                toolName: 'generate_content',
                reset: isFirstChunk && shouldReset,
              });
              isFirstChunk = false;
            }
          }

          // Handle stream completion
          if (chunk.done) {
            // Flush any remaining buffered content
            const { output: remainingOutput, thinking: remainingThinking } =
              this.flushThinkTagBuffer();
            if (hasImplicitThinking && remainingThinking) {
              this.emit({ type: 'streaming_think', chunk: remainingThinking, done: false });
            }
            if (hasImplicitThinking) {
              this.emit({ type: 'streaming_think', chunk: '', done: true });
            }
            if (remainingOutput) {
              this.emit({
                type: 'tool_streaming',
                toolCallId: this.contentState.toolCallId,
                chunk: remainingOutput,
                done: false,
                agentName: 'Content Creator',
                toolName: 'generate_content',
              });
            }
            this.emit({
              type: 'tool_streaming',
              toolCallId: this.contentState.toolCallId,
              chunk: '',
              done: true,
              agentName: 'Content Creator',
            });
          }
        }

        // Clean content (remove <think> tags and leaked tool-call XML)
        let cleanedContent = content
          ? content
              .replace(/<think>.*?<\/think>/gs, '') // Complete think blocks
              .replace(/<think>.*$/gs, '') // Orphan opening tag
              .replace(/<\/think>/g, '') // Orphan closing tag
              .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '') // Leaked tool call blocks
              .replace(/<function=[^>]*>[\s\S]*?<\/function>/g, '') // Leaked function calls
              .trim()
          : '';

        // For scene_video_prompt, emit a formatted display to replace raw JSON stream
        if (this.contentState.contentType === 'scene_video_prompt' && cleanedContent) {
          try {
            const parsed = JSON.parse(cleanedContent);
            let display: string;
            if (parsed.shots && Array.isArray(parsed.shots)) {
              // Multi-shot display
              display = `**Scene ${parsed.sceneNumber}: ${parsed.sceneTitle}** (${parsed.totalSceneDuration}s)\n\n`;
              for (const shot of parsed.shots) {
                display += `---\n**Shot ${shot.shotNumber}** [${shot.shotType}] (${shot.duration}s)\n`;
                display += `**Camera:** ${shot.cameraWork}\n`;
                display += `**Prompt:** ${shot.prompt}\n`;
                if (shot.dialogue) display += `**Dialogue:** "${shot.dialogue}"\n`;
                if (shot.referenceImages?.length) display += `**Refs:** ${shot.referenceImages.join(', ')}\n`;
                display += '\n';
              }
              display += `**Reference Images:** ${parsed.referenceImages?.join(', ') || 'None'}`;
            } else {
              // Legacy single-prompt display
              display = `**Motion Prompt:**\n${parsed.prompt}\n\n**Reference Images:** ${
                parsed.referenceImages?.length ? parsed.referenceImages.join(', ') : 'None'
              }`;
            }
            this.emit({
              type: 'tool_streaming',
              toolCallId: this.contentState.toolCallId,
              chunk: display,
              done: true,
              agentName: 'Content Creator',
              toolName: 'generate_content',
              reset: true,
            });
          } catch {
            // Keep raw display if JSON parse fails
          }
        }

        // Post-generation validation: strip hallucinated reference image paths
        if (cleanedContent && this.contentState.contentType === 'scene_video_prompt') {
          try {
            const { validateAndSanitizeReferenceImages } = await import(
              '../tools/builtin/referenceImageValidator.js'
            );
            const { sanitized, removedPaths } = validateAndSanitizeReferenceImages(cleanedContent);
            if (removedPaths.length > 0) {
              debugLog(
                `[GenericAgent] Reference image validator removed ${removedPaths.length} hallucinated path(s): ${removedPaths.join(', ')}`
              );
              cleanedContent = sanitized;
            }
          } catch {
            // Validation failed — continue with original content
          }
        }

        this.contentState.currentContent = cleanedContent || 'No content generated';

        // Add assistant response to history
        this.contentState.messages.push({
          role: 'assistant',
          content: this.contentState.currentContent,
        });

        break; // Exit the loop - content generated
      }

      // Auto-approve: save content immediately without user verification
      let fileSaved = false;
      if (this.contentState.outputFile) {
        try {
          const projectDir = getProjectDir();
          const filePath = path.join(projectDir, this.contentState.outputFile);

          // Ensure parent directory exists
          const parentDir = path.dirname(filePath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }

          fs.writeFileSync(filePath, this.contentState.currentContent, 'utf-8');
          fileSaved = true;
          debugLog(`[GenericAgent] Saved content to ${this.contentState.outputFile}`);
        } catch (err) {
          debugLog(
            `[GenericAgent] ERROR: Failed to save content to ${this.contentState.outputFile}: ${err}`
          );
        }
      }

      // Generate content name and summary using LLM
      const { name, summary } = await this.generateContentMetadata(
        this.contentState.task,
        this.contentState.contentType,
        this.contentState.currentContent
      );

      // Store full content in external context store (NOT in messages)
      const { variableName } = contextStore.store(this.contentState.currentContent, name, {
        source: 'tool',
        variableBaseName: this.contentState.contentType,
      });

      // Framework-managed persistence: Auto-update project registry
      const persistResult = persistApprovedContent(
        this.contentState.contentType,
        name,
        this.contentState.currentContent,
        this.contentState.outputFile
      );

      const result = {
        status: 'approved',
        name,
        summary,
        content_ref: variableName,
        content_type: this.contentState.contentType,
        task: this.contentState.task,
        output_file: this.contentState.outputFile,
        file_saved: fileSaved,
        registry_updated: persistResult.persisted,
        registry_action: persistResult.action,
        iterations: this.contentState.iterations,
        message: fileSaved
          ? `${this.contentState.contentType} content "${name}" approved and saved to ${this.contentState.outputFile}. Summary: ${summary}`
          : `${this.contentState.contentType} content "${name}" approved. Summary: ${summary}`,
        next_steps: 'IMPORTANT: 1) Update the timeline using manage_timeline with update_segment. 2) Use TodoRead to check current todos. 3) Use TodoWrite(merge=true) to mark the completed task. 4) Continue with the next pending task.',
      };

      debugLog(
        `[GenericAgent] continueContentLoop auto-approved: ${JSON.stringify(
          {
            status: result.status,
            contentType: result.content_type,
            name: result.name,
            fileSaved: result.file_saved,
          },
          null,
          2
        )}`
      );

      this.contentState = null;
      this.currentMode = 'orchestrator';
      return result;
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
    const referenceImages = args['reference_images'] as
      | Array<{
          image_id: string;
          type: 'character' | 'setting';
          name: string;
        }>
      | undefined;

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
          debugLog(
            `[GenericAgent] Resolved context_ref ${ref} for image agent (${stored.label}, ${stored.content.length} chars)`
          );
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
        debugLog(
          `[GenericAgent] Resolved context_ref ${contextRef} for image agent (${stored.label}, ${stored.content.length} chars)`
        );
      } else {
        return { error: `Context reference not found: ${contextRef}` };
      }
    }

    // Warn about long inline context that should use context_ref
    if (context && context.length > 500 && !contextRef && !contextRefs) {
      debugLog(
        `[GenericAgent] WARNING: Long context (${context.length} chars) passed to dispatch_image_agent without context_ref. Consider using store_context.`
      );
    }

    // Check if we're resuming an existing session
    if (this.imageGenState?.active) {
      return { error: 'Image generation already in progress' };
    }

    // Determine generation mode based on image type and reference availability
    const isSceneImage = imageType === 'scene';
    const hasReferences = referenceImages && referenceImages.length > 0;

    // For scenes, always force image+text-to-image mode and require references
    const generationMode: 'text_to_image' | 'image_text_to_image' = isSceneImage
      ? 'image_text_to_image'
      : 'text_to_image';

    if (isSceneImage && !hasReferences) {
      return {
        error:
          'Scene images must include reference_images for all characters in the scene and the setting reference.',
        suggestion:
          'Gather approved character_ref and setting_ref images, then retry scene generation with reference_images included.',
        image_type: imageType,
      };
    }

    // Build enhanced context for image+text-to-image mode
    let enhancedContext = context ?? '';
    if (generationMode === 'image_text_to_image' && referenceImages) {
      const refDescriptions = referenceImages
        .map(
          ref =>
            `- ${ref.type === 'character' ? 'Character' : 'Setting'} "${ref.name}" (ref: ${ref.image_id})`
        )
        .join('\n');
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
        {
          role: 'user',
          content:
            '<request>\nPlease craft a detailed image generation prompt for this task.\n</request>',
        },
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
      const verificationQuestion =
        this.imageGenState.iterations === 1
          ? "I've crafted an image prompt. Would you like to generate the image or provide feedback?"
          : "I've updated the prompt based on your feedback. Would you like to generate the image or provide more feedback?";

      return {
        status: 'awaiting_prompt_approval',
        prompt: this.imageGenState.currentPrompt,
        negative_prompt: this.imageGenState.negativePrompt,
        aspect_ratio: this.imageGenState.aspectRatio,
        task: this.imageGenState.task,
        iterations: this.imageGenState.iterations,
        question: verificationQuestion,
        options: [
          {
            label: 'Generate image',
            description: 'Proceed with this prompt and generate the image',
          },
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
    const promptMatch = response.match(
      /\*\*Image Prompt:\*\*\s*\n([^\n*]+(?:\n(?!\*\*)[^\n*]+)*)/i
    );
    if (promptMatch?.[1]) {
      prompt = promptMatch[1].trim();
    }

    // Try to extract Negative Prompt section
    const negativeMatch = response.match(
      /\*\*Negative Prompt:\*\*\s*\n([^\n*]+(?:\n(?!\*\*)[^\n*]+)*)/i
    );
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
      prompt =
        response
          .replace(/\*\*[^*]+\*\*/g, '')
          .replace(/##[^\n]+\n/g, '')
          .trim()
          .split('\n')[0] || response.slice(0, 500);
    }

    return { prompt, negativePrompt, aspectRatio };
  }

  /**
   * Handle user response to image generation prompt approval.
   * Uses simple pattern matching to classify whether the response is approval or feedback.
   */
  async handleImageGenResponse(userResponse: string): Promise<unknown> {
    if (!this.imageGenState) {
      return { error: 'No active image generation session' };
    }

    // Classify user intent with simple pattern matching
    const isApproval = this.classifyImageGenResponse(userResponse);

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
   * Classify whether user response indicates approval or feedback for image generation.
   * Uses simple pattern matching - no LLM needed since options are predefined.
   */
  private classifyImageGenResponse(userResponse: string): boolean {
    // Simple string matching - no LLM needed since options are predefined
    const lower = userResponse.toLowerCase().trim();
    const approvalPatterns = [
      'generate image',
      'generate',
      'yes',
      'ok',
      'okay',
      'go',
      'create',
      'make',
      'proceed',
      'lgtm',
      'looks good',
      'go ahead',
      'y',
      '1',
    ];
    return approvalPatterns.some(p => lower === p || lower.startsWith(p));
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
      // generate_image now waits inline for ComfyUI completion
      const genResult = await Promise.resolve(generateImageTool.handler(generateArgs));
      const genResultObj = genResult as Record<string, unknown>;

      // Clear the state
      const finalState = { ...this.imageGenState };
      this.imageGenState = null;
      this.currentMode = 'orchestrator';

      const isError = genResultObj['status'] === 'error' || genResultObj['status'] === 'failed';

      this.emit({
        type: 'tool_result',
        toolCallId,
        toolName: 'generate_image',
        result: genResult,
        isError,
        agentName: this.getEffectiveAgentName(),
      });

      if (isError) {
        return {
          status: 'error',
          error: (genResultObj['error'] as string) || 'Image generation failed',
          prompt: finalState.currentPrompt,
          task: finalState.task,
          job_id: genResultObj['job_id'],
        };
      }

      return {
        status: 'completed',
        prompt: finalState.currentPrompt,
        negative_prompt: finalState.negativePrompt,
        aspect_ratio: finalState.aspectRatio,
        task: finalState.task,
        iterations: finalState.iterations,
        job_id: genResultObj['job_id'],
        artifact_id: genResultObj['artifact_id'],
        file_path: genResultObj['file_path'],
        message: 'Image generated successfully.',
        next_steps: 'IMPORTANT: 1) Update the timeline using manage_timeline with update_segment. 2) Use TodoRead to check current todos. 3) Use TodoWrite(merge=true) to mark the completed task. 4) Continue with the next pending task.',
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

    // scene_image_artifact_id is optional for stitching operations
    // But required for single scene video generation
    const isStitchOperation = task.toLowerCase().includes('stitch');
    if (!sceneImageArtifactId && !isStitchOperation) {
      this.currentMode = 'orchestrator';
      return { error: 'No scene_image_artifact_id provided for dispatch_video_agent' };
    }

    // Resolve context_refs (array) if provided - combines multiple contexts
    let context = '';
    if (contextRefs && contextRefs.length > 0) {
      const contextParts: string[] = [];
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push(`## ${ref} (${stored.label})\n\n${stored.content}`);
          debugLog(
            `[GenericAgent] Resolved context_ref ${ref} for video agent (${stored.label}, ${stored.content.length} chars)`
          );
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
        debugLog(
          `[GenericAgent] Resolved context_ref ${contextRef} for video agent (${stored.label}, ${stored.content.length} chars)`
        );
      } else {
        return { error: `Context reference not found: ${contextRef}` };
      }
    }

    // Check if we're already in a video generation session
    if (this.videoGenState?.active) {
      return { error: 'Video generation already in progress' };
    }

    // Initialize video gen state
    const currentParams = {
      duration,
      fps: 24,
      motionStrength: 0.7,
    };
    this.videoGenState = {
      active: true,
      task,
      sceneNumber,
      sceneImageArtifactId,
      motionDescription,
      context,
      messages: [],
      currentParams,
      iterations: 0,
    };

    // Build a summary for user approval
    const paramSummary = `**Video Generation Parameters:**
- Scene: #${sceneNumber}
- Source Image: ${sceneImageArtifactId ?? 'N/A (stitch operation)'}
- Duration: ${duration} seconds
- Motion: ${motionDescription ?? 'Auto-determined based on scene'}
- Task: ${task}`;

    // Return status indicating we need user approval
    return {
      status: 'awaiting_approval',
      params: currentParams,
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
    const approvalPatterns = [
      'yes',
      'ok',
      'okay',
      'generate',
      'go',
      'proceed',
      'create',
      'make',
      'lgtm',
      'y',
      '1',
    ];
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

    const { task, sceneNumber, sceneImageArtifactId, motionDescription, currentParams } =
      this.videoGenState;

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
      // generate_video now waits inline for ComfyUI completion
      const genResult = await Promise.resolve(generateVideoTool.handler(generateArgs));
      const genResultObj = genResult as Record<string, unknown>;

      // Clear the state
      const finalState = { ...this.videoGenState };
      this.videoGenState = null;
      this.currentMode = 'orchestrator';

      const isError = genResultObj['status'] === 'error' || genResultObj['status'] === 'failed';

      this.emit({
        type: 'tool_result',
        toolCallId,
        toolName: 'generate_video',
        result: genResult,
        isError,
        agentName: this.getEffectiveAgentName(),
      });

      if (isError) {
        return {
          status: 'error',
          error: (genResultObj['error'] as string) || 'Video generation failed',
          scene_number: finalState.sceneNumber,
          task: finalState.task,
          job_id: genResultObj['job_id'],
        };
      }

      return {
        status: 'completed',
        scene_number: finalState.sceneNumber,
        image_artifact_id: finalState.sceneImageArtifactId,
        params: finalState.currentParams,
        task: finalState.task,
        iterations: finalState.iterations,
        job_id: genResultObj['job_id'],
        artifact_id: genResultObj['artifact_id'],
        file_path: genResultObj['file_path'],
        message: 'Video generated successfully.',
        next_steps: 'IMPORTANT: 1) Update the timeline using manage_timeline with update_segment. 2) Use TodoRead to check current todos. 3) Use TodoWrite(merge=true) to mark the completed task. 4) Continue with the next pending task.',
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
      (args['question'] as string | undefined) ?? (args['prompt'] as string | undefined) ?? '';

    // Legacy-only fields (kept for back-compat)
    const isConfirmation = (args['is_confirmation'] as boolean | undefined) ?? false;
    const providedOptions = args['options'] as
      | Array<{ label: string; description?: string }>
      | string[]
      | undefined;
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
      normalizedOptions = hasOther
        ? opts
        : [...opts, { label: 'Other', description: 'Provide custom input' }];
    }

    // Use provided options or defaults (only for non-confirmation questions)
    const options = isConfirmation ? undefined : (normalizedOptions ?? DEFAULT_OPTIONS);
    // In autonomous mode, auto-approve immediately for ALL questions
    const autoApproveTimeoutMs = this.autonomousMode
      ? 0
      : (isConfirmation ? undefined : (providedTimeout ?? DEFAULT_AUTO_APPROVE_TIMEOUT_MS));

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
    debugLog(
      `[GenericAgent] ask_user emitting question: ${JSON.stringify(
        {
          question: question?.slice(0, 50),
          optionsCount: options?.length,
          options,
          isConfirmation,
          autoApproveTimeoutMs,
        },
        null,
        2
      )}`
    );
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
              const approved = approvalKeywords.some(kw => response.toLowerCase().includes(kw));

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
   * For main orchestrator, injects current project state automatically.
   */
  private buildSystemMessage(): string {
    // Load project state for main orchestrator (not sub-agents)
    let projectState: Record<string, unknown> | null = null;
    if (!this.isSubAgent) {
      const project = loadProject();
      if (project) {
        projectState = project as unknown as Record<string, unknown>;
      }
    }

    return buildSystemMessage(this.isSubAgent, this.tools, this.customPrompt, projectState);
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

    const reminderContent = parts.join('\n\n');

    // Merge reminder into the first system message to maintain compatibility
    // with LLMs (like Llama) that require a single system message at the start
    const firstMsg = this.messages[0];
    if (firstMsg && firstMsg.role === 'system') {
      const mergedSystem: Message = {
        role: 'system',
        content: (firstMsg.content ?? '') + '\n\n' + reminderContent,
      };
      return [mergedSystem, ...this.messages.slice(1)];
    }
    // If no system message exists, add reminder as system message at the start
    return [{ role: 'system', content: reminderContent }, ...this.messages];
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
        debugLog(
          `[GenericAgent] Context at ${Math.round((this.tokenUsage.lastPromptTokens / this.maxContextTokens) * 100)}% (${this.tokenUsage.lastPromptTokens}/${this.maxContextTokens} tokens) - compression needed`
        );
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
      debugLog(
        `[GenericAgent] Estimated context at ${Math.round((estimatedTotal / this.maxContextTokens) * 100)}% (~${estimatedTotal}/${this.maxContextTokens} tokens) - compression needed`
      );
      return true;
    }

    // Method 3: Safety net based on message count, but only if we don't have
    // reliable token-based data (Methods 1 & 2). With large context windows (128K+),
    // a fixed low threshold causes premature compression.
    // Scale threshold: ~20 messages per 16K of context, minimum 40.
    const MESSAGE_COUNT_THRESHOLD = Math.max(40, Math.round((this.maxContextTokens / 16000) * 20));
    if (this.tokenUsage.lastPromptTokens === 0 && this.messages.length > MESSAGE_COUNT_THRESHOLD) {
      debugLog(
        `[GenericAgent] Message count (${this.messages.length}) exceeds threshold (${MESSAGE_COUNT_THRESHOLD}) - compression needed`
      );
      return true;
    }

    return false;
  }

  /**
   * Handle dispatch_explore tool - spawns an explore agent to research documentation.
   * The explore agent reads relevant files in prompts/reference/ and returns a focused summary.
   */
  private async handleDispatchExplore(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const query =
      (args['query'] as string) || (args['task'] as string) || (args['prompt'] as string);

    if (!query) {
      return { error: 'No query provided for dispatch_explore' };
    }

    debugLog(`[GenericAgent] dispatch_explore: query="${query.substring(0, 100)}..."`);

    try {
      // Build the explore agent prompt
      const explorePrompt = buildExplorePrompt(query);

      // Get read_file tool for the explore agent
      const { readFileTool, readProjectTool } =
        await import('../tools/builtin/contentCreatorTools.js');
      const { thinkTool } = await import('../tools/builtin/think.js');

      // Run the explore sub-agent
      const result = await this.runSubAgent({
        name: 'Explore Agent',
        tools: [readFileTool, readProjectTool, thinkTool],
        prompt: explorePrompt,
        task: `Research and summarize guidance for: ${query}`,
        maxIterations: 15, // Allow multiple file reads
        parentToolCallId: toolCall.id,
      });

      debugLog(`[GenericAgent] dispatch_explore completed: ${result.status}`);

      return {
        status: 'completed',
        query,
        summary: result.output || 'No summary generated',
        message: 'Explore agent completed documentation research.',
      };
    } catch (error) {
      debugLog(`[GenericAgent] dispatch_explore error: ${String(error)}`);
      return {
        status: 'error',
        error: String(error),
        query,
      };
    }
  }

  /**
   * Handle dispatch_skill tool - spawns a skill agent for specialized creative work.
   * Skill agents are autonomous and understand their domain.
   */
  private async handleDispatchSkill(toolCall: ToolCall): Promise<unknown> {
    const args = toolCall.arguments;
    const skillName = (args['skill_name'] as SkillType) || (args['skill'] as SkillType);
    const task =
      (args['task'] as string) || (args['instruction'] as string) || (args['prompt'] as string);
    const contextRef = args['context_ref'] as string | undefined;
    const contextRefs = args['context_refs'] as string[] | undefined;

    if (!skillName) {
      return { error: 'No skill_name provided for dispatch_skill' };
    }

    if (!task) {
      return { error: 'No task provided for dispatch_skill' };
    }

    // Validate skill name
    const validSkills: SkillType[] = [
      'content-writing',
      'image-prompting',
      'video-direction',
      'research-synthesis',
      'narration-scripting',
    ];
    if (!validSkills.includes(skillName)) {
      return { error: `Invalid skill_name: ${skillName}. Valid skills: ${validSkills.join(', ')}` };
    }

    debugLog(
      `[GenericAgent] dispatch_skill: skill="${skillName}", task="${task.substring(0, 100)}..."`
    );

    // Resolve context from context store
    let context = '';
    if (contextRefs && contextRefs.length > 0) {
      const contextParts: string[] = [];
      for (const ref of contextRefs) {
        const stored = contextStore.get(ref);
        if (stored) {
          contextParts.push(`## ${ref} (${stored.label})\n\n${stored.content}`);
        }
      }
      context = contextParts.join('\n\n---\n\n');
    } else if (contextRef) {
      const stored = contextStore.get(contextRef);
      if (stored) {
        context = stored.content;
      }
    }

    try {
      // Build the skill agent prompt
      const skillPrompt = buildSkillPrompt(skillName, task, context || undefined);

      // Get tools appropriate for the skill
      const { readFileTool, readProjectTool } =
        await import('../tools/builtin/contentCreatorTools.js');
      const { thinkTool } = await import('../tools/builtin/think.js');

      // Base tools available to all skills
      const skillTools = [readFileTool, readProjectTool, thinkTool];

      // Run the skill sub-agent
      const result = await this.runSubAgent({
        name: `${skillName} Skill`,
        tools: skillTools,
        prompt: skillPrompt,
        task,
        maxIterations: 10,
        parentToolCallId: toolCall.id,
      });

      debugLog(
        `[GenericAgent] dispatch_skill completed: skill="${skillName}", status=${result.status}`
      );

      return {
        status: 'completed',
        skill: skillName,
        task,
        output: result.output || 'No output generated',
        message: `${skillName} skill completed successfully.`,
      };
    } catch (error) {
      debugLog(`[GenericAgent] dispatch_skill error: ${String(error)}`);
      return {
        status: 'error',
        error: String(error),
        skill: skillName,
        task,
      };
    }
  }

  /**
   * Compress conversation history when context approaches limit.
   * Uses LLM to summarize old messages while preserving system + recent.
   */
  private async compressConversationHistory(): Promise<void> {
    const { compressMessages, SUMMARIZER_SYSTEM_PROMPT } =
      await import('../context/MessageCompressor.js');

    debugLog(
      `[GenericAgent] Starting context compression. Current messages: ${this.messages.length}`
    );

    const result = await compressMessages(this.messages, async content => {
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
      debugLog(
        `[GenericAgent] Compressed ${result.removedCount} messages. New count: ${this.messages.length}`
      );

      // Log compression with phase context
      phaseLogger.info('GenericAgent', 'context_compression', 'Conversation history compressed', {
        removedCount: result.removedCount,
        newMessageCount: this.messages.length,
        maxContextTokens: this.maxContextTokens,
      });

      // Emit notification so UI can show compression occurred
      this.emit({
        type: 'notification',
        level: 'info',
        message: `Context compressed: ${result.removedCount} messages summarized to stay within limits`,
      });

      // Emit context usage event showing post-compression state
      this.emit({
        type: 'context_usage',
        promptTokens: this.tokenUsage.lastPromptTokens,
        maxTokens: this.maxContextTokens,
        percentage: this.tokenUsage.lastPromptTokens > 0
          ? Math.round((this.tokenUsage.lastPromptTokens / this.maxContextTokens) * 100)
          : 0,
        wasCompressed: true,
        iteration: this.iteration,
      });
    }
  }

  /**
   * Save a periodic checkpoint of project state during long-running sessions.
   */
  private performCheckpoint(): void {
    try {
      if (!projectExists()) return;
      const project = loadProject();
      if (!project) return;

      project.lastCheckpointAt = Date.now();
      project.updatedAt = Date.now();
      saveProject(project);
      saveTodos(this.todoManager.getTodos());

      this.lastCheckpointAt = Date.now();
      this.emit({
        type: 'notification',
        level: 'info',
        message: 'Checkpoint saved',
      });
      debugLog('[GenericAgent] Checkpoint saved');
    } catch (err) {
      debugLog(`[GenericAgent] Checkpoint failed: ${err}`);
    }
  }
}

// Re-export tool categories for external use
export { SIMPLE_TOOLS, COMPLEX_TOOLS, isComplexTool };

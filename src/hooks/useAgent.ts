/**
 * Hook for managing agent lifecycle.
 * Optimized to reduce re-renders and flickering.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { type AgentConfig, type GenericAgentResult } from '../core/agent/index.js';
import { LLMClient, type LLMClientConfig, type ToolDefinition } from '../core/llm/index.js';
import type { TypedEventEmitter } from '../events/EventEmitter.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';
import type { AgentEvent } from '../events/index.js';

// Debug logging to file
const DEBUG_LOG_PATH = path.join(process.cwd(), 'logs', 'debug.log');

/**
 * Reset the debug log file (called on CLI start).
 */
export function resetDebugLog(): void {
  try {
    const dir = path.dirname(DEBUG_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const header = `=== Debug Log Started [${new Date().toISOString()}] ===\n`;
    fs.writeFileSync(DEBUG_LOG_PATH, header);
  } catch {
    // Ignore errors
  }
}

function debugLog(message: string) {
  try {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(DEBUG_LOG_PATH, logLine);
  } catch {
    // Ignore logging errors
  }
}

type AgentStatus = 'idle' | 'thinking' | 'waiting' | 'completed' | 'error';

/**
 * Common interface for agents that can be used with useAgent.
 * Both GenericAgent and ExecutorAgent satisfy this.
 */
interface AgentLike extends TypedEventEmitter {
  initialize(): Promise<void>;
  run(task: string, userResponse?: string): Promise<GenericAgentResult>;
  stop(): void;
  isRunning(): boolean;
  getToolNames(): string[];
  setAutonomousMode(enabled: boolean): void;
  injectInput?(input: string): void;
}

interface UseAgentOptions {
  tools: Map<string, ToolDefinition>;
  llmConfig?: LLMClientConfig;
  agentConfig?: AgentConfig;
  onEvent?: (event: AgentEvent) => void;
  /** Pre-built agent to use instead of creating a GenericAgent */
  prebuiltAgent?: AgentLike;
}

export interface ToolCallHistoryItem {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error';
  result?: unknown;
  startTime: number;
  endTime?: number;
  duration?: number;
  /** Name of the agent that invoked this tool */
  agentName?: string;
  /** Streaming content being accumulated for this tool (for sub-agent loops) */
  streamingContent?: string;
}

/**
 * A history entry representing something that already happened (permanent).
 */
export interface HistoryEntry {
  id: string;
  type: 'user_input' | 'agent_text' | 'tool_completed' | 'error' | 'phase_transition' | 'thinking' | 'question';
  content: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  duration?: number;
  /** Name of the agent that performed this action (e.g., "Orchestrator", "Content Agent") */
  agentName?: string;
  /** Streaming content that was generated during this tool call */
  streamingContent?: string;
  /** Whether streaming content was already shown live (to avoid duplicate display) */
  wasStreamed?: boolean;
  /** For phase_transition entries: the phase being entered */
  phaseName?: string;
  /** For phase_transition entries: human-readable phase name */
  phaseDisplayName?: string;
  /** For phase_transition entries: description of the phase */
  phaseDescription?: string;
  /** For question entries: the options that were presented */
  questionOptions?: QuestionOption[];
  /** For question entries: whether it was a yes/no confirmation */
  isConfirmation?: boolean;
}

/**
 * Current action - the single thing the agent is doing right now (ephemeral).
 * Stays visible after completion until next action starts or agent finishes.
 */
export interface CurrentAction {
  type: 'thinking' | 'tool_executing' | 'tool_completed';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  startTime: number;
  /** Name of the agent performing this action */
  agentName?: string;
  /** For completed tools: the result */
  result?: unknown;
  /** For completed tools: whether it was an error */
  isError?: boolean;
  /** For completed tools: duration in ms */
  duration?: number;
  /** For completed tools: streaming content that was displayed */
  streamingContent?: string;
}

/**
 * Option for multiple choice questions.
 */
export interface QuestionOption {
  label: string;
  description?: string;
}

/** Context usage info for UI display */
export interface ContextUsageInfo {
  promptTokens: number;
  maxTokens: number;
  percentage: number;
  wasCompressed: boolean;
  iteration: number;
}

interface AgentState {
  status: AgentStatus;
  todos: ExpandableTodoItem[];
  output: string;
  /** Current streaming text being accumulated */
  streamingText: string;
  /** Whether streaming is in progress */
  isStreaming: boolean;
  /** Current streaming think text being accumulated (for implicit LLM thinking) */
  streamingThinkText: string;
  /** Whether think streaming is in progress */
  isThinkStreaming: boolean;
  question: string | undefined;
  isConfirmation: boolean;
  questionOptions: QuestionOption[] | undefined;
  /** Auto-approve timeout in milliseconds (for countdown display) */
  autoApproveTimeoutMs: number | undefined;
  /** Context content to display with the question (e.g., image prompt being approved) */
  questionContext: string | undefined;
  error: string | undefined;
  recentTools: ToolCallHistoryItem[];
  history: HistoryEntry[];
  currentAction: CurrentAction | null;
  /** Current agent name (for tracking across streaming) */
  currentAgentName: string | undefined;
  /** Context window usage info */
  contextUsage: ContextUsageInfo | null;
  /** Notification message to display briefly */
  notification: string | null;
}

type AgentAction =
  | { type: 'SET_STATUS'; status: AgentStatus; agentName?: string }
  | { type: 'SET_TODOS'; todos: ExpandableTodoItem[] }
  | { type: 'APPEND_OUTPUT'; text: string }
  | { type: 'SET_QUESTION'; question: string; isConfirmation: boolean; options?: QuestionOption[]; autoApproveTimeoutMs?: number; context?: string }
  | { type: 'CLEAR_QUESTION' }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'TOOL_START'; toolCallId: string; toolName: string; args?: Record<string, unknown>; agentName?: string }
  | { type: 'TOOL_COMPLETE'; toolCallId: string; result: unknown; isError: boolean; agentName?: string }
  | { type: 'TOOL_STREAM'; toolCallId: string; chunk: string; done: boolean; reset?: boolean; toolName?: string; toolArgs?: Record<string, unknown>; agentName?: string }
  | { type: 'ADD_AGENT_TEXT'; text: string; agentName?: string }
  | { type: 'ADD_USER_INPUT'; text: string; isTask?: boolean }
  | { type: 'STREAM_CHUNK'; chunk: string; agentName?: string }
  | { type: 'STREAM_DONE'; skipHistory?: boolean; agentName?: string }
  | { type: 'THINK_CHUNK'; chunk: string }
  | { type: 'THINK_DONE' }
  | { type: 'SET_THINKING'; agentName?: string }
  | { type: 'CLEAR_CURRENT_ACTION' }
  | { type: 'RESET' }
  | { type: 'START_TASK'; task: string }
  | { type: 'ADD_PHASE_TRANSITION'; fromPhase: string; toPhase: string; displayName?: string; description?: string }
  | { type: 'SET_CONTEXT_USAGE'; usage: ContextUsageInfo }
  | { type: 'SET_NOTIFICATION'; message: string }
  | { type: 'CLEAR_NOTIFICATION' };

const MAX_VISIBLE_TOOLS = 15;
const MAX_HISTORY = 500; // Keep more history for scrolling

const initialState: AgentState = {
  status: 'idle',
  todos: [],
  output: '',
  streamingText: '',
  isStreaming: false,
  streamingThinkText: '',
  isThinkStreaming: false,
  question: undefined,
  isConfirmation: false,
  questionOptions: undefined,
  autoApproveTimeoutMs: undefined,
  questionContext: undefined,
  error: undefined,
  recentTools: [],
  history: [],
  currentAction: null,
  currentAgentName: undefined,
  contextUsage: null,
  notification: null,
};

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.status };

    case 'SET_TODOS':
      debugLog(`[useAgent] SET_TODOS: updating from ${state.todos.length} to ${action.todos.length} todos`);
      return { ...state, todos: action.todos };

    case 'APPEND_OUTPUT':
      return {
        ...state,
        output: state.output ? `${state.output}\n\n${action.text}` : action.text,
      };

    case 'SET_QUESTION':
      return {
        ...state,
        question: action.question,
        isConfirmation: action.isConfirmation,
        questionOptions: action.options,
        autoApproveTimeoutMs: action.autoApproveTimeoutMs,
        questionContext: action.context,
        status: 'waiting',
        currentAction: null,
      };

    case 'CLEAR_QUESTION':
      return { ...state, question: undefined, isConfirmation: false, questionOptions: undefined, autoApproveTimeoutMs: undefined, questionContext: undefined };

    case 'SET_ERROR':
      return { ...state, error: action.error, status: 'error', currentAction: null };

    case 'SET_THINKING': {
      // If there's a completed tool action, move it to history first
      let newHistory = state.history;
      const ca = state.currentAction;
      if (ca?.type === 'tool_completed' && ca.toolName && ca.toolCallId) {
        const historyEntry: HistoryEntry = {
          id: `tool-${ca.toolCallId}`,
          type: 'tool_completed',
          content: ca.toolName,
          timestamp: Date.now(),
          toolName: ca.toolName,
          toolArgs: ca.toolArgs,
          toolResult: ca.result,
          duration: ca.duration,
          agentName: ca.agentName,
          streamingContent: ca.streamingContent,
          wasStreamed: !!ca.streamingContent,
        };
        newHistory = [...state.history.slice(-MAX_HISTORY + 1), historyEntry];
      }
      return {
        ...state,
        status: 'thinking',
        currentAction: { type: 'thinking', startTime: Date.now(), agentName: action.agentName },
        currentAgentName: action.agentName ?? state.currentAgentName,
        history: newHistory,
      };
    }

    case 'TOOL_START': {
      const startTime = Date.now();
      const agentName = action.agentName ?? state.currentAgentName;
      const newTool: ToolCallHistoryItem = {
        id: action.toolCallId,
        name: action.toolName,
        args: action.args,
        status: 'executing',
        startTime,
        agentName,
      };

      // If there's a completed tool action, move it to history first
      let newHistory = state.history;
      const ca = state.currentAction;
      if (ca?.type === 'tool_completed' && ca.toolName && ca.toolCallId) {
        const historyEntry: HistoryEntry = {
          id: `tool-${ca.toolCallId}`,
          type: 'tool_completed',
          content: ca.toolName,
          timestamp: Date.now(),
          toolName: ca.toolName,
          toolArgs: ca.toolArgs,
          toolResult: ca.result,
          duration: ca.duration,
          agentName: ca.agentName,
          streamingContent: ca.streamingContent,
          wasStreamed: !!ca.streamingContent,
        };
        newHistory = [...state.history.slice(-MAX_HISTORY + 1), historyEntry];
      }

      return {
        ...state,
        currentAction: {
          type: 'tool_executing',
          toolName: action.toolName,
          toolArgs: action.args,
          toolCallId: action.toolCallId,
          startTime,
          agentName,
        },
        recentTools: [...state.recentTools.slice(-(MAX_VISIBLE_TOOLS - 1)), newTool],
        currentAgentName: agentName,
        history: newHistory,
      };
    }

    case 'TOOL_COMPLETE': {
      const endTime = Date.now();
      const tool = state.recentTools.find(t => t.id === action.toolCallId);
      const duration = tool ? endTime - tool.startTime : 0;
      const agentName = action.agentName ?? tool?.agentName ?? state.currentAgentName;

      // Don't add to history yet - keep in currentAction until next action starts
      // This allows the same box to update in-place (Running → Ran)
      // The history entry will be created when the next action starts (in TOOL_START or SET_THINKING)

      // Update currentAction to show completed state (same box, different status)
      const completedAction: CurrentAction | null = tool ? {
        type: 'tool_completed',
        toolName: tool.name,
        toolArgs: tool.args,
        toolCallId: action.toolCallId,
        startTime: tool.startTime,
        agentName,
        result: action.result,
        isError: action.isError,
        duration,
        streamingContent: tool.streamingContent,
      } : null;

      return {
        ...state,
        currentAction: completedAction,
        recentTools: state.recentTools.map(t =>
          t.id === action.toolCallId
            ? { ...t, status: action.isError ? 'error' : 'completed', result: action.result, endTime, duration }
            : t
        ),
        // Don't add to history here - will be added when next action starts
      };
    }

    case 'TOOL_STREAM': {
      // Update streaming content for a specific tool
      const targetTool = state.recentTools.find(t => t.id === action.toolCallId);

      // If reset flag is set, clear existing content before appending (used when regenerating after feedback)
      const baseContent = action.reset ? '' : (targetTool?.streamingContent ?? '');
      const newStreamingContent = baseContent + action.chunk;

      debugLog(`[useAgent] TOOL_STREAM: toolCallId=${action.toolCallId}, chunk=${action.chunk.length} chars, done=${action.done}, reset=${action.reset}, newTotal=${newStreamingContent.length} chars, toolFound=${!!targetTool}`);
      if (!targetTool) {
        debugLog(`[useAgent] TOOL_STREAM WARNING: tool not found in recentTools. Available tools: ${state.recentTools.map(t => t.id).join(', ')}`);
      }

      // If reset flag is set, also update currentAction to show the tool executing
      // This ensures the ToolCallDisplay is shown after feedback
      const newCurrentAction = action.reset && targetTool ? {
        type: 'tool_executing' as const,
        toolCallId: action.toolCallId,
        toolName: action.toolName ?? targetTool.name,
        toolArgs: action.toolArgs ?? targetTool.args,
        agentName: action.agentName ?? targetTool.agentName,
        startTime: targetTool.startTime,
      } : state.currentAction;

      return {
        ...state,
        currentAction: newCurrentAction,
        recentTools: state.recentTools.map(t =>
          t.id === action.toolCallId
            ? { ...t, streamingContent: newStreamingContent }
            : t
        ),
      };
    }

    case 'ADD_AGENT_TEXT': {
      const agentName = action.agentName ?? state.currentAgentName;
      return {
        ...state,
        output: state.output ? `${state.output}\n\n${action.text}` : action.text,
        history: [
          ...state.history.slice(-MAX_HISTORY + 1),
          {
            id: `text-${Date.now()}`,
            type: 'agent_text',
            content: action.text,
            timestamp: Date.now(),
            agentName,
          },
        ],
        currentAgentName: agentName,
      };
    }

    case 'ADD_USER_INPUT': {
      // If there's an active question, persist it to history before the user's answer
      const newEntries: HistoryEntry[] = [];
      if (state.question) {
        newEntries.push({
          id: `question-${Date.now()}`,
          type: 'question',
          content: state.question,
          timestamp: Date.now(),
          questionOptions: state.questionOptions,
          isConfirmation: state.isConfirmation,
        });
      }
      newEntries.push({
        id: `user-${Date.now()}`,
        type: 'user_input',
        content: action.text,
        timestamp: Date.now(),
      });
      return {
        ...state,
        history: [
          ...state.history.slice(-MAX_HISTORY + newEntries.length),
          ...newEntries,
        ],
      };
    }

    case 'STREAM_CHUNK':
      debugLog(`[useAgent] STREAM_CHUNK: chunk=${action.chunk.length} chars, newTotal=${(state.streamingText + action.chunk).length} chars`);
      return {
        ...state,
        streamingText: state.streamingText + action.chunk,
        isStreaming: true,
        // Keep thinking text visible alongside regular streaming
        currentAgentName: action.agentName ?? state.currentAgentName,
      };

    case 'STREAM_DONE': {
      // Move completed streaming text to history if there's content
      const finalText = state.streamingText.trim();
      const agentName = action.agentName ?? state.currentAgentName;
      debugLog(`[useAgent] STREAM_DONE: finalText=${finalText.length} chars, skipHistory=${action.skipHistory}, addToHistory=${!!(finalText && !action.skipHistory)}`);
      if (finalText) {
        debugLog(`[useAgent] STREAM_DONE content preview: "${finalText.slice(0, 200)}${finalText.length > 200 ? '...' : ''}"`);
      }
      if (!finalText || action.skipHistory) {
        // Either no content or skipHistory flag set (e.g., plan shown via ToolCallDisplay)
        debugLog(`[useAgent] STREAM_DONE: skipping history (no content or skipHistory flag)`);
        return {
          ...state,
          streamingText: '',
          isStreaming: false,
        };
      }
      debugLog(`[useAgent] STREAM_DONE: adding to history with agentName=${agentName}`);
      return {
        ...state,
        streamingText: '',
        isStreaming: false,
        output: state.output ? `${state.output}\n\n${finalText}` : finalText,
        history: [
          ...state.history.slice(-MAX_HISTORY + 1),
          {
            id: `text-${Date.now()}`,
            type: 'agent_text',
            content: finalText,
            timestamp: Date.now(),
            agentName,
          },
        ],
      };
    }

    case 'THINK_CHUNK': {
      // Append thinking content from implicit LLM thinking (e.g., DeepSeek <think> tags)
      // If this is a new thinking session (wasn't streaming before), start fresh
      const isNewSession = !state.isThinkStreaming;
      const baseText = isNewSession ? '' : state.streamingThinkText;
      debugLog(`[useAgent] THINK_CHUNK: chunk=${action.chunk.length} chars, newSession=${isNewSession}, newTotal=${(baseText + action.chunk).length} chars`);
      return {
        ...state,
        streamingThinkText: baseText + action.chunk,
        isThinkStreaming: true,
      };
    }

    case 'THINK_DONE': {
      // Add completed thinking to history so it persists, then clear streaming state
      const thinkText = state.streamingThinkText.trim();
      debugLog(`[useAgent] THINK_DONE: finalThinkText=${thinkText.length} chars - adding to history`);
      if (!thinkText) {
        return {
          ...state,
          streamingThinkText: '',
          isThinkStreaming: false,
        };
      }
      return {
        ...state,
        streamingThinkText: '',
        isThinkStreaming: false,
        history: [
          ...state.history.slice(-MAX_HISTORY + 1),
          {
            id: `think-${Date.now()}`,
            type: 'thinking',
            content: thinkText,
            timestamp: Date.now(),
            agentName: state.currentAgentName,
          },
        ],
      };
    }

    case 'CLEAR_CURRENT_ACTION': {
      // If there's a completed tool action, move it to history first
      let newHistory = state.history;
      const ca = state.currentAction;
      if (ca?.type === 'tool_completed' && ca.toolName && ca.toolCallId) {
        const historyEntry: HistoryEntry = {
          id: `tool-${ca.toolCallId}`,
          type: 'tool_completed',
          content: ca.toolName,
          timestamp: Date.now(),
          toolName: ca.toolName,
          toolArgs: ca.toolArgs,
          toolResult: ca.result,
          duration: ca.duration,
          agentName: ca.agentName,
          streamingContent: ca.streamingContent,
          wasStreamed: !!ca.streamingContent,
        };
        newHistory = [...state.history.slice(-MAX_HISTORY + 1), historyEntry];
      }
      // Keep thinking text visible - will be cleared on next task or new streaming
      return { ...state, currentAction: null, history: newHistory };
    }

    case 'START_TASK':
      return {
        ...state,
        status: 'thinking',
        error: undefined,
        question: undefined,
        isConfirmation: false,
        output: '',
        streamingText: '',
        isStreaming: false,
        streamingThinkText: '',
        isThinkStreaming: false,
        currentAction: { type: 'thinking', startTime: Date.now() },
        // Add the task to history
        history: [
          ...state.history.slice(-MAX_HISTORY + 1),
          {
            id: `task-${Date.now()}`,
            type: 'user_input',
            content: action.task,
            timestamp: Date.now(),
          },
        ],
      };

    case 'RESET':
      return initialState;

    case 'ADD_PHASE_TRANSITION':
      return {
        ...state,
        history: [
          ...state.history.slice(-MAX_HISTORY + 1),
          {
            id: `phase-${Date.now()}`,
            type: 'phase_transition',
            content: `${action.fromPhase} → ${action.toPhase}`,
            timestamp: Date.now(),
            phaseName: action.toPhase,
            phaseDisplayName: action.displayName,
            phaseDescription: action.description,
          },
        ],
      };

    case 'SET_CONTEXT_USAGE':
      return { ...state, contextUsage: action.usage };

    case 'SET_NOTIFICATION':
      return { ...state, notification: action.message };

    case 'CLEAR_NOTIFICATION':
      return { ...state, notification: null };

    default:
      return state;
  }
}

interface UseAgentReturn {
  status: AgentStatus;
  todos: ExpandableTodoItem[];
  output: string;
  streamingText: string;
  isStreaming: boolean;
  /** Streaming think text from implicit LLM thinking (e.g., DeepSeek <think> tags) */
  streamingThinkText: string;
  /** Whether think streaming is in progress */
  isThinkStreaming: boolean;
  question: string | undefined;
  isConfirmation: boolean;
  questionOptions: QuestionOption[] | undefined;
  autoApproveTimeoutMs: number | undefined;
  /** Context content to display with the question (e.g., image prompt being approved) */
  questionContext: string | undefined;
  error: string | undefined;
  recentTools: ToolCallHistoryItem[];
  history: HistoryEntry[];
  currentAction: CurrentAction | null;
  /** Context window usage info */
  contextUsage: ContextUsageInfo | null;
  /** Notification message (e.g., context compression) */
  notification: string | null;
  run: (task: string) => Promise<GenericAgentResult>;
  respond: (userInput: string) => Promise<GenericAgentResult>;
  reset: () => void;
  stop: () => void;
  injectInput: (input: string) => void;
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { tools, llmConfig, agentConfig, onEvent, prebuiltAgent } = options;

  const [state, dispatch] = React.useReducer(agentReducer, initialState);
  const agentRef = React.useRef<AgentLike | null>(null);
  const llmRef = React.useRef<LLMClient | null>(null);

  // Initialize LLM client
  const getLLM = React.useCallback(() => {
    if (!llmRef.current) {
      llmRef.current = new LLMClient(llmConfig);
    }
    return llmRef.current;
  }, [llmConfig]);

  // Create agent
  const createAgent = React.useCallback(() => {
    if (!prebuiltAgent) {
      throw new Error('useAgent now requires `prebuiltAgent` (an ExecutorAgent). The legacy GenericAgent fallback was removed in the graph-as-source-of-truth refactor.');
    }
    const agent: AgentLike = prebuiltAgent;

    // Subscribe to events
    agent.on('agent_status', event => {
      switch (event.status) {
        case 'started':
        case 'thinking':
          dispatch({ type: 'SET_THINKING', agentName: event.agentName });
          break;
        case 'waiting':
          // Question event will handle this
          break;
        case 'completed':
          dispatch({ type: 'SET_STATUS', status: 'completed', agentName: event.agentName });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
        case 'error':
          dispatch({ type: 'SET_STATUS', status: 'error', agentName: event.agentName });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
        case 'interrupted':
          dispatch({ type: 'SET_STATUS', status: 'idle', agentName: event.agentName });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
      }
      onEvent?.(event);
    });

    agent.on('todo_update', event => {
      debugLog(`[useAgent] todo_update event received: ${event.todos.length} todos`);
      dispatch({ type: 'SET_TODOS', todos: event.todos });
      onEvent?.(event);
    });

    agent.on('agent_text', event => {
      if (event.isFinal) return; // Already in history via streaming STREAM_DONE
      if (event.text) {
        dispatch({ type: 'ADD_AGENT_TEXT', text: event.text });
      }
      onEvent?.(event);
    });

    agent.on('streaming_text', event => {
      debugLog(`[useAgent] streaming_text event: done=${event.done}, chunkLen=${event.chunk?.length ?? 0}, skipHistory=${event.skipHistory}`);
      if (event.done) {
        dispatch({ type: 'STREAM_DONE', skipHistory: event.skipHistory });
      } else if (event.chunk) {
        dispatch({ type: 'STREAM_CHUNK', chunk: event.chunk });
      }
      onEvent?.(event);
    });

    agent.on('streaming_think', event => {
      debugLog(`[useAgent] streaming_think event: done=${event.done}, chunkLen=${event.chunk?.length ?? 0}`);
      if (event.done) {
        dispatch({ type: 'THINK_DONE' });
      } else if (event.chunk) {
        dispatch({ type: 'THINK_CHUNK', chunk: event.chunk });
      }
      onEvent?.(event);
    });

    agent.on('question', event => {
      debugLog(`[useAgent] Question event received: ${JSON.stringify({
        question: event.question?.slice(0, 50),
        optionsCount: event.options?.length,
        options: event.options,
        isConfirmation: event.isConfirmation,
        autoApproveTimeoutMs: event.autoApproveTimeoutMs,
        hasContext: !!event.context,
      }, null, 2)}`);
      dispatch({
        type: 'SET_QUESTION',
        question: event.question,
        isConfirmation: event.isConfirmation,
        options: event.options,
        autoApproveTimeoutMs: event.autoApproveTimeoutMs,
        context: event.context,
      });
      onEvent?.(event);
    });

    agent.on('tool_call', event => {
      dispatch({
        type: 'TOOL_START',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.arguments,
        agentName: event.agentName,
      });
      onEvent?.(event);
    });

    agent.on('tool_result', event => {
      dispatch({
        type: 'TOOL_COMPLETE',
        toolCallId: event.toolCallId,
        result: event.result,
        isError: event.isError ?? false,
        agentName: event.agentName,
      });
      onEvent?.(event);
    });

    agent.on('tool_streaming', event => {
      debugLog(`[useAgent] tool_streaming event: toolCallId=${event.toolCallId}, chunkLen=${event.chunk.length}, done=${event.done}, reset=${event.reset}`);
      dispatch({
        type: 'TOOL_STREAM',
        toolCallId: event.toolCallId,
        chunk: event.chunk,
        done: event.done,
        reset: event.reset,
        toolName: event.toolName,
        toolArgs: event.toolArgs,
        agentName: event.agentName,
      });
      onEvent?.(event);
    });

    agent.on('phase_transition', event => {
      debugLog(`[useAgent] phase_transition event: ${event.fromPhase} → ${event.toPhase}`);
      dispatch({
        type: 'ADD_PHASE_TRANSITION',
        fromPhase: event.fromPhase,
        toPhase: event.toPhase,
        displayName: event.displayName,
        description: event.description,
      });
      onEvent?.(event);
    });

    agent.on('context_usage', event => {
      debugLog(`[useAgent] context_usage event: prompt=${event.promptTokens}, completion=${event.completionTokens ?? 'n/a'}, total=${event.totalTokens ?? 'n/a'}`);
      if (typeof event.percentage === 'number' && typeof event.maxTokens === 'number') {
        dispatch({
          type: 'SET_CONTEXT_USAGE',
          usage: {
            promptTokens: event.promptTokens,
            maxTokens: event.maxTokens,
            percentage: event.percentage,
            wasCompressed: event.wasCompressed ?? false,
            iteration: event.iteration ?? 0,
          },
        });
      }
      onEvent?.(event);
    });

    agent.on('notification', event => {
      debugLog(`[useAgent] notification event: [${event.level}] ${event.message}`);
      dispatch({ type: 'SET_NOTIFICATION', message: event.message });
      // Auto-clear notification after 8 seconds
      setTimeout(() => {
        dispatch({ type: 'CLEAR_NOTIFICATION' });
      }, 8000);
      onEvent?.(event);
    });

    agentRef.current = agent;
    return agent;
  }, [tools, agentConfig, getLLM, onEvent, prebuiltAgent]);

  // Run agent on a task
  const run = React.useCallback(
    async (task: string): Promise<GenericAgentResult> => {
      dispatch({ type: 'START_TASK', task });

      const agent = createAgent();

      try {
        // Initialize agent (queries model context length, validates requirements)
        await agent.initialize();

        const result = await agent.run(task);

        dispatch({ type: 'SET_TODOS', todos: result.todos });

        if (result.status === 'waiting_for_user') {
          dispatch({
            type: 'SET_QUESTION',
            question: result.pendingQuestion ?? '',
            isConfirmation: result.isConfirmation ?? false,
            options: result.options,
            autoApproveTimeoutMs: result.autoApproveTimeoutMs,
            context: result.questionContext,
          });
        } else if (result.status === 'completed') {
          dispatch({ type: 'SET_STATUS', status: 'completed' });
        } else if (result.status === 'error' || result.status === 'interrupted') {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Unknown error' });
        }

        return result;
      } catch (err) {
        dispatch({ type: 'SET_ERROR', error: String(err) });
        return {
          status: 'error',
          output: '',
          todos: [],
          error: String(err),
        };
      }
    },
    [createAgent]
  );

  // Respond to agent question
  const respond = React.useCallback(
    async (userInput: string): Promise<GenericAgentResult> => {
      if (!agentRef.current) {
        return {
          status: 'error',
          output: '',
          todos: [],
          error: 'No agent running',
        };
      }

      // Add user response to history (reducer will also persist the question if one is active)
      dispatch({ type: 'ADD_USER_INPUT', text: userInput });
      dispatch({ type: 'SET_THINKING' });
      dispatch({ type: 'CLEAR_QUESTION' });

      try {
        const result = await agentRef.current.run('', userInput);

        dispatch({ type: 'SET_TODOS', todos: result.todos });

        if (result.status === 'waiting_for_user') {
          dispatch({
            type: 'SET_QUESTION',
            question: result.pendingQuestion ?? '',
            isConfirmation: result.isConfirmation ?? false,
            options: result.options,
            autoApproveTimeoutMs: result.autoApproveTimeoutMs,
            context: result.questionContext,
          });
        } else if (result.status === 'completed') {
          dispatch({ type: 'SET_STATUS', status: 'completed' });
        } else if (result.status === 'error' || result.status === 'interrupted') {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Unknown error' });
        }

        return result;
      } catch (err) {
        dispatch({ type: 'SET_ERROR', error: String(err) });
        return {
          status: 'error',
          output: '',
          todos: [],
          error: String(err),
        };
      }
    },
    []
  );

  // Reset agent state
  const reset = React.useCallback(() => {
    agentRef.current = null;
    dispatch({ type: 'RESET' });
  }, []);

  // Stop agent execution (preserves context)
  const stop = React.useCallback(() => {
    if (agentRef.current) {
      agentRef.current.stop();
    }
  }, []);

  // Inject user input during execution
  const injectInput = React.useCallback((input: string) => {
    const agent = agentRef.current;
    if (agent && agent.injectInput) {
      agent.injectInput(input);
    }
  }, []);

  return {
    status: state.status,
    todos: state.todos,
    output: state.output,
    streamingText: state.streamingText,
    isStreaming: state.isStreaming,
    streamingThinkText: state.streamingThinkText,
    isThinkStreaming: state.isThinkStreaming,
    question: state.question,
    isConfirmation: state.isConfirmation,
    questionOptions: state.questionOptions,
    autoApproveTimeoutMs: state.autoApproveTimeoutMs,
    questionContext: state.questionContext,
    error: state.error,
    recentTools: state.recentTools,
    history: state.history,
    currentAction: state.currentAction,
    contextUsage: state.contextUsage,
    notification: state.notification,
    run,
    respond,
    reset,
    stop,
    injectInput,
  };
}

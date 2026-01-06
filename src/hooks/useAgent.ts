/**
 * Hook for managing agent lifecycle.
 * Optimized to reduce re-renders and flickering.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { GenericAgent, type AgentConfig, type GenericAgentResult } from '../core/agent/index.js';
import { LLMClient, type LLMClientConfig, type ToolDefinition } from '../core/llm/index.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';
import type { AgentEvent } from '../events/index.js';
import { contextStore } from '../core/context/ContextStore.js';

// Debug logging to file
const DEBUG_LOG_PATH = path.join(process.cwd(), 'logs', 'debug.log');
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

interface UseAgentOptions {
  tools: Map<string, ToolDefinition>;
  llmConfig?: LLMClientConfig;
  agentConfig?: AgentConfig;
  onEvent?: (event: AgentEvent) => void;
  projectId?: string | null;
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
  type: 'user_input' | 'agent_text' | 'tool_completed' | 'error' | 'phase_transition';
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
}

/**
 * Current action - the single thing the agent is doing right now (ephemeral).
 * Disappears from UI once completed (moves to history).
 */
export interface CurrentAction {
  type: 'thinking' | 'tool_executing';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  startTime: number;
  /** Name of the agent performing this action */
  agentName?: string;
}

/**
 * Option for multiple choice questions.
 */
export interface QuestionOption {
  label: string;
  description?: string;
}

interface AgentState {
  status: AgentStatus;
  todos: ExpandableTodoItem[];
  output: string;
  /** Current streaming text being accumulated */
  streamingText: string;
  /** Whether streaming is in progress */
  isStreaming: boolean;
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
  | { type: 'SET_THINKING'; agentName?: string }
  | { type: 'CLEAR_CURRENT_ACTION' }
  | { type: 'RESET' }
  | { type: 'START_TASK'; task: string }
  | { type: 'ADD_PHASE_TRANSITION'; fromPhase: string; toPhase: string; displayName?: string; description?: string };

const MAX_VISIBLE_TOOLS = 15;
const MAX_HISTORY = 500; // Keep more history for scrolling

const initialState: AgentState = {
  status: 'idle',
  todos: [],
  output: '',
  streamingText: '',
  isStreaming: false,
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

    case 'SET_THINKING':
      return {
        ...state,
        status: 'thinking',
        currentAction: { type: 'thinking', startTime: Date.now(), agentName: action.agentName },
        currentAgentName: action.agentName ?? state.currentAgentName,
      };

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
      };
    }

    case 'TOOL_COMPLETE': {
      const endTime = Date.now();
      const tool = state.recentTools.find(t => t.id === action.toolCallId);
      const duration = tool ? endTime - tool.startTime : 0;
      const agentName = action.agentName ?? tool?.agentName ?? state.currentAgentName;

      // Create history entry, including any streaming content that was generated
      // Mark wasStreamed if content was already displayed live (to avoid duplicate display)
      const historyEntry: HistoryEntry | null = tool
        ? {
          id: `tool-${action.toolCallId}`,
          type: 'tool_completed',
          content: tool.name,
          timestamp: endTime,
          toolName: tool.name,
          toolArgs: tool.args,
          toolResult: action.result,
          duration,
          agentName,
          streamingContent: tool.streamingContent,
          wasStreamed: !!tool.streamingContent,
        }
        : null;

      return {
        ...state,
        currentAction: null,
        recentTools: state.recentTools.map(t =>
          t.id === action.toolCallId
            ? { ...t, status: action.isError ? 'error' : 'completed', result: action.result, endTime, duration }
            : t
        ),
        history: historyEntry
          ? [...state.history.slice(-MAX_HISTORY + 1), historyEntry]
          : state.history,
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
        startTime: targetTool.startTime, // Use original start time
        agentName: action.agentName ?? targetTool.agentName,
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

    case 'ADD_USER_INPUT':
      return {
        ...state,
        history: [
          ...state.history.slice(-MAX_HISTORY + 1),
          {
            id: `user-${Date.now()}`,
            type: 'user_input',
            content: action.text,
            timestamp: Date.now(),
          },
        ],
      };

    case 'STREAM_CHUNK':
      debugLog(`[useAgent] STREAM_CHUNK: chunk=${action.chunk.length} chars, newTotal=${(state.streamingText + action.chunk).length} chars`);
      return {
        ...state,
        streamingText: state.streamingText + action.chunk,
        isStreaming: true,
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

    case 'CLEAR_CURRENT_ACTION':
      return { ...state, currentAction: null };

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
  question: string | undefined;
  isConfirmation: boolean;
  questionOptions: QuestionOption[] | undefined;
  autoApproveTimeoutMs: number | undefined;
  questionContext: string | undefined;
  error: string | undefined;
  recentTools: ToolCallHistoryItem[];
  history: HistoryEntry[];
  currentAction: CurrentAction | null;
  run: (task: string) => Promise<GenericAgentResult>;
  respond: (userInput: string) => Promise<GenericAgentResult>;
  reset: () => void;
  stop: () => void;
  injectInput: (input: string) => void;
  setProjectId: (projectId: string | null) => void;
  updateCustomPrompt: (prompt: string) => void;
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { tools, llmConfig, agentConfig, onEvent, projectId } = options;

  const [state, dispatch] = React.useReducer(agentReducer, initialState);
  const agentRef = React.useRef<GenericAgent | null>(null);
  const llmRef = React.useRef<LLMClient | null>(null);
  const projectIdRef = React.useRef<string | null>(projectId ?? null);

  // Initialize LLM client
  const getLLM = React.useCallback(() => {
    if (!llmRef.current) {
      llmRef.current = new LLMClient(llmConfig);
    }
    return llmRef.current;
  }, [llmConfig]);

  // Create agent
  const createAgent = React.useCallback(() => {
    const llm = getLLM();
    // Use the ref value to ensure we get the latest projectId even if prop hasn't updated yet
    const currentProjectId = projectIdRef.current ?? projectId ?? null;
    // Pass projectId to agent config for isolation
    const agent = new GenericAgent(tools, llm, {
      ...agentConfig,
      projectId: currentProjectId,
    });

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

    agentRef.current = agent;
    return agent;
  }, [tools, agentConfig, getLLM, onEvent, projectId]);

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
    [createAgent, projectId]
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

      // Add user response to history
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

  // Reset agent state when projectId changes
  React.useEffect(() => {
    if (projectIdRef.current !== projectId) {
      // Project changed - reset agent to ensure isolation
      debugLog(`[useAgent] Project ID changed from ${projectIdRef.current} to ${projectId}. Resetting agent.`);
      agentRef.current = null;
      dispatch({ type: 'RESET' });
      projectIdRef.current = projectId ?? null;
      // Reload context store for the new project
      contextStore.reload(projectId ?? null);
    }
  }, [projectId]);

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
    if (agentRef.current) {
      agentRef.current.injectInput(input);
    }
  }, []);

  // Set project ID directly (bypasses React state update delay)
  // This is used when creating a new project to ensure immediate isolation
  const setProjectId = React.useCallback((newProjectId: string | null) => {
    if (projectIdRef.current !== newProjectId) {
      debugLog(`[useAgent] Setting project ID directly from ${projectIdRef.current} to ${newProjectId}`);
      projectIdRef.current = newProjectId;
      // Reset agent to ensure isolation
      agentRef.current = null;
      dispatch({ type: 'RESET' });
      // Reload context store for the new project
      contextStore.reload(newProjectId);
    }
  }, []);

  // Update custom prompt dynamically
  const updateCustomPrompt = React.useCallback((prompt: string) => {
    if (agentRef.current) {
      debugLog(`[useAgent] Updating custom prompt. Length: ${prompt.length}`);
      agentRef.current.updateCustomPrompt(prompt);
    }
  }, []);

  return {
    status: state.status,
    todos: state.todos,
    output: state.output,
    streamingText: state.streamingText,
    isStreaming: state.isStreaming,
    question: state.question,
    isConfirmation: state.isConfirmation,
    questionOptions: state.questionOptions,
    autoApproveTimeoutMs: state.autoApproveTimeoutMs,
    questionContext: state.questionContext,
    error: state.error,
    recentTools: state.recentTools,
    history: state.history,
    currentAction: state.currentAction,
    run,
    respond,
    reset,
    stop,
    injectInput,
    setProjectId,
    updateCustomPrompt,
  };
}

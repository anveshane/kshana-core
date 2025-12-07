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
}

/**
 * A history entry representing something that already happened (permanent).
 */
export interface HistoryEntry {
  id: string;
  type: 'user_input' | 'agent_text' | 'tool_completed' | 'error';
  content: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  duration?: number;
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
  error: string | undefined;
  recentTools: ToolCallHistoryItem[];
  history: HistoryEntry[];
  currentAction: CurrentAction | null;
}

type AgentAction =
  | { type: 'SET_STATUS'; status: AgentStatus }
  | { type: 'SET_TODOS'; todos: ExpandableTodoItem[] }
  | { type: 'APPEND_OUTPUT'; text: string }
  | { type: 'SET_QUESTION'; question: string; isConfirmation: boolean; options?: QuestionOption[]; autoApproveTimeoutMs?: number }
  | { type: 'CLEAR_QUESTION' }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'TOOL_START'; toolCallId: string; toolName: string; args?: Record<string, unknown> }
  | { type: 'TOOL_COMPLETE'; toolCallId: string; result: unknown; isError: boolean }
  | { type: 'ADD_AGENT_TEXT'; text: string }
  | { type: 'ADD_USER_INPUT'; text: string; isTask?: boolean }
  | { type: 'STREAM_CHUNK'; chunk: string }
  | { type: 'STREAM_DONE'; skipHistory?: boolean }
  | { type: 'SET_THINKING' }
  | { type: 'CLEAR_CURRENT_ACTION' }
  | { type: 'RESET' }
  | { type: 'START_TASK'; task: string };

const MAX_VISIBLE_TOOLS = 15;
const MAX_HISTORY = 50; // Limit history to prevent memory issues

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
  error: undefined,
  recentTools: [],
  history: [],
  currentAction: null,
};

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.status };

    case 'SET_TODOS':
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
        status: 'waiting',
        currentAction: null,
      };

    case 'CLEAR_QUESTION':
      return { ...state, question: undefined, isConfirmation: false, questionOptions: undefined, autoApproveTimeoutMs: undefined };

    case 'SET_ERROR':
      return { ...state, error: action.error, status: 'error', currentAction: null };

    case 'SET_THINKING':
      return {
        ...state,
        status: 'thinking',
        currentAction: { type: 'thinking', startTime: Date.now() },
      };

    case 'TOOL_START': {
      const startTime = Date.now();
      const newTool: ToolCallHistoryItem = {
        id: action.toolCallId,
        name: action.toolName,
        args: action.args,
        status: 'executing',
        startTime,
      };
      return {
        ...state,
        currentAction: {
          type: 'tool_executing',
          toolName: action.toolName,
          toolArgs: action.args,
          toolCallId: action.toolCallId,
          startTime,
        },
        recentTools: [...state.recentTools.slice(-(MAX_VISIBLE_TOOLS - 1)), newTool],
      };
    }

    case 'TOOL_COMPLETE': {
      const endTime = Date.now();
      const tool = state.recentTools.find(t => t.id === action.toolCallId);
      const duration = tool ? endTime - tool.startTime : 0;

      // Create history entry
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

    case 'ADD_AGENT_TEXT':
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
          },
        ],
      };

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
      return {
        ...state,
        streamingText: state.streamingText + action.chunk,
        isStreaming: true,
      };

    case 'STREAM_DONE': {
      // Move completed streaming text to history if there's content
      const finalText = state.streamingText.trim();
      if (!finalText || action.skipHistory) {
        // Either no content or skipHistory flag set (e.g., plan shown via ToolCallDisplay)
        return {
          ...state,
          streamingText: '',
          isStreaming: false,
        };
      }
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
  error: string | undefined;
  recentTools: ToolCallHistoryItem[];
  history: HistoryEntry[];
  currentAction: CurrentAction | null;
  run: (task: string) => Promise<GenericAgentResult>;
  respond: (userInput: string) => Promise<GenericAgentResult>;
  reset: () => void;
  stop: () => void;
  injectInput: (input: string) => void;
}

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { tools, llmConfig, agentConfig, onEvent } = options;

  const [state, dispatch] = React.useReducer(agentReducer, initialState);
  const agentRef = React.useRef<GenericAgent | null>(null);
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
    const llm = getLLM();
    const agent = new GenericAgent(tools, llm, agentConfig);

    // Subscribe to events
    agent.on('agent_status', event => {
      switch (event.status) {
        case 'started':
        case 'thinking':
          dispatch({ type: 'SET_THINKING' });
          break;
        case 'waiting':
          // Question event will handle this
          break;
        case 'completed':
          dispatch({ type: 'SET_STATUS', status: 'completed' });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
        case 'error':
          dispatch({ type: 'SET_STATUS', status: 'error' });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
        case 'interrupted':
          dispatch({ type: 'SET_STATUS', status: 'idle' });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
      }
      onEvent?.(event);
    });

    agent.on('todo_update', event => {
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
      }, null, 2)}`);
      dispatch({
        type: 'SET_QUESTION',
        question: event.question,
        isConfirmation: event.isConfirmation,
        options: event.options,
        autoApproveTimeoutMs: event.autoApproveTimeoutMs,
      });
      onEvent?.(event);
    });

    agent.on('tool_call', event => {
      dispatch({
        type: 'TOOL_START',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.arguments,
      });
      onEvent?.(event);
    });

    agent.on('tool_result', event => {
      dispatch({
        type: 'TOOL_COMPLETE',
        toolCallId: event.toolCallId,
        result: event.result,
        isError: event.isError ?? false,
      });
      onEvent?.(event);
    });

    agentRef.current = agent;
    return agent;
  }, [tools, agentConfig, getLLM, onEvent]);

  // Run agent on a task
  const run = React.useCallback(
    async (task: string): Promise<GenericAgentResult> => {
      dispatch({ type: 'START_TASK', task });

      const agent = createAgent();

      try {
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
    error: state.error,
    recentTools: state.recentTools,
    history: state.history,
    currentAction: state.currentAction,
    run,
    respond,
    reset,
    stop,
    injectInput,
  };
}

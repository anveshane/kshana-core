/**
 * Shared agent reducer for both legacy and harness implementations.
 * Extracted from useAgent.ts to be reused across different agent implementations.
 */

import type { ExpandableTodoItem } from '../core/todo/index.js';

type AgentStatus = 'idle' | 'thinking' | 'waiting' | 'completed' | 'error';

export interface ToolCallHistoryItem {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error';
  result?: unknown;
  startTime: number;
  endTime?: number;
  duration?: number;
  agentName?: string;
  streamingContent?: string;
}

export interface HistoryEntry {
  id: string;
  type: 'user_input' | 'agent_text' | 'tool_completed' | 'error';
  content: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  duration?: number;
  agentName?: string;
  streamingContent?: string;
}

export interface CurrentAction {
  type: 'thinking' | 'tool_executing';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  startTime: number;
  agentName?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface AgentState {
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
  currentAgentName: string | undefined;
}

export type AgentAction =
  | { type: 'SET_STATUS'; status: AgentStatus; agentName?: string }
  | { type: 'SET_TODOS'; todos: ExpandableTodoItem[] }
  | { type: 'APPEND_OUTPUT'; text: string }
  | { type: 'SET_QUESTION'; question: string; isConfirmation: boolean; options?: QuestionOption[]; autoApproveTimeoutMs?: number }
  | { type: 'CLEAR_QUESTION' }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'TOOL_START'; toolCallId: string; toolName: string; args?: Record<string, unknown>; agentName?: string }
  | { type: 'TOOL_COMPLETE'; toolCallId: string; result: unknown; isError: boolean; agentName?: string }
  | { type: 'TOOL_STREAM'; toolCallId: string; chunk: string; done: boolean }
  | { type: 'ADD_AGENT_TEXT'; text: string; agentName?: string }
  | { type: 'ADD_USER_INPUT'; text: string; isTask?: boolean }
  | { type: 'STREAM_CHUNK'; chunk: string; agentName?: string }
  | { type: 'STREAM_DONE'; skipHistory?: boolean; agentName?: string }
  | { type: 'SET_THINKING'; agentName?: string }
  | { type: 'CLEAR_CURRENT_ACTION' }
  | { type: 'RESET' }
  | { type: 'START_TASK'; task: string };

const MAX_VISIBLE_TOOLS = 15;
const MAX_HISTORY = 500;

export const initialState: AgentState = {
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
  currentAgentName: undefined,
};

export function agentReducer(state: AgentState, action: AgentAction): AgentState {
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
      return {
        ...state,
        recentTools: state.recentTools.map(t =>
          t.id === action.toolCallId
            ? { ...t, streamingContent: (t.streamingContent ?? '') + action.chunk }
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
      return {
        ...state,
        streamingText: state.streamingText + action.chunk,
        isStreaming: true,
        currentAgentName: action.agentName ?? state.currentAgentName,
      };

    case 'STREAM_DONE': {
      const finalText = state.streamingText.trim();
      const agentName = action.agentName ?? state.currentAgentName;
      if (!finalText || action.skipHistory) {
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

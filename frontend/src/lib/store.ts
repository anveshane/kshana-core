/**
 * Application state store.
 * Replaces the global variables from the inline SPA.
 * Uses React context + useReducer for predictable state management.
 */

import { createContext, useContext } from 'react'
import type { Timeline } from './timeline-types'

// ── Types ──────────────────────────────────────────────────

export interface Project {
  name: string
  phase?: string
  templateId?: string
}

export interface TodoItem {
  id: string
  text: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  category?: string
}

export interface ToolCall {
  id: string
  toolName: string
  args?: Record<string, string>
  status: 'executing' | 'completed' | 'error'
  result?: unknown
  streamingContent?: string
  startTime: number
  duration?: number
  agentName?: string
}

export interface ChatMessage {
  id: string
  type: 'agent' | 'user' | 'system'
  content: string
  timestamp: number
  agentName?: string
}

export interface MediaPreview {
  id: string
  type: 'image' | 'video'
  url: string
  label?: string
}

export interface AppState {
  // Connection
  sessionId: string | null
  connectionStatus: 'connecting' | 'connected' | 'disconnected'

  // Project
  projects: Project[]
  selectedProject: string | null
  phase: string | null

  // Execution
  todos: TodoItem[]
  toolCalls: ToolCall[]
  chatMessages: ChatMessage[]
  streamingText: string | null
  agentStatus: 'idle' | 'thinking' | 'waiting' | 'completed' | 'error'

  // Context usage
  contextUsage: { percentage: number; promptTokens: number; maxTokens: number } | null

  // Assets
  assets: Array<{ id: string; path: string; url: string; type: string }>

  // Timeline
  timeline: Timeline | null
  activeView: 'chat' | 'timeline'

  // Settings
  autonomousMode: boolean
  parallelMedia: boolean
}

export const initialState: AppState = {
  sessionId: null,
  connectionStatus: 'disconnected',
  projects: [],
  selectedProject: null,
  phase: null,
  todos: [],
  toolCalls: [],
  chatMessages: [],
  streamingText: null,
  agentStatus: 'idle',
  contextUsage: null,
  assets: [],
  timeline: null,
  activeView: 'chat' as const,
  autonomousMode: false,
  parallelMedia: false,
}

// ── Actions ────────────────────────────────────────────────

export type AppAction =
  | { type: 'SET_CONNECTION'; status: AppState['connectionStatus']; sessionId?: string }
  | { type: 'SET_PROJECTS'; projects: Project[] }
  | { type: 'SELECT_PROJECT'; name: string | null }
  | { type: 'SET_PHASE'; phase: string | null }
  | { type: 'SET_TODOS'; todos: TodoItem[] }
  | { type: 'ADD_TOOL_CALL'; toolCall: ToolCall }
  | { type: 'UPDATE_TOOL_CALL'; id: string; updates: Partial<ToolCall> }
  | { type: 'APPEND_TOOL_STREAMING'; id: string; chunk: string; reset?: boolean }
  | { type: 'ADD_CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'SET_STREAMING_TEXT'; text: string | null }
  | { type: 'APPEND_STREAMING_TEXT'; chunk: string }
  | { type: 'SET_AGENT_STATUS'; status: AppState['agentStatus'] }
  | { type: 'SET_CONTEXT_USAGE'; usage: AppState['contextUsage'] }
  | { type: 'SET_ASSETS'; assets: AppState['assets'] }
  | { type: 'SET_AUTONOMOUS'; enabled: boolean }
  | { type: 'SET_PARALLEL_MEDIA'; enabled: boolean }
  | { type: 'SET_TIMELINE'; timeline: Timeline | null }
  | { type: 'SET_ACTIVE_VIEW'; view: 'chat' | 'timeline' }

// ── Reducer ────────────────────────────────────────────────

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONNECTION':
      return {
        ...state,
        connectionStatus: action.status,
        sessionId: action.sessionId ?? state.sessionId,
      }

    case 'SET_PROJECTS':
      return { ...state, projects: action.projects }

    case 'SELECT_PROJECT':
      return {
        ...state,
        selectedProject: action.name,
        phase: null,
        todos: [],
        assets: [],
        chatMessages: [],
        toolCalls: [],
        streamingText: null,
        agentStatus: 'idle',
        timeline: null,
        activeView: 'chat',
      }

    case 'SET_PHASE':
      return { ...state, phase: action.phase }

    case 'SET_TODOS':
      return { ...state, todos: action.todos }

    case 'ADD_TOOL_CALL':
      return { ...state, toolCalls: [...state.toolCalls, action.toolCall] }

    case 'UPDATE_TOOL_CALL':
      return {
        ...state,
        toolCalls: state.toolCalls.map(tc =>
          tc.id === action.id ? { ...tc, ...action.updates } : tc
        ),
      }

    case 'APPEND_TOOL_STREAMING': {
      return {
        ...state,
        toolCalls: state.toolCalls.map(tc => {
          if (tc.id !== action.id) return tc
          const content = action.reset ? action.chunk : (tc.streamingContent ?? '') + action.chunk
          return { ...tc, streamingContent: content }
        }),
      }
    }

    case 'ADD_CHAT_MESSAGE':
      return { ...state, chatMessages: [...state.chatMessages, action.message] }

    case 'SET_STREAMING_TEXT':
      return { ...state, streamingText: action.text }

    case 'APPEND_STREAMING_TEXT':
      return { ...state, streamingText: (state.streamingText ?? '') + action.chunk }

    case 'SET_AGENT_STATUS':
      return { ...state, agentStatus: action.status }

    case 'SET_CONTEXT_USAGE':
      return { ...state, contextUsage: action.usage }

    case 'SET_ASSETS':
      return { ...state, assets: action.assets }

    case 'SET_AUTONOMOUS':
      return { ...state, autonomousMode: action.enabled }

    case 'SET_PARALLEL_MEDIA':
      return { ...state, parallelMedia: action.enabled }

    case 'SET_TIMELINE':
      return { ...state, timeline: action.timeline }

    case 'SET_ACTIVE_VIEW':
      return { ...state, activeView: action.view }

    default:
      return state
  }
}

// ── Context ────────────────────────────────────────────────

export const AppStateContext = createContext<AppState>(initialState)
export const AppDispatchContext = createContext<React.Dispatch<AppAction>>(() => {})

export function useAppState() {
  return useContext(AppStateContext)
}

export function useAppDispatch() {
  return useContext(AppDispatchContext)
}

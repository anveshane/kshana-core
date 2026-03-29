/**
 * Maps incoming WebSocket messages to store actions.
 * This replaces the monolithic handleServerMessage() from the inline SPA.
 */

import { useCallback } from 'react'
import type { ServerMessage } from './useWebSocket'
import type { AppAction } from '../lib/store'

let toolCounter = 0

export function useMessageHandler(dispatch: React.Dispatch<AppAction>) {
  return useCallback((msg: ServerMessage) => {
    const { type, data } = msg

    switch (type) {
      case 'status': {
        const status = data.status as string
        if (status === 'ready' || status === 'completed') {
          dispatch({ type: 'SET_AGENT_STATUS', status: 'idle' })
        } else if (status === 'busy') {
          dispatch({ type: 'SET_AGENT_STATUS', status: 'thinking' })
        }
        // Phase update
        if (data.phase) {
          dispatch({ type: 'SET_PHASE', phase: data.phase as string })
        }
        break
      }

      case 'tool_call': {
        const toolName = data.toolName as string
        const toolCallId = data.toolCallId as string
        const status = data.status as string
        const args = data.arguments as Record<string, unknown> | undefined
        const result = data.result as unknown
        const agentName = data.agentName as string | undefined

        if (status === 'started' || (!status && !result)) {
          toolCounter++
          const id = toolCallId || `tool_${toolCounter}`
          dispatch({
            type: 'ADD_TOOL_CALL',
            toolCall: {
              id,
              toolName,
              args: args as Record<string, string> | undefined,
              status: 'executing',
              startTime: Date.now(),
              agentName,
            },
          })
        } else if (status === 'completed' || status === 'error') {
          // Find matching tool call by toolName (most recent)
          dispatch({
            type: 'UPDATE_TOOL_CALL',
            id: toolCallId || toolName,
            updates: {
              status: status === 'error' ? 'error' : 'completed',
              result,
              duration: Date.now(), // Will be calculated from startTime in component
            },
          })
        }
        break
      }

      case 'stream_chunk': {
        const toolCallId = data.toolCallId as string | undefined
        const chunk = data.content as string
        const done = data.done as boolean
        const agentName = data.agentName as string | undefined
        const reset = data.reset as boolean | undefined

        if (toolCallId) {
          // Tool streaming — append to tool card
          dispatch({
            type: 'APPEND_TOOL_STREAMING',
            id: toolCallId,
            chunk: chunk || '',
            reset,
          })
        } else {
          // Agent text streaming
          if (done) {
            // Finalize: move streaming text to a chat message
            dispatch({
              type: 'ADD_CHAT_MESSAGE',
              message: {
                id: `msg_${Date.now()}`,
                type: 'agent',
                content: chunk || '',
                timestamp: Date.now(),
                agentName,
              },
            })
            dispatch({ type: 'SET_STREAMING_TEXT', text: null })
          } else {
            dispatch({ type: 'APPEND_STREAMING_TEXT', chunk: chunk || '' })
          }
        }
        break
      }

      case 'todo_update': {
        const todos = (data.todos as Array<{
          content?: string
          text?: string
          status: string
          id?: string
          category?: string
        }>) || []
        dispatch({
          type: 'SET_TODOS',
          todos: todos.map((t, i) => ({
            id: t.id || `todo_${i}`,
            text: t.content || t.text || '',
            status: (t.status === 'cancelled' ? 'failed' : t.status) as 'pending' | 'in_progress' | 'completed' | 'failed',
            category: t.category,
          })),
        })
        break
      }

      case 'phase_transition': {
        dispatch({ type: 'SET_PHASE', phase: data.toPhase as string })
        break
      }

      case 'context_usage': {
        dispatch({
          type: 'SET_CONTEXT_USAGE',
          usage: {
            percentage: data.percentage as number,
            promptTokens: data.promptTokens as number,
            maxTokens: data.maxTokens as number,
          },
        })
        break
      }

      case 'notification': {
        // For now, add as a system chat message
        dispatch({
          type: 'ADD_CHAT_MESSAGE',
          message: {
            id: `notif_${Date.now()}`,
            type: 'system',
            content: data.message as string,
            timestamp: Date.now(),
          },
        })
        break
      }

      case 'agent_response': {
        dispatch({ type: 'SET_AGENT_STATUS', status: 'idle' })
        break
      }
    }
  }, [dispatch])
}

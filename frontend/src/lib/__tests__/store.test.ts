import { describe, it, expect } from 'vitest'
import { appReducer, initialState } from '../store'

describe('appReducer', () => {
  it('sets connection status', () => {
    const state = appReducer(initialState, {
      type: 'SET_CONNECTION',
      status: 'connected',
      sessionId: 'sess-123',
    })
    expect(state.connectionStatus).toBe('connected')
    expect(state.sessionId).toBe('sess-123')
  })

  it('sets projects list', () => {
    const projects = [{ name: 'proj1' }, { name: 'proj2', phase: 'story' }]
    const state = appReducer(initialState, { type: 'SET_PROJECTS', projects })
    expect(state.projects).toEqual(projects)
  })

  it('selects project and clears dependent state', () => {
    const withState = {
      ...initialState,
      todos: [{ id: '1', text: 'test', status: 'pending' as const }],
      assets: [{ id: 'a1', path: 'p', url: 'u', type: 'image' }],
      phase: 'video_gen',
    }
    const state = appReducer(withState, { type: 'SELECT_PROJECT', name: 'new_proj' })
    expect(state.selectedProject).toBe('new_proj')
    expect(state.todos).toEqual([])
    expect(state.assets).toEqual([])
    expect(state.phase).toBeNull()
  })

  it('adds tool call', () => {
    const tc = { id: 'tc1', toolName: 'generate_image', status: 'executing' as const, startTime: 1000 }
    const state = appReducer(initialState, { type: 'ADD_TOOL_CALL', toolCall: tc })
    expect(state.toolCalls).toHaveLength(1)
    expect(state.toolCalls[0].id).toBe('tc1')
  })

  it('updates tool call', () => {
    const withTC = {
      ...initialState,
      toolCalls: [{ id: 'tc1', toolName: 'gen', status: 'executing' as const, startTime: 1000 }],
    }
    const state = appReducer(withTC, {
      type: 'UPDATE_TOOL_CALL',
      id: 'tc1',
      updates: { status: 'completed', result: { file_path: 'out.mp4' } },
    })
    expect(state.toolCalls[0].status).toBe('completed')
    expect((state.toolCalls[0].result as any).file_path).toBe('out.mp4')
  })

  it('appends tool streaming content', () => {
    const withTC = {
      ...initialState,
      toolCalls: [{ id: 'tc1', toolName: 'gen', status: 'executing' as const, startTime: 1000, streamingContent: 'Hello' }],
    }
    const state = appReducer(withTC, {
      type: 'APPEND_TOOL_STREAMING',
      id: 'tc1',
      chunk: ' world',
    })
    expect(state.toolCalls[0].streamingContent).toBe('Hello world')
  })

  it('resets streaming content when reset flag is set', () => {
    const withTC = {
      ...initialState,
      toolCalls: [{ id: 'tc1', toolName: 'gen', status: 'executing' as const, startTime: 1000, streamingContent: 'Old content' }],
    }
    const state = appReducer(withTC, {
      type: 'APPEND_TOOL_STREAMING',
      id: 'tc1',
      chunk: 'New content',
      reset: true,
    })
    expect(state.toolCalls[0].streamingContent).toBe('New content')
  })

  it('adds chat message', () => {
    const msg = { id: 'm1', type: 'agent' as const, content: 'Hello', timestamp: 1000 }
    const state = appReducer(initialState, { type: 'ADD_CHAT_MESSAGE', message: msg })
    expect(state.chatMessages).toHaveLength(1)
    expect(state.chatMessages[0].content).toBe('Hello')
  })

  it('appends streaming text', () => {
    const withText = { ...initialState, streamingText: 'Hello' }
    const state = appReducer(withText, { type: 'APPEND_STREAMING_TEXT', chunk: ' world' })
    expect(state.streamingText).toBe('Hello world')
  })

  it('sets agent status', () => {
    const state = appReducer(initialState, { type: 'SET_AGENT_STATUS', status: 'thinking' })
    expect(state.agentStatus).toBe('thinking')
  })

  it('sets todos', () => {
    const todos = [
      { id: '1', text: 'Task 1', status: 'completed' as const },
      { id: '2', text: 'Task 2', status: 'pending' as const },
    ]
    const state = appReducer(initialState, { type: 'SET_TODOS', todos })
    expect(state.todos).toHaveLength(2)
    expect(state.todos[0].status).toBe('completed')
  })

  it('toggles autonomous mode', () => {
    const state = appReducer(initialState, { type: 'SET_AUTONOMOUS', enabled: true })
    expect(state.autonomousMode).toBe(true)
    const state2 = appReducer(state, { type: 'SET_AUTONOMOUS', enabled: false })
    expect(state2.autonomousMode).toBe(false)
  })

  it('toggles parallel media', () => {
    const state = appReducer(initialState, { type: 'SET_PARALLEL_MEDIA', enabled: true })
    expect(state.parallelMedia).toBe(true)
  })
})

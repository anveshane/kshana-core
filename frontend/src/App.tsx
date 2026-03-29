import { useReducer, useState, useCallback } from 'react'
import { AppStateContext, AppDispatchContext, appReducer, initialState } from './lib/store'
import { useWebSocket } from './hooks/useWebSocket'
import { useMessageHandler } from './hooks/useMessageHandler'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { ChatTimeline } from './components/ChatTimeline'
import { TaskInput } from './components/TaskInput'

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const [showProviders, setShowProviders] = useState(false)
  const [showWorkflows, setShowWorkflows] = useState(false)

  const handleMessage = useMessageHandler(dispatch)

  const { send, status } = useWebSocket({
    onMessage: handleMessage,
    onConnect: (sessionId) => {
      dispatch({ type: 'SET_CONNECTION', status: 'connected', sessionId })
    },
    onDisconnect: () => {
      dispatch({ type: 'SET_CONNECTION', status: 'disconnected' })
    },
  })

  // Update connection status
  if (status !== state.connectionStatus) {
    dispatch({ type: 'SET_CONNECTION', status })
  }

  const handleSendTask = useCallback((task: string) => {
    if (!task.trim()) return
    dispatch({
      type: 'ADD_CHAT_MESSAGE',
      message: { id: `user_${Date.now()}`, type: 'user', content: task, timestamp: Date.now() },
    })
    send({ type: 'start_task', data: { task } })
    dispatch({ type: 'SET_AGENT_STATUS', status: 'thinking' })
  }, [send])

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
          <Header
            onProviderSettings={() => setShowProviders(!showProviders)}
            onWorkflows={() => setShowWorkflows(!showWorkflows)}
          />

          <div className="flex flex-1 overflow-hidden">
            <Sidebar />

            {/* Main content area */}
            <main className="flex-1 flex flex-col overflow-hidden">
              <ChatTimeline />
              <TaskInput onSend={handleSendTask} />
            </main>
          </div>
        </div>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  )
}

import { useReducer, useState, useCallback, useRef } from 'react'
import { AppStateContext, AppDispatchContext, appReducer, initialState } from './lib/store'
import { useWebSocket } from './hooks/useWebSocket'
import { useMessageHandler } from './hooks/useMessageHandler'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { ChatTimeline } from './components/ChatTimeline'
import { TaskInput } from './components/TaskInput'
import { WorkflowManager } from './components/WorkflowManager'
import { ProviderSettings } from './components/ProviderSettings'
import { ProjectSelector } from './components/ProjectSelector'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NewProjectInline } from './components/NewProjectInline'
import { tryExecuteCommand } from './lib/commands'

export function App() {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const [showProviders, setShowProviders] = useState(false)
  const [showWorkflows, setShowWorkflows] = useState(false)
  const [showNewProject, setShowNewProject] = useState(false)

  // Stable refs for WebSocket callbacks to prevent reconnect loops
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch

  const handleMessage = useMessageHandler(dispatch)
  const handleMessageRef = useRef(handleMessage)
  handleMessageRef.current = handleMessage

  // Stable callbacks that don't change reference
  const stableOnMessage = useCallback((msg: any) => handleMessageRef.current(msg), [])
  const stableOnConnect = useCallback((sessionId: string) => {
    dispatchRef.current({ type: 'SET_CONNECTION', status: 'connected', sessionId })
  }, [])
  const stableOnDisconnect = useCallback(() => {
    dispatchRef.current({ type: 'SET_CONNECTION', status: 'disconnected' })
  }, [])

  const { send } = useWebSocket({
    onMessage: stableOnMessage,
    onConnect: stableOnConnect,
    onDisconnect: stableOnDisconnect,
  })

  const handleSendTask = useCallback((task: string) => {
    if (!task.trim()) return

    // Try command first
    const handled = tryExecuteCommand(task, {
      dispatch,
      send,
      setShowWorkflows,
      setShowProviders,
      setShowNewProject,
    })
    if (handled) return

    // Regular task
    dispatch({
      type: 'ADD_CHAT_MESSAGE',
      message: { id: `user_${Date.now()}`, type: 'user', content: task, timestamp: Date.now() },
    })
    send({ type: 'start_task', data: { task } })
    dispatch({ type: 'SET_AGENT_STATUS', status: 'thinking' })
  }, [send, dispatch])

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <ErrorBoundary>
          <div className="app-shell h-screen flex flex-col text-foreground overflow-hidden">
            {/* Aurora ambient glow */}
            <div className="aurora aurora--left" />
            <div className="aurora aurora--right" />

            <Header
              onProviderSettings={() => setShowProviders(true)}
              onWorkflows={() => setShowWorkflows(true)}
              projectSelector={<ProjectSelector onSendWs={send} />}
            />

            <div className="flex flex-1 overflow-hidden relative z-10">
              <Sidebar />
              <main className="flex-1 flex flex-col overflow-hidden">
                <ChatTimeline />
                {showNewProject && (
                  <NewProjectInline
                    onSubmit={(data) => {
                      setShowNewProject(false)
                      send({
                        type: 'create_project',
                        data: {
                          ...data,
                          resolution: '480p',
                          resolutionWidth: 848,
                          resolutionHeight: 480,
                          autonomousMode: true,
                        },
                      })
                      dispatch({
                        type: 'ADD_CHAT_MESSAGE',
                        message: {
                          id: `proj_${Date.now()}`,
                          type: 'system',
                          content: `Creating project: **${data.templateId}** · ${data.style} · ${data.duration}s`,
                          timestamp: Date.now(),
                        },
                      })
                    }}
                    onCancel={() => setShowNewProject(false)}
                  />
                )}
                <TaskInput onSend={handleSendTask} />
              </main>
            </div>

            {/* Modals */}
            <WorkflowManager open={showWorkflows} onClose={() => setShowWorkflows(false)} />
            <ProviderSettings open={showProviders} onClose={() => setShowProviders(false)} />
          </div>
        </ErrorBoundary>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  )
}

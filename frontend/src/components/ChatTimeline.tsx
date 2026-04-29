import { useRef, useEffect } from 'react'
import { useAppState, useAppDispatch } from '../lib/store'
import { ToolCallCard } from './ToolCallCard'

interface ChatTimelineProps {
  onSendWs?: (msg: Record<string, unknown>) => void
}

export function ChatTimeline({ onSendWs }: ChatTimelineProps) {
  const { chatMessages, toolCalls, streamingText, agentStatus, selectedProject } = useAppState()
  const dispatch = useAppDispatch()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages.length, toolCalls.length, streamingText])

  // Interleave messages and tool calls by timestamp
  const timeline: Array<
    | { kind: 'message'; data: typeof chatMessages[0] }
    | { kind: 'tool'; data: typeof toolCalls[0] }
  > = []

  for (const msg of chatMessages) {
    timeline.push({ kind: 'message', data: msg })
  }
  for (const tc of toolCalls) {
    timeline.push({ kind: 'tool', data: tc })
  }
  timeline.sort((a, b) => {
    const timeA = a.kind === 'message' ? a.data.timestamp : a.data.startTime
    const timeB = b.kind === 'message' ? b.data.timestamp : b.data.startTime
    return timeA - timeB
  })

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {/* Project info banner */}
      {selectedProject && (
        <div className="glass-panel px-4 py-3 text-sm text-graphite-100 flex items-center justify-between">
          <span>
            Project: <span className="text-foreground font-medium">{selectedProject}</span>
          </span>
          {agentStatus !== 'thinking' && onSendWs && (
            <button
              onClick={() => {
                onSendWs({ type: 'start_task', data: { task: 'continue' } })
                dispatch({ type: 'SET_AGENT_STATUS', status: 'thinking' })
              }}
              className="px-3 py-1.5 rounded-md text-xs font-mono bg-cyan/20 text-cyan hover:bg-cyan/30 border border-cyan/20 transition-colors cursor-pointer"
            >
              Run
            </button>
          )}
        </div>
      )}

      {/* Timeline items */}
      {timeline.map((item) => {
        if (item.kind === 'message') {
          const msg = item.data

          // Reset messages get a distinct visual divider
          // Only show the initial "Resetting..." message as divider, skip "complete/resuming" duplicates
          if (msg.type === 'system' && msg.content.match(/^resetting\s/i)) {
            const stageMatch = msg.content.match(/stage\s+\*?\*?"?(\w+)"?\*?\*?/i)
            const stage = stageMatch?.[1] || 'unknown'
            return (
              <div key={msg.id} className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-amber-500/30" />
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[11px] font-mono whitespace-nowrap">
                  <span className="text-sm">↺</span> Reset to {stage}
                </span>
                <div className="flex-1 h-px bg-amber-500/30" />
              </div>
            )
          }
          // Hide the "Reset complete. Resuming..." duplicate notification
          if (msg.type === 'system' && msg.content.match(/reset.*complete.*resum/i)) {
            return <span key={msg.id} />
          }

          if (msg.type === 'media' && msg.media) {
            const { kind, path, project, source } = msg.media
            const url = `/api/v1/assets/${project}/${path}`
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[80%] rounded-lg border border-violet-500/20 bg-graphite-400/40 overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-line-soft flex items-center justify-between">
                    <span className="font-mono text-[10px] text-violet-300 uppercase tracking-wider">
                      {source ? `${source} · ` : ''}new {kind}
                    </span>
                    <span className="font-mono text-[10px] text-graphite-200 truncate ml-2">{path}</span>
                  </div>
                  {kind === 'video' ? (
                    <video src={url} controls loop muted className="w-full max-h-72" />
                  ) : (
                    <img
                      src={url}
                      alt={path}
                      className="w-full max-h-72 object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                </div>
              </div>
            )
          }

          return (
            <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                  msg.type === 'user'
                    ? 'bg-cyan/10 border border-cyan/20 text-foreground'
                    : msg.type === 'system'
                    ? 'bg-surface border border-line-soft text-graphite-100 font-mono text-xs'
                    : 'bg-surface border border-line-soft text-foreground'
                }`}
              >
                {msg.agentName && (
                  <div className="font-mono text-[10px] uppercase tracking-wider text-cyan mb-1">
                    {msg.agentName}
                  </div>
                )}
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          )
        } else {
          return <ToolCallCard key={item.data.id} toolCall={item.data} />
        }
      })}

      {/* Streaming text */}
      {streamingText && (
        <div className="bg-surface border border-line-soft rounded-lg px-4 py-2.5 text-sm leading-relaxed">
          <div className="whitespace-pre-wrap">{streamingText}</div>
          <span className="inline-block w-2 h-4 bg-cyan animate-pulse ml-0.5" />
        </div>
      )}

      {/* Thinking indicator */}
      {agentStatus === 'thinking' && !streamingText && (
        <div className="flex items-center gap-2 text-graphite-100 text-sm">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-cyan animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span className="font-mono text-xs">Thinking...</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  )
}

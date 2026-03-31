import { useRef, useEffect } from 'react'
import { useAppState } from '../lib/store'
import { ToolCallCard } from './ToolCallCard'

export function ChatTimeline() {
  const { chatMessages, toolCalls, streamingText, agentStatus, selectedProject } = useAppState()
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
        <div className="glass-panel px-4 py-3 text-sm text-graphite-100">
          Project: <span className="text-foreground font-medium">{selectedProject}</span>
        </div>
      )}

      {/* Timeline items */}
      {timeline.map((item) => {
        if (item.kind === 'message') {
          const msg = item.data

          // Reset messages get a distinct visual divider
          if (msg.type === 'system' && msg.content.match(/resetting|reset to stage/i)) {
            const stageMatch = msg.content.match(/stage\s+\*?\*?(\w+)\*?\*?/i)
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

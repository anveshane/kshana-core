import { useState, useRef, useCallback } from 'react'
import { useAppState } from '../lib/store'

interface TaskInputProps {
  onSend: (task: string) => void
}

export function TaskInput({ onSend }: TaskInputProps) {
  const { agentStatus, connectionStatus } = useAppState()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isDisabled = connectionStatus !== 'connected' || agentStatus === 'thinking'

  const handleSubmit = useCallback(() => {
    if (!value.trim() || isDisabled) return
    onSend(value)
    setValue('')
    inputRef.current?.focus()
  }, [value, isDisabled, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  return (
    <div className="border-t border-line-soft px-4 py-3 bg-graphite-400/30">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isDisabled ? 'Waiting...' : 'Type a task...'}
          disabled={isDisabled}
          className="flex-1 bg-graphite-300 border border-line-soft rounded-lg px-4 py-2.5 text-sm text-foreground placeholder:text-graphite-200 focus:outline-none focus:border-cyan/40 transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleSubmit}
          disabled={isDisabled || !value.trim()}
          className="px-5 py-2.5 rounded-lg bg-cyan text-background font-mono text-sm font-semibold hover:bg-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          Send
        </button>
      </div>
    </div>
  )
}

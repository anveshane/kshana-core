import { useRef, useState, useCallback, useEffect } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface ServerMessage {
  type: string
  sessionId: string
  data: Record<string, unknown>
}

export interface UseWebSocketOptions {
  url?: string
  onMessage?: (msg: ServerMessage) => void
  onConnect?: (sessionId: string) => void
  onDisconnect?: () => void
  reconnectDelay?: number
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/ws/chat`,
    onMessage,
    onConnect,
    onDisconnect,
    reconnectDelay = 2000,
  } = options

  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
      wsRef.current.send(JSON.stringify({
        ...msg,
        sessionId: sessionIdRef.current,
      }))
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setStatus('connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)

        // Capture session ID from first status message
        if (msg.type === 'status' && msg.sessionId && !sessionIdRef.current) {
          sessionIdRef.current = msg.sessionId
          setSessionId(msg.sessionId)
          onConnect?.(msg.sessionId)
        }

        onMessage?.(msg)
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      setStatus('disconnected')
      wsRef.current = null
      onDisconnect?.()

      // Auto-reconnect
      reconnectTimerRef.current = setTimeout(() => {
        connect()
      }, reconnectDelay)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [url, reconnectDelay, onMessage, onConnect, onDisconnect])

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    wsRef.current?.close()
    wsRef.current = null
    sessionIdRef.current = null
    setSessionId(null)
    setStatus('disconnected')
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return { status, sessionId, send, connect, disconnect }
}

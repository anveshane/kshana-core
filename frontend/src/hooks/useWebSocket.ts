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
  maxRetries?: number
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/v1/ws/chat`,
    onMessage,
    onConnect,
    onDisconnect,
    reconnectDelay = 2000,
    maxRetries = 10,
  } = options

  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retriesRef = useRef(0)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Store callbacks in refs so they don't trigger reconnects
  const onMessageRef = useRef(onMessage)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)
  onMessageRef.current = onMessage
  onConnectRef.current = onConnect
  onDisconnectRef.current = onDisconnect

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
      wsRef.current.send(JSON.stringify({
        ...msg,
        sessionId: sessionIdRef.current,
      }))
    }
  }, [])

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    setStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return }
      retriesRef.current = 0
      setStatus('connected')
    }

    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)

        // Capture session ID from first status message
        if (msg.type === 'status' && msg.sessionId && !sessionIdRef.current) {
          sessionIdRef.current = msg.sessionId
          setSessionId(msg.sessionId)
          onConnectRef.current?.(msg.sessionId)
        }

        onMessageRef.current?.(msg)
      } catch {
        // Ignore malformed messages
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setStatus('disconnected')
      wsRef.current = null
      onDisconnectRef.current?.()

      // Exponential backoff reconnect
      if (retriesRef.current < maxRetries) {
        const delay = reconnectDelay * Math.pow(1.5, retriesRef.current)
        retriesRef.current++
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect()
        }, Math.min(delay, 30000)) // cap at 30s
      }
    }

    ws.onerror = () => {
      // onclose will fire after onerror
    }
  }, [url, reconnectDelay, maxRetries]) // Only depends on config, not callbacks

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
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      disconnect()
    }
  }, [connect, disconnect])

  return { status, sessionId, send, connect, disconnect }
}

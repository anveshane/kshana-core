/**
 * Hook for connecting to WebSocket agent server with beautiful UI.
 * Provides same interface as useAgent but connects remotely.
 */
import React from 'react';
import WebSocket from 'ws';
import type { ExpandableTodoItem } from '../core/todo/index.js';

export interface WebSocketAgentOptions {
  serverUrl?: string;
  onEvent?: (event: any) => void;
}

export interface WebSocketAgentReturn {
  status: 'idle' | 'thinking' | 'waiting' | 'completed' | 'error';
  todos: ExpandableTodoItem[];
  output: string;
  streamingText: string;
  isStreaming: boolean;
  question?: string;
  isConfirmation: boolean;
  error?: string;
  recentTools: Array<{ name: string; status: string; result?: any }>;
  history: Array<{ id: string; role: string; content: string }>;
  currentAction?: string;
  run: (task: string) => Promise<void>;
  respond: (response: string) => Promise<void>;
  reset: () => void;
  stop: () => void;
}

interface ServerMessage {
  type: string;
  sessionId: string;
  timestamp: number;
  data: any;
}

export function useWebSocketAgent(options: WebSocketAgentOptions = {}): WebSocketAgentReturn {
  const { serverUrl = 'ws://127.0.0.1:3000/api/v1/ws/chat', onEvent } = options;

  const [status, setStatus] = React.useState<'idle' | 'thinking' | 'waiting' | 'completed' | 'error'>('idle');
  const [todos, setTodos] = React.useState<ExpandableTodoItem[]>([]);
  const [output, setOutput] = React.useState('');
  const [streamingText, setStreamingText] = React.useState('');
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [question, setQuestion] = React.useState<string | undefined>();
  const [isConfirmation, setIsConfirmation] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [recentTools, setRecentTools] = React.useState<Array<{ name: string; status: string; result?: any }>>([]);
  const [history, setHistory] = React.useState<Array<{ id: string; role: string; content: string }>>([]);
  const [currentAction, setCurrentAction] = React.useState<string | undefined>();

  const wsRef = React.useRef<WebSocket | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);

  // Connect to WebSocket
  React.useEffect(() => {
    const ws = new WebSocket(serverUrl);
    wsRef.current = ws;

    ws.on('open', () => {
      console.log('✓ Connected to server');
    });

    ws.on('message', (data) => {
      try {
        const msg: ServerMessage = JSON.parse(data.toString());
        sessionIdRef.current = msg.sessionId;
        handleMessage(msg);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    });

    ws.on('close', () => {
      console.log('Disconnected from server');
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      setError(err.message);
      setStatus('error');
    });

    return () => {
      ws.close();
    };
  }, [serverUrl]);

  const handleMessage = (msg: ServerMessage) => {
    if (onEvent) {
      onEvent(msg);
    }

    switch (msg.type) {
      case 'status': {
        const statusData = msg.data as { status: string; message?: string };
        if (statusData.status === 'busy' || statusData.status === 'processing') {
          setStatus('thinking');
        } else if (statusData.status === 'completed') {
          setStatus('completed');
          setIsStreaming(false);
        } else if (statusData.status === 'error') {
          setStatus('error');
          setError(statusData.message);
          setIsStreaming(false);
        }
        break;
      }

      case 'progress': {
        const progress = msg.data as { iteration: number; maxIterations: number };
        setCurrentAction(`Iteration ${progress.iteration}/${progress.maxIterations}`);
        break;
      }

      case 'stream_chunk': {
        const chunk = msg.data as { content: string; done?: boolean };
        if (chunk.done) {
          // Streaming finished - add accumulated text to history
          setStreamingText((currentText) => {
            const finalText = currentText + (chunk.content || '');
            if (finalText) {
              setHistory((prev) => [
                ...prev,
                {
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: finalText,
                  type: 'agent_text',
                } as any,
              ]);
            }
            return ''; // Clear streaming text
          });
          setIsStreaming(false);
        } else {
          // Continue accumulating streaming text
          setStreamingText((prev) => prev + chunk.content);
          setIsStreaming(true);
        }
        setStatus('thinking');
        break;
      }

      case 'agent_text': {
        const text = msg.data as { text: string; isFinal: boolean };
        if (text.isFinal) {
          setOutput((prev) => prev + '\n\n' + text.text);
          setStreamingText('');
          setIsStreaming(false);
        }
        break;
      }

      case 'tool_call': {
        const toolCall = msg.data as { toolName: string; arguments?: any };
        setCurrentAction(`🔧 ${toolCall.toolName}`);
        setRecentTools((prev) => [...prev, { name: toolCall.toolName, status: 'running' }]);
        break;
      }

      case 'tool_result': {
        const toolResult = msg.data as { toolName: string; result: any };
        setRecentTools((prev) =>
          prev.map((t) =>
            t.name === toolResult.toolName && t.status === 'running'
              ? { ...t, status: 'completed', result: toolResult.result }
              : t
          )
        );
        setCurrentAction(undefined);
        break;
      }

      case 'todo_update': {
        const todoData = msg.data as { todos: ExpandableTodoItem[] };
        setTodos(todoData.todos);
        break;
      }

      case 'agent_question': {
        const questionData = msg.data as { question: string; isConfirmation: boolean };
        setQuestion(questionData.question);
        setIsConfirmation(questionData.isConfirmation);
        setStatus('waiting');
        break;
      }

      case 'agent_response': {
        const response = msg.data as { output: string; status: string };
        setOutput(response.output);

        // Add agent's response to history so it's visible
        if (response.output) {
          setHistory((prev) => [
            ...prev,
            {
              id: Date.now().toString(),
              role: 'assistant',
              content: response.output,
              type: 'agent_text',
            } as any,
          ]);
        }

        if (response.status === 'completed') {
          setStatus('completed');
        }
        setStreamingText('');
        setIsStreaming(false);
        break;
      }

      case 'agent_status': {
        const agentStatus = msg.data as { status: string };
        if (agentStatus.status === 'started') {
          setStatus('thinking');
        } else if (agentStatus.status === 'completed') {
          setStatus('completed');
        }
        break;
      }

      case 'error': {
        const errorData = msg.data as { code: string; message: string };
        setError(`${errorData.code}: ${errorData.message}`);
        setStatus('error');
        setIsStreaming(false);
        break;
      }
    }
  };

  const run = React.useCallback(async (task: string) => {
    // Reset state
    setStatus('thinking');
    setOutput('');
    setStreamingText('');
    setIsStreaming(false);
    setError(undefined);
    setRecentTools([]);
    setTodos([]);
    setQuestion(undefined);

    // Add to history with id
    setHistory((prev) => [...prev, { id: Date.now().toString(), role: 'user', content: task }]);

    // Send task
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'start_task',
          data: { task },
        })
      );
    } else {
      setError('Not connected to server');
      setStatus('error');
    }
  }, []);

  const respond = React.useCallback(async (response: string) => {
    setQuestion(undefined);
    setStatus('thinking');

    // Add to history with id
    setHistory((prev) => [...prev, { id: Date.now().toString(), role: 'user', content: response }]);

    // Send response
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'user_response',
          data: { response },
        })
      );
    } else {
      setError('Not connected to server');
      setStatus('error');
    }
  }, []);

  const reset = React.useCallback(() => {
    setStatus('idle');
    setOutput('');
    setStreamingText('');
    setIsStreaming(false);
    setError(undefined);
    setRecentTools([]);
    setHistory([]);
    setTodos([]);
    setQuestion(undefined);
    setCurrentAction(undefined);
  }, []);

  const stop = React.useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel' }));
    }
    setStatus('idle');
  }, []);

  return {
    status,
    todos,
    output,
    streamingText,
    isStreaming,
    question,
    isConfirmation,
    error,
    recentTools,
    history,
    currentAction,
    run,
    respond,
    reset,
    stop,
  };
}

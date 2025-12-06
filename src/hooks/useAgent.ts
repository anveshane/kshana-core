/**
 * Hook for managing agent lifecycle.
 */
import React from 'react';
import { GenericAgent, type AgentConfig, type GenericAgentResult } from '../core/agent/index.js';
import { LLMClient, type LLMClientConfig, type ToolDefinition } from '../core/llm/index.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';
import type { AgentEvent } from '../events/index.js';

type AgentStatus = 'idle' | 'thinking' | 'waiting' | 'completed' | 'error';

interface UseAgentOptions {
  tools: Map<string, ToolDefinition>;
  llmConfig?: LLMClientConfig;
  agentConfig?: AgentConfig;
  onEvent?: (event: AgentEvent) => void;
}

export interface ToolCallHistoryItem {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error';
  result?: unknown;
  startTime: number;
  endTime?: number;
  duration?: number;
}

interface UseAgentReturn {
  status: AgentStatus;
  todos: ExpandableTodoItem[];
  output: string;
  question: string | undefined;
  isConfirmation: boolean;
  error: string | undefined;
  recentTools: ToolCallHistoryItem[];
  run: (task: string) => Promise<GenericAgentResult>;
  respond: (userInput: string) => Promise<GenericAgentResult>;
  reset: () => void;
  stop: () => void;
  injectInput: (input: string) => void;
}

// Configuration for tool display
const MAX_VISIBLE_TOOLS = 15;

export function useAgent(options: UseAgentOptions): UseAgentReturn {
  const { tools, llmConfig, agentConfig, onEvent } = options;

  const [status, setStatus] = React.useState<AgentStatus>('idle');
  const [todos, setTodos] = React.useState<ExpandableTodoItem[]>([]);
  const [output, setOutput] = React.useState('');
  const [question, setQuestion] = React.useState<string | undefined>();
  const [isConfirmation, setIsConfirmation] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [recentTools, setRecentTools] = React.useState<ToolCallHistoryItem[]>([]);

  const agentRef = React.useRef<GenericAgent | null>(null);
  const llmRef = React.useRef<LLMClient | null>(null);

  // Initialize LLM client
  const getLLM = React.useCallback(() => {
    if (!llmRef.current) {
      llmRef.current = new LLMClient(llmConfig);
    }
    return llmRef.current;
  }, [llmConfig]);

  // Create agent
  const createAgent = React.useCallback(() => {
    const llm = getLLM();
    const agent = new GenericAgent(tools, llm, agentConfig);

    // Subscribe to events
    agent.on('agent_status', event => {
      switch (event.status) {
        case 'started':
        case 'thinking':
          setStatus('thinking');
          break;
        case 'waiting':
          setStatus('waiting');
          break;
        case 'completed':
          setStatus('completed');
          break;
        case 'error':
          setStatus('error');
          break;
        case 'interrupted':
          // Keep status as idle so user can continue - context is preserved
          setStatus('idle');
          break;
      }
      onEvent?.(event);
    });

    agent.on('todo_update', event => {
      setTodos(event.todos);
      onEvent?.(event);
    });

    agent.on('agent_text', event => {
      // Accumulate all messages - append interim messages, set final as complete output
      setOutput(prev => {
        if (event.isFinal) {
          // Final message: if there's accumulated content, add it; otherwise just use final
          return prev ? `${prev}\n\n${event.text}` : event.text;
        }
        // Interim message: append to existing output
        return prev ? `${prev}\n\n${event.text}` : event.text;
      });
      onEvent?.(event);
    });

    agent.on('question', event => {
      setQuestion(event.question);
      setIsConfirmation(event.isConfirmation);
      onEvent?.(event);
    });

    agent.on('tool_call', event => {
      // Use LLM-provided tool call ID for proper matching
      setRecentTools(prev => {
        const newItem: ToolCallHistoryItem = {
          id: event.toolCallId,
          name: event.toolName,
          args: event.arguments,
          status: 'executing',
          startTime: Date.now(),
        };
        // Keep last N tools for visibility
        return [...prev.slice(-(MAX_VISIBLE_TOOLS - 1)), newItem];
      });
      onEvent?.(event);
    });

    agent.on('tool_result', event => {
      const endTime = Date.now();
      // Match by ID for proper association (not name!)
      setRecentTools(prev =>
        prev.map(tool => {
          if (tool.id === event.toolCallId) {
            const duration = endTime - tool.startTime;
            return {
              ...tool,
              status: event.isError ? 'error' : 'completed',
              result: event.result,
              endTime,
              duration,
            };
          }
          return tool;
        })
      );
      onEvent?.(event);
    });

    agentRef.current = agent;
    return agent;
  }, [tools, agentConfig, getLLM, onEvent]);

  // Run agent on a task
  const run = React.useCallback(
    async (task: string): Promise<GenericAgentResult> => {
      setStatus('thinking');
      setError(undefined);
      setQuestion(undefined);
      setIsConfirmation(false);
      setOutput(''); // Clear previous output when starting a new task

      const agent = createAgent();

      try {
        const result = await agent.run(task);

        setTodos(result.todos);
        // Output is accumulated via agent_text events, don't overwrite here

        if (result.status === 'waiting_for_user') {
          setStatus('waiting');
          setQuestion(result.pendingQuestion);
          setIsConfirmation(result.isConfirmation ?? false);
        } else if (result.status === 'completed') {
          setStatus('completed');
        } else if (result.status === 'error' || result.status === 'interrupted') {
          setStatus('error');
          setError(result.error);
        }

        return result;
      } catch (err) {
        setStatus('error');
        setError(String(err));
        return {
          status: 'error',
          output: '',
          todos: [],
          error: String(err),
        };
      }
    },
    [createAgent]
  );

  // Respond to agent question
  const respond = React.useCallback(
    async (userInput: string): Promise<GenericAgentResult> => {
      if (!agentRef.current) {
        return {
          status: 'error',
          output: '',
          todos: [],
          error: 'No agent running',
        };
      }

      setStatus('thinking');
      setQuestion(undefined);
      setIsConfirmation(false);

      try {
        const result = await agentRef.current.run('', userInput);

        setTodos(result.todos);
        // Output is accumulated via agent_text events, don't overwrite here

        if (result.status === 'waiting_for_user') {
          setStatus('waiting');
          setQuestion(result.pendingQuestion);
          setIsConfirmation(result.isConfirmation ?? false);
        } else if (result.status === 'completed') {
          setStatus('completed');
        } else if (result.status === 'error' || result.status === 'interrupted') {
          setStatus('error');
          setError(result.error);
        }

        return result;
      } catch (err) {
        setStatus('error');
        setError(String(err));
        return {
          status: 'error',
          output: '',
          todos: [],
          error: String(err),
        };
      }
    },
    []
  );

  // Reset agent state
  const reset = React.useCallback(() => {
    agentRef.current = null;
    setStatus('idle');
    setTodos([]);
    setOutput('');
    setQuestion(undefined);
    setIsConfirmation(false);
    setError(undefined);
    setRecentTools([]);
  }, []);

  // Stop agent execution (preserves context)
  const stop = React.useCallback(() => {
    if (agentRef.current) {
      agentRef.current.stop();
    }
  }, []);

  // Inject user input during execution
  const injectInput = React.useCallback((input: string) => {
    if (agentRef.current) {
      agentRef.current.injectInput(input);
    }
  }, []);

  return {
    status,
    todos,
    output,
    question,
    isConfirmation,
    error,
    recentTools,
    run,
    respond,
    reset,
    stop,
    injectInput,
  };
}

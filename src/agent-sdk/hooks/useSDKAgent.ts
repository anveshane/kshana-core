/**
 * useSDKAgent - React hook for the agent harness implementation.
 *
 * This hook provides the same interface as useAgent but uses the SDKAgent harness
 * with Claude Code SDK patterns and flexible LLM backend.
 */

import React from 'react';
import { SDKAgent } from '../SDKAgent.js';
import { agentReducer, initialState, type AgentState, type QuestionOption } from '../agentReducer.js';
import type { LLMClient, LLMClientConfig, ToolDefinition } from '../../core/llm/index.js';
import type { AgentConfig, GenericAgentResult } from '../../core/agent/AgentResult.js';
import type { AgentEvent } from '../../events/index.js';

interface UseSDKAgentOptions {
  tools: Map<string, ToolDefinition>;
  llmConfig?: LLMClientConfig;
  agentConfig?: AgentConfig;
  onEvent?: (event: AgentEvent) => void;
}

interface UseSDKAgentReturn {
  status: AgentState['status'];
  todos: AgentState['todos'];
  output: string;
  streamingText: string;
  isStreaming: boolean;
  question: string | undefined;
  isConfirmation: boolean;
  questionOptions: QuestionOption[] | undefined;
  autoApproveTimeoutMs: number | undefined;
  error: string | undefined;
  recentTools: AgentState['recentTools'];
  history: AgentState['history'];
  currentAction: AgentState['currentAction'];
  run: (task: string) => Promise<GenericAgentResult>;
  respond: (userInput: string) => Promise<GenericAgentResult>;
  reset: () => void;
  stop: () => void;
  injectInput: (input: string) => void;
}

export function useSDKAgent(options: UseSDKAgentOptions): UseSDKAgentReturn {
  const { tools, llmConfig, agentConfig, onEvent } = options;

  const [state, dispatch] = React.useReducer(agentReducer, initialState);
  const agentRef = React.useRef<SDKAgent | null>(null);
  const llmRef = React.useRef<LLMClient | null>(null);

  // Initialize LLM client
  const getLLM = React.useCallback(() => {
    if (!llmRef.current) {
      const { LLMClient } = require('../../core/llm/index.js');
      llmRef.current = new LLMClient(llmConfig);
    }
    return llmRef.current;
  }, [llmConfig]);

  // Create agent
  const createAgent = React.useCallback(() => {
    const llm = getLLM();
    const agent = new SDKAgent(llm, tools, agentConfig);
    const adapter = agent.getAdapter();

    // Subscribe to adapter events (same as useAgent)
    adapter.on('agent_status', event => {
      switch (event.status) {
        case 'started':
        case 'thinking':
          dispatch({ type: 'SET_THINKING', agentName: event.agentName });
          break;
        case 'waiting':
          break;
        case 'completed':
          dispatch({ type: 'SET_STATUS', status: 'completed', agentName: event.agentName });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
        case 'error':
          dispatch({ type: 'SET_STATUS', status: 'error', agentName: event.agentName });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
        case 'interrupted':
          dispatch({ type: 'SET_STATUS', status: 'idle', agentName: event.agentName });
          dispatch({ type: 'CLEAR_CURRENT_ACTION' });
          break;
      }
      onEvent?.(event);
    });

    adapter.on('todo_update', event => {
      dispatch({ type: 'SET_TODOS', todos: event.todos });
      onEvent?.(event);
    });

    adapter.on('agent_text', event => {
      if (event.text) {
        dispatch({ type: 'ADD_AGENT_TEXT', text: event.text });
      }
      onEvent?.(event);
    });

    adapter.on('streaming_text', event => {
      if (event.done) {
        dispatch({ type: 'STREAM_DONE', skipHistory: (event as any).skipHistory });
      } else if (event.chunk) {
        dispatch({ type: 'STREAM_CHUNK', chunk: event.chunk });
      }
      onEvent?.(event);
    });

    adapter.on('question', event => {
      dispatch({
        type: 'SET_QUESTION',
        question: event.question,
        isConfirmation: event.isConfirmation,
        options: event.options,
        autoApproveTimeoutMs: event.autoApproveTimeoutMs,
      });
      onEvent?.(event);
    });

    adapter.on('tool_call', event => {
      dispatch({
        type: 'TOOL_START',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.arguments,
        agentName: event.agentName,
      });
      onEvent?.(event);
    });

    adapter.on('tool_result', event => {
      dispatch({
        type: 'TOOL_COMPLETE',
        toolCallId: event.toolCallId,
        result: event.result,
        isError: event.isError ?? false,
        agentName: event.agentName,
      });
      onEvent?.(event);
    });

    adapter.on('tool_streaming', event => {
      dispatch({
        type: 'TOOL_STREAM',
        toolCallId: event.toolCallId,
        chunk: event.chunk,
        done: event.done,
      });
      onEvent?.(event);
    });

    agentRef.current = agent;
    return agent;
  }, [tools, agentConfig, getLLM, onEvent]);

  // Run agent on a task
  const run = React.useCallback(
    async (task: string): Promise<GenericAgentResult> => {
      dispatch({ type: 'START_TASK', task });

      const agent = createAgent();

      try {
        await agent.initialize();
        const result = await agent.run(task);

        dispatch({ type: 'SET_TODOS', todos: result.todos });

        if (result.status === 'waiting_for_user') {
          dispatch({
            type: 'SET_QUESTION',
            question: result.pendingQuestion ?? '',
            isConfirmation: result.isConfirmation ?? false,
            options: result.options,
            autoApproveTimeoutMs: result.autoApproveTimeoutMs,
          });
        } else if (result.status === 'completed') {
          dispatch({ type: 'SET_STATUS', status: 'completed' });
        } else if (result.status === 'error' || result.status === 'interrupted') {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Unknown error' });
        }

        return result;
      } catch (err) {
        dispatch({ type: 'SET_ERROR', error: String(err) });
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

      dispatch({ type: 'ADD_USER_INPUT', text: userInput });
      dispatch({ type: 'SET_THINKING' });
      dispatch({ type: 'CLEAR_QUESTION' });

      try {
        const result = await agentRef.current.run('', userInput);

        dispatch({ type: 'SET_TODOS', todos: result.todos });

        if (result.status === 'waiting_for_user') {
          dispatch({
            type: 'SET_QUESTION',
            question: result.pendingQuestion ?? '',
            isConfirmation: result.isConfirmation ?? false,
            options: result.options,
            autoApproveTimeoutMs: result.autoApproveTimeoutMs,
          });
        } else if (result.status === 'completed') {
          dispatch({ type: 'SET_STATUS', status: 'completed' });
        } else if (result.status === 'error' || result.status === 'interrupted') {
          dispatch({ type: 'SET_ERROR', error: result.error ?? 'Unknown error' });
        }

        return result;
      } catch (err) {
        dispatch({ type: 'SET_ERROR', error: String(err) });
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
    dispatch({ type: 'RESET' });
  }, []);

  // Stop agent execution
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
    status: state.status,
    todos: state.todos,
    output: state.output,
    streamingText: state.streamingText,
    isStreaming: state.isStreaming,
    question: state.question,
    isConfirmation: state.isConfirmation,
    questionOptions: state.questionOptions,
    autoApproveTimeoutMs: state.autoApproveTimeoutMs,
    error: state.error,
    recentTools: state.recentTools,
    history: state.history,
    currentAction: state.currentAction,
    run,
    respond,
    reset,
    stop,
    injectInput,
  };
}

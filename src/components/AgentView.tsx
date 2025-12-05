/**
 * Main agent interaction view component.
 */
import React from 'react';
import { Text, Box } from 'ink';
import { StatusBar } from './StatusBar.js';
import { TodoList } from './TodoList.js';
import { StreamingText } from './StreamingText.js';
import { ToolCallDisplay, HIDDEN_TOOLS } from './ToolCallDisplay.js';
import { UserInput } from './UserInput.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';

type AgentStatus = 'idle' | 'thinking' | 'waiting' | 'completed' | 'error';

interface ToolHistoryItem {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: 'executing' | 'completed' | 'error';
  result?: unknown;
  startTime: number;
  endTime?: number;
  duration?: number;
}

interface AgentViewProps {
  agentName?: string;
  status: AgentStatus;
  statusMessage?: string;
  todos: ExpandableTodoItem[];
  streamingText?: string;
  isStreaming?: boolean;
  recentTools?: ToolHistoryItem[];
  question?: string;
  isConfirmation?: boolean;
  onUserInput?: (input: string) => void;
  showTodos?: boolean;
}

export function AgentView({
  agentName = 'Agent',
  status,
  statusMessage,
  todos,
  streamingText,
  isStreaming = false,
  recentTools = [],
  question,
  isConfirmation = false,
  onUserInput,
  showTodos = true,
}: AgentViewProps) {
  return (
    <Box flexDirection="column" padding={1}>
      {/* Status Bar */}
      <StatusBar agentName={agentName} status={status} message={statusMessage} />

      {/* Todo List */}
      {showTodos && todos.length > 0 && (
        <Box marginBottom={1}>
          <TodoList todos={todos} compact />
        </Box>
      )}

      {/* Tool Calls - shows each tool call with live status updates */}
      {/* Filter out hidden tools (like todo_write which is already shown in TodoList) */}
      {recentTools.filter(tool => !HIDDEN_TOOLS.has(tool.name)).length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {recentTools
            .filter(tool => !HIDDEN_TOOLS.has(tool.name))
            .map((tool) => (
              <ToolCallDisplay
                key={tool.id}
                toolName={tool.name}
                args={tool.args}
                status={tool.status}
                result={tool.result}
                duration={tool.duration}
                compact
              />
            ))}
        </Box>
      )}

      {/* Streaming Text Output */}
      {(streamingText ?? isStreaming) && (
        <Box marginY={1}>
          <StreamingText text={streamingText ?? ''} isStreaming={isStreaming} />
        </Box>
      )}

      {/* Question/Prompt */}
      {question && status === 'waiting' && (
        <Box flexDirection="column" marginY={1}>
          <Box marginBottom={1}>
            <Text color="cyan" bold>
              {isConfirmation ? '?' : '>'}
            </Text>
            <Text> {question}</Text>
          </Box>
          {onUserInput && (
            <UserInput
              prompt={isConfirmation ? 'Confirm' : '>'}
              onSubmit={onUserInput}
              isConfirmation={isConfirmation}
            />
          )}
        </Box>
      )}

      {/* Completed Message */}
      {status === 'completed' && !question && (
        <Box marginTop={1}>
          <Text color="green" bold>
            ✓ Task completed
          </Text>
        </Box>
      )}

      {/* Error State */}
      {status === 'error' && (
        <Box marginTop={1}>
          <Text color="red" bold>
            ✗ Error occurred
          </Text>
          {statusMessage && (
            <Text color="red" dimColor>
              {' '}
              - {statusMessage}
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}

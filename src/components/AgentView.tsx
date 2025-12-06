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
import { Spinner } from './Spinner.js';
import type { ExpandableTodoItem } from '../core/todo/index.js';
import type { HistoryEntry, CurrentAction } from '../hooks/useAgent.js';

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

export interface ConversationMessage {
  id: string;
  type: 'user' | 'agent' | 'task';
  content: string;
  timestamp: number;
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
  conversationHistory?: ConversationMessage[];
  // New: separated history and current action
  history?: HistoryEntry[];
  currentAction?: CurrentAction | null;
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
  conversationHistory = [],
  history = [],
  currentAction = null,
}: AgentViewProps) {
  // Filter history to only show completed tools (not hidden ones)
  const visibleHistory = history.filter(entry => {
    if (entry.type === 'tool_completed' && entry.toolName) {
      return !HIDDEN_TOOLS.has(entry.toolName);
    }
    return true;
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* Status Bar */}
      <StatusBar agentName={agentName} status={status} message={statusMessage} />

      {/* Conversation History - show user inputs (from conversationHistory) */}
      {conversationHistory.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {conversationHistory.map((msg) => (
            <Box key={msg.id} marginBottom={1}>
              {msg.type === 'task' && (
                <Box
                  borderStyle="round"
                  borderColor="green"
                  paddingX={1}
                >
                  <Text color="green" bold>📌 Task: </Text>
                  <Text>{msg.content}</Text>
                </Box>
              )}
              {msg.type === 'user' && (
                <Box
                  borderStyle="round"
                  borderColor="green"
                  paddingX={1}
                >
                  <Text color="green" bold>👤 You: </Text>
                  <Text>{msg.content}</Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Todo List */}
      {showTodos && todos.length > 0 && (
        <Box marginBottom={1}>
          <TodoList todos={todos} compact />
        </Box>
      )}

      {/* HISTORY: Completed actions (permanent) */}
      {visibleHistory.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {visibleHistory.map((entry) => {
            if (entry.type === 'tool_completed' && entry.toolName) {
              return (
                <ToolCallDisplay
                  key={entry.id}
                  toolName={entry.toolName}
                  args={entry.toolArgs}
                  status="completed"
                  result={entry.toolResult}
                  duration={entry.duration}
                  compact
                />
              );
            }
            if (entry.type === 'agent_text') {
              return (
                <Box key={entry.id} marginBottom={1}>
                  <Text dimColor>{entry.content}</Text>
                </Box>
              );
            }
            return null;
          })}
        </Box>
      )}

      {/* CURRENT ACTION: What agent is doing now (ephemeral) */}
      {currentAction && (
        <Box flexDirection="column" marginBottom={1}>
          {currentAction.type === 'thinking' && (
            <Box>
              <Spinner color="yellow" label="💭 Thinking..." />
            </Box>
          )}
          {currentAction.type === 'tool_executing' && currentAction.toolName && (
            <ToolCallDisplay
              toolName={currentAction.toolName}
              args={currentAction.toolArgs}
              status="executing"
              compact
            />
          )}
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

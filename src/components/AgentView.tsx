/**
 * Main agent interaction view component.
 * Simplified layout with scrollable history and reduced re-renders.
 */
import React from 'react';
import { Text, Box } from 'ink';
import { StatusBar } from './StatusBar.js';
import { TodoList } from './TodoList.js';
import { StreamingText } from './StreamingText.js';
import { ToolCallDisplay } from './ToolCallDisplay.js';
import { ScrollableHistory } from './ScrollableHistory.js';
import { UserInput } from './UserInput.js';
import { QuestionPrompt } from './QuestionPrompt.js';
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

/**
 * Option for multiple choice questions.
 */
export interface QuestionOption {
  label: string;
  description?: string;
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
  questionOptions?: QuestionOption[];
  onUserInput?: (input: string) => void;
  showTodos?: boolean;
  conversationHistory?: ConversationMessage[];
  history?: HistoryEntry[];
  currentAction?: CurrentAction | null;
  maxHeight?: number;
  expanded?: boolean;
}

// Maximum visible history items to prevent overflow
const MAX_VISIBLE_HISTORY = 10;

// Memoized conversation message to reduce re-renders
const MemoizedConversationMessage = React.memo(function ConversationMessage({
  msg,
}: {
  msg: ConversationMessage;
}) {
  if (msg.type === 'task') {
    return (
      <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
        <Text color="green" bold>📌 Task: </Text>
        <Text wrap="wrap">{msg.content}</Text>
      </Box>
    );
  }
  if (msg.type === 'user') {
    return (
      <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
        <Text color="green" bold>👤 You: </Text>
        <Text wrap="wrap">{msg.content}</Text>
      </Box>
    );
  }
  return null;
});

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
  questionOptions,
  onUserInput,
  showTodos = true,
  conversationHistory = [],
  history = [],
  currentAction = null,
  maxHeight,
  expanded = false,
}: AgentViewProps) {
  // Determine if scroll is enabled (when agent is idle, completed, or waiting)
  const scrollEnabled = status === 'idle' || status === 'completed' || status === 'waiting';

  // Only show the most recent conversation message
  const recentConversation = conversationHistory.slice(-1);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Status Bar */}
      <StatusBar agentName={agentName} status={status} message={statusMessage} />

      {/* Todo List */}
      {showTodos && todos.length > 0 && (
        <Box marginBottom={1}>
          <TodoList todos={todos} compact />
        </Box>
      )}

      {/* Recent Task/User Message */}
      {recentConversation.map((msg) => (
        <Box key={msg.id} marginBottom={1}>
          <MemoizedConversationMessage msg={msg} />
        </Box>
      ))}

      {/* Scrollable History */}
      <ScrollableHistory
        history={history}
        maxVisible={MAX_VISIBLE_HISTORY}
        expanded={expanded}
        scrollEnabled={scrollEnabled}
      />

      {/* Current Action */}
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
              expanded={expanded}
            />
          )}
        </Box>
      )}

      {/* Streaming Text */}
      {(streamingText ?? isStreaming) && (
        <Box marginY={1}>
          <StreamingText text={streamingText ?? ''} isStreaming={isStreaming} />
        </Box>
      )}

      {/* Question - with options or free-form */}
      {question && status === 'waiting' && onUserInput && (
        questionOptions && questionOptions.length > 0 ? (
          <QuestionPrompt
            question={question}
            options={questionOptions}
            isConfirmation={isConfirmation}
            onSelect={onUserInput}
          />
        ) : isConfirmation ? (
          <QuestionPrompt
            question={question}
            isConfirmation={true}
            onSelect={onUserInput}
          />
        ) : (
          <Box flexDirection="column" marginY={1}>
            <Box marginBottom={1}>
              <Text color="cyan" bold>?</Text>
              <Text> {question}</Text>
            </Box>
            <UserInput
              prompt=">"
              onSubmit={onUserInput}
              isConfirmation={false}
            />
          </Box>
        )
      )}

      {/* Completed */}
      {status === 'completed' && !question && (
        <Box marginTop={1}>
          <Text color="green" bold>✓ Task completed</Text>
        </Box>
      )}

      {/* Error */}
      {status === 'error' && (
        <Box marginTop={1}>
          <Text color="red" bold>✗ Error occurred</Text>
          {statusMessage && <Text color="red" dimColor> - {statusMessage}</Text>}
        </Box>
      )}
    </Box>
  );
}

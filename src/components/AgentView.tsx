/**
 * Main agent interaction view component.
 * Simplified layout with scrollable history and reduced re-renders.
 */
import React from 'react';
import { Text, Box } from 'ink';
import { StatusBar } from './StatusBar.js';
import { TodoList } from './TodoList.js';
import { MarkdownText } from './MarkdownText.js';
import { ToolCallDisplay } from './ToolCallDisplay.js';
import { ScrollableHistory } from './ScrollableHistory.js';
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
  /** Currently selected option index for display */
  selectedOptionIndex?: number;
  showTodos?: boolean;
  history?: HistoryEntry[];
  currentAction?: CurrentAction | null;
  maxHeight?: number;
  expanded?: boolean;
}

// Maximum visible history items to prevent overflow
const MAX_VISIBLE_HISTORY = 10;

export function AgentView({
  agentName = 'Agent',
  status,
  statusMessage,
  todos,
  streamingText,
  isStreaming = false,
  question,
  isConfirmation = false,
  questionOptions,
  selectedOptionIndex = 0,
  showTodos = true,
  history = [],
  currentAction = null,
  expanded = false,
}: AgentViewProps) {
  // Determine if scroll is enabled (when agent is idle, completed, or waiting)
  const scrollEnabled = status === 'idle' || status === 'completed' || status === 'waiting';

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Status Bar */}
      <StatusBar agentName={agentName} status={status} message={statusMessage} />

      {/* Scrollable History (includes user messages, tool calls, agent text) */}
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

      {/* Streaming Text with Markdown rendering */}
      {(streamingText ?? isStreaming) && (
        <Box marginY={1}>
          <MarkdownText text={streamingText ?? ''} isStreaming={isStreaming} />
        </Box>
      )}

      {/* Question Display - input is handled by UnifiedInput in App.tsx */}
      {question && status === 'waiting' && (
        <QuestionPrompt
          question={question}
          options={questionOptions}
          isConfirmation={isConfirmation}
          selectedIndex={selectedOptionIndex}
        />
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

      {/* Todo List - at bottom, just above input */}
      {showTodos && todos.length > 0 && (
        <Box marginTop={1}>
          <TodoList todos={todos} compact />
        </Box>
      )}
    </Box>
  );
}

/**
 * Todo list component with hierarchical display.
 */
import React from 'react';
import { Text, Box } from 'ink';
import type { ExpandableTodoItem, TodoStatus } from '../core/todo/index.js';

interface TodoListProps {
  todos: ExpandableTodoItem[];
  showHidden?: boolean;
  compact?: boolean;
}

const STATUS_ICONS: Record<TodoStatus, { icon: string; color: string }> = {
  pending: { icon: '○', color: 'gray' },
  in_progress: { icon: '●', color: 'yellow' },
  completed: { icon: '✓', color: 'green' },
  cancelled: { icon: '⨯', color: 'gray' },
  expanded: { icon: '↳', color: 'blue' },
};

const TodoItem = React.memo(function TodoItem({
  todo,
  index,
  compact,
}: {
  todo: ExpandableTodoItem;
  index: number;
  compact?: boolean;
}) {
  const statusConfig = STATUS_ICONS[todo.status];
  const indent = '  '.repeat(todo.depth);

  if (compact) {
    return (
      <Box>
        <Text color={statusConfig.color}>{statusConfig.icon}</Text>
        <Text dimColor={todo.status === 'pending'}> {todo.content}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text dimColor>{String(index + 1).padStart(2, ' ')}. </Text>
      <Text>{indent}</Text>
      <Text color={statusConfig.color}>{statusConfig.icon}</Text>
      <Text dimColor={todo.status === 'pending' || todo.status === 'expanded'}>
        {' '}
        {todo.content}
      </Text>
    </Box>
  );
});

export const TodoList = React.memo(function TodoList({
  todos,
  showHidden = false,
  compact = false,
}: TodoListProps) {
  // Always show ALL todos - never truncate per CLAUDE.md instructions
  const visibleTodos = showHidden ? todos : todos.filter(t => t.visible);

  // Count stats for display
  const completedCount = visibleTodos.filter(t => t.status === 'completed').length;
  const pendingCount = visibleTodos.filter(t => t.status === 'pending').length;
  const inProgressCount = visibleTodos.filter(t => t.status === 'in_progress').length;

  // Hide the list when empty or when all todos are completed
  if (visibleTodos.length === 0) {
    return null;
  }

  // All todos completed - hide the list
  if (completedCount === visibleTodos.length && visibleTodos.length > 0) {
    return null;
  }

  // Find current task for highlighting
  const currentTask = visibleTodos.find(t => t.status === 'in_progress');

  return (
    <Box flexDirection="column">
      {/* Header with count */}
      <Box marginBottom={compact ? 0 : 1}>
        <Text bold color="cyan">
          📋 Todos ({completedCount}/{visibleTodos.length})
        </Text>
        {inProgressCount > 0 && (
          <Text color="yellow"> • {inProgressCount} in progress</Text>
        )}
        {pendingCount > 0 && (
          <Text dimColor> • {pendingCount} pending</Text>
        )}
      </Box>
      {!compact && currentTask && (
        <Box marginBottom={1}>
          <Text dimColor>
            Working on: {currentTask.content}
          </Text>
        </Box>
      )}
      {/* Render ALL todos - no limit */}
      {visibleTodos.map((todo, i) => (
        <TodoItem key={todo.id} todo={todo} index={i} compact={compact} />
      ))}
    </Box>
  );
});

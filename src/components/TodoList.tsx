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
  const visibleTodos = showHidden ? todos : todos.filter(t => t.visible);

  if (visibleTodos.length === 0) {
    return (
      <Box>
        <Text dimColor italic>
          No todos
        </Text>
      </Box>
    );
  }

  // Find current task for highlighting
  const currentTask = visibleTodos.find(t => t.status === 'in_progress');

  return (
    <Box flexDirection="column">
      {!compact && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Todo List
          </Text>
          {currentTask && (
            <Text dimColor>
              {' '}
              - Working on: {currentTask.content}
            </Text>
          )}
        </Box>
      )}
      {visibleTodos.map((todo, i) => (
        <TodoItem key={todo.id} todo={todo} index={i} compact={compact} />
      ))}
    </Box>
  );
});

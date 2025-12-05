/**
 * Hook for managing todo state.
 */
import React from 'react';
import type { ExpandableTodoItem } from '../core/todo/index.js';

interface UseTodosReturn {
  todos: ExpandableTodoItem[];
  setTodos: (todos: ExpandableTodoItem[]) => void;
  currentTask: ExpandableTodoItem | undefined;
  completedCount: number;
  totalCount: number;
  progress: number;
}

export function useTodos(initialTodos: ExpandableTodoItem[] = []): UseTodosReturn {
  const [todos, setTodos] = React.useState<ExpandableTodoItem[]>(initialTodos);

  const currentTask = React.useMemo(
    () => todos.find(t => t.status === 'in_progress'),
    [todos]
  );

  const completedCount = React.useMemo(
    () => todos.filter(t => t.status === 'completed').length,
    [todos]
  );

  const totalCount = todos.length;

  const progress = React.useMemo(
    () => (totalCount > 0 ? (completedCount / totalCount) * 100 : 0),
    [completedCount, totalCount]
  );

  return {
    todos,
    setTodos,
    currentTask,
    completedCount,
    totalCount,
    progress,
  };
}

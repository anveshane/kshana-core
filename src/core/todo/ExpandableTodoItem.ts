/**
 * Todo item types for hierarchical task management.
 */
import { nanoid } from 'nanoid';

/**
 * Status of a todo item.
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'expanded';

/**
 * A todo item that can be expanded into sub-todos.
 */
export interface ExpandableTodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  visible: boolean;
  depth: number;
}

/**
 * Result from todo manager operations.
 */
export interface TodoManagerResult {
  status: 'success' | 'error';
  message: string;
  todos: ExpandableTodoItem[];
  error?: string;
}

/**
 * Create a new todo item with defaults.
 */
export function createTodoItem(
  content: string,
  options: Partial<Omit<ExpandableTodoItem, 'id' | 'content'>> = {}
): ExpandableTodoItem {
  return {
    id: nanoid(8),
    content,
    status: options.status ?? 'pending',
    visible: options.visible ?? true,
    depth: options.depth ?? 0,
  };
}

/**
 * Serialize a todo item to a plain object.
 */
export function todoToDict(todo: ExpandableTodoItem): Record<string, unknown> {
  return {
    id: todo.id,
    content: todo.content,
    status: todo.status,
    visible: todo.visible,
    depth: todo.depth,
  };
}

/**
 * Deserialize a todo item from a plain object.
 */
export function todoFromDict(data: Record<string, unknown>): ExpandableTodoItem {
  return {
    id: (data['id'] as string | undefined) ?? nanoid(8),
    content: (data['content'] as string | undefined) ?? '',
    status: (data['status'] as TodoStatus | undefined) ?? 'pending',
    visible: (data['visible'] as boolean | undefined) ?? true,
    depth: (data['depth'] as number | undefined) ?? 0,
  };
}

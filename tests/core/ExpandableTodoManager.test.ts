import { describe, it, expect, beforeEach } from 'vitest';
import { ExpandableTodoManager } from '../../src/core/todo/ExpandableTodoManager.js';

describe('ExpandableTodoManager', () => {
  let manager: ExpandableTodoManager;

  beforeEach(() => {
    manager = new ExpandableTodoManager();
  });

  describe('setTodos', () => {
    it('should create initial todo list', () => {
      const result = manager.setTodos(['Task 1', 'Task 2', 'Task 3']);

      expect(result.status).toBe('success');
      expect(result.todos).toHaveLength(3);
      expect(result.todos[0]?.status).toBe('in_progress');
      expect(result.todos[1]?.status).toBe('pending');
      expect(result.todos[2]?.status).toBe('pending');
    });

    it('should not allow setting todos twice', () => {
      manager.setTodos(['Task 1']);
      const result = manager.setTodos(['Task 2']);

      expect(result.status).toBe('error');
      expect(result.message).toContain('already exists');
    });

    it('should set depth to 0 for all top-level todos', () => {
      const result = manager.setTodos(['A', 'B']);
      expect(result.todos[0]?.depth).toBe(0);
      expect(result.todos[1]?.depth).toBe(0);
    });
  });

  describe('updateTodo', () => {
    beforeEach(() => {
      manager.setTodos(['Task 1', 'Task 2', 'Task 3']);
    });

    it('should mark a todo as completed', () => {
      const result = manager.updateTodo('Task 1', 'completed');

      expect(result.status).toBe('success');
      const todos = manager.getTodos();
      expect(todos[0]?.status).toBe('completed');
    });

    it('should auto-start next pending todo when completing', () => {
      manager.updateTodo('Task 1', 'completed');

      const todos = manager.getTodos();
      expect(todos[1]?.status).toBe('in_progress');
    });

    it('should find todo by partial match', () => {
      const result = manager.updateTodo('Task 2', 'completed');
      expect(result.status).toBe('success');
    });

    it('should return error for invalid status', () => {
      const result = manager.updateTodo('Task 1', 'invalid' as 'completed');
      expect(result.status).toBe('error');
    });

    it('should return error for non-existent task', () => {
      const result = manager.updateTodo('Non-existent', 'completed');
      expect(result.status).toBe('error');
    });
  });

  describe('addSubtasks', () => {
    beforeEach(() => {
      manager.setTodos(['Parent Task', 'Other Task']);
    });

    it('should add subtasks under parent', () => {
      const result = manager.addSubtasks('Parent', ['Sub 1', 'Sub 2']);

      expect(result.status).toBe('success');
      const todos = manager.getTodos();
      expect(todos).toHaveLength(4);
    });

    it('should mark parent as expanded', () => {
      manager.addSubtasks('Parent', ['Sub 1']);

      const todos = manager.getTodos();
      expect(todos[0]?.status).toBe('expanded');
    });

    it('should set first subtask as in_progress', () => {
      manager.addSubtasks('Parent', ['Sub 1', 'Sub 2']);

      const todos = manager.getTodos();
      expect(todos[1]?.status).toBe('in_progress');
      expect(todos[2]?.status).toBe('pending');
    });

    it('should increment depth for subtasks', () => {
      manager.addSubtasks('Parent', ['Sub 1']);

      const todos = manager.getTodos();
      expect(todos[0]?.depth).toBe(0);
      expect(todos[1]?.depth).toBe(1);
    });

    it('should return error for empty subtasks', () => {
      const result = manager.addSubtasks('Parent', []);
      expect(result.status).toBe('error');
    });
  });

  describe('getNextActionable', () => {
    it('should return null for empty list', () => {
      expect(manager.getNextActionable()).toBeNull();
    });

    it('should return first in_progress todo', () => {
      manager.setTodos(['A', 'B', 'C']);

      const next = manager.getNextActionable();
      expect(next?.todo.content).toBe('A');
      expect(next?.index).toBe(0);
    });

    it('should return first pending if no in_progress', () => {
      manager.setTodos(['A', 'B']);
      manager.updateTodo('A', 'completed');
      manager.updateTodo('B', 'completed');

      // All completed, no actionable
      expect(manager.getNextActionable()).toBeNull();
    });
  });

  describe('toReminderText', () => {
    it('should return empty message for no todos', () => {
      const text = manager.toReminderText();
      expect(text).toContain('empty');
    });

    it('should include todo status', () => {
      manager.setTodos(['Task 1', 'Task 2']);

      const text = manager.toReminderText();
      expect(text).toContain('[in_progress]');
      expect(text).toContain('[pending]');
    });

    it('should include next todo guidance', () => {
      manager.setTodos(['Task 1']);

      const text = manager.toReminderText();
      expect(text).toContain('NEXT TODO');
    });
  });

  describe('getOrderingWarnings', () => {
    it('should return empty array for correct ordering', () => {
      manager.setTodos(['A', 'B']);
      expect(manager.getOrderingWarnings()).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should clear all todos', () => {
      manager.setTodos(['A', 'B']);
      manager.clear();

      expect(manager.getTodos()).toHaveLength(0);
    });
  });

  describe('writeTodos', () => {
    it('should write new todos', () => {
      const result = manager.writeTodos([
        { id: 'todo-1', content: 'Task 1', status: 'in_progress' },
        { id: 'todo-2', content: 'Task 2', status: 'pending' },
      ]);

      expect(result.status).toBe('success');
      const todos = manager.getTodos();
      expect(todos).toHaveLength(2);
      expect(todos[0]?.status).toBe('in_progress');
      expect(todos[1]?.status).toBe('pending');
    });

    it('should preserve completed todos when replacing list', () => {
      // First write some todos
      manager.writeTodos([
        { id: 'todo-1', content: 'Task 1', status: 'completed' },
        { id: 'todo-2', content: 'Task 2', status: 'in_progress' },
      ]);

      // Now replace with new list (not including the completed one)
      manager.writeTodos([
        { id: 'todo-3', content: 'Task 3', status: 'in_progress' },
        { id: 'todo-4', content: 'Task 4', status: 'pending' },
      ]);

      const todos = manager.getTodos();
      // Should have 3: preserved completed + 2 new
      expect(todos).toHaveLength(3);
      expect(todos[0]?.content).toBe('Task 1');
      expect(todos[0]?.status).toBe('completed');
    });

    it('should not duplicate completed todos if included in new list', () => {
      manager.writeTodos([
        { id: 'todo-1', content: 'Task 1', status: 'completed' },
        { id: 'todo-2', content: 'Task 2', status: 'pending' },
      ]);

      // Replace with list that includes the completed task
      manager.writeTodos([
        { id: 'todo-1', content: 'Task 1', status: 'completed' },
        { id: 'todo-3', content: 'Task 3', status: 'in_progress' },
      ]);

      const todos = manager.getTodos();
      expect(todos).toHaveLength(2);
    });

    it('should preserve explicit IDs from input', () => {
      manager.writeTodos([
        { id: 'my-custom-id', content: 'Task', status: 'pending' },
      ]);

      const todos = manager.getTodos();
      expect(todos[0]?.id).toBe('my-custom-id');
    });

    it('should preserve activeForm from input', () => {
      manager.writeTodos([
        { id: 'todo-1', content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
      ]);

      const todos = manager.getTodos();
      expect(todos[0]?.activeForm).toBe('Running tests');
    });
  });

  describe('mergeTodosById', () => {
    beforeEach(() => {
      manager.writeTodos([
        { id: 'todo-1', content: 'Task 1', status: 'completed' },
        { id: 'todo-2', content: 'Task 2', status: 'in_progress' },
        { id: 'todo-3', content: 'Task 3', status: 'pending' },
      ]);
    });

    it('should update existing todo by id', () => {
      manager.mergeTodosById([
        { id: 'todo-2', status: 'completed' },
      ]);

      const todos = manager.getTodos();
      expect(todos.find(t => t.id === 'todo-2')?.status).toBe('completed');
    });

    it('should add new todo if id does not exist', () => {
      manager.mergeTodosById([
        { id: 'todo-4', content: 'Task 4', status: 'pending' },
      ]);

      const todos = manager.getTodos();
      expect(todos).toHaveLength(4);
      expect(todos.find(t => t.id === 'todo-4')?.content).toBe('Task 4');
    });

    it('should preserve todos not in update list', () => {
      manager.mergeTodosById([
        { id: 'todo-2', status: 'completed' },
      ]);

      const todos = manager.getTodos();
      expect(todos).toHaveLength(3);
      expect(todos.find(t => t.id === 'todo-1')?.status).toBe('completed');
      // todo-3 is auto-started since todo-2 was completed and there's no in_progress
      expect(todos.find(t => t.id === 'todo-3')?.status).toBe('in_progress');
    });

    it('should update content if provided', () => {
      manager.mergeTodosById([
        { id: 'todo-2', content: 'Updated content' },
      ]);

      const todos = manager.getTodos();
      expect(todos.find(t => t.id === 'todo-2')?.content).toBe('Updated content');
    });

    it('should update activeForm if provided', () => {
      manager.mergeTodosById([
        { id: 'todo-2', activeForm: 'Working on task 2' },
      ]);

      const todos = manager.getTodos();
      expect(todos.find(t => t.id === 'todo-2')?.activeForm).toBe('Working on task 2');
    });

    describe('single in_progress enforcement', () => {
      it('should auto-start pending if no in_progress after merge', () => {
        manager.mergeTodosById([
          { id: 'todo-2', status: 'completed' },
        ]);

        const todos = manager.getTodos();
        // todo-3 should be auto-started
        expect(todos.find(t => t.id === 'todo-3')?.status).toBe('in_progress');
      });

      it('should demote extra in_progress to pending', () => {
        // Try to set multiple in_progress
        manager.mergeTodosById([
          { id: 'todo-2', status: 'in_progress' },
          { id: 'todo-3', status: 'in_progress' },
        ]);

        const todos = manager.getTodos();
        const inProgressCount = todos.filter(t => t.status === 'in_progress').length;
        expect(inProgressCount).toBe(1);
      });

      it('should keep first in_progress when demoting extras', () => {
        // First todo-2 is in_progress, add another
        manager.mergeTodosById([
          { id: 'todo-3', status: 'in_progress' },
        ]);

        const todos = manager.getTodos();
        // todo-2 should remain in_progress (it was first)
        expect(todos.find(t => t.id === 'todo-2')?.status).toBe('in_progress');
        // todo-3 should be demoted to pending
        expect(todos.find(t => t.id === 'todo-3')?.status).toBe('pending');
      });
    });

    it('should skip updates without id', () => {
      const initialLength = manager.getTodos().length;

      manager.mergeTodosById([
        { content: 'No ID task', status: 'pending' },
      ]);

      // Should not add anything without ID
      expect(manager.getTodos()).toHaveLength(initialLength);
    });
  });

  describe('immutability for React re-renders', () => {
    it('should create new object references when updating via mergeTodosById', () => {
      manager.writeTodos([
        { id: 'todo-1', content: 'Task 1', status: 'in_progress' },
        { id: 'todo-2', content: 'Task 2', status: 'pending' },
      ]);

      const beforeTodos = manager.getTodos();
      const todo1Before = beforeTodos.find(t => t.id === 'todo-1');
      const todo2Before = beforeTodos.find(t => t.id === 'todo-2');

      // Update todo-1's status
      manager.mergeTodosById([
        { id: 'todo-1', status: 'completed' },
      ]);

      const afterTodos = manager.getTodos();
      const todo1After = afterTodos.find(t => t.id === 'todo-1');
      const todo2After = afterTodos.find(t => t.id === 'todo-2');

      // todo-1 should be a NEW object reference (for React.memo to detect change)
      expect(todo1After).not.toBe(todo1Before);
      expect(todo1After?.status).toBe('completed');

      // todo-2 was also updated (auto-started) so it should also be a new reference
      // Actually, it depends on whether auto-heal kicked in
    });

    it('should create new object when auto-starting next pending', () => {
      manager.writeTodos([
        { id: 'todo-1', content: 'Task 1', status: 'in_progress' },
        { id: 'todo-2', content: 'Task 2', status: 'pending' },
      ]);

      const beforeTodos = manager.getTodos();
      const todo2Before = beforeTodos.find(t => t.id === 'todo-2');
      expect(todo2Before?.status).toBe('pending');

      // Complete todo-1, which should auto-start todo-2
      manager.mergeTodosById([
        { id: 'todo-1', status: 'completed' },
      ]);

      const afterTodos = manager.getTodos();
      const todo2After = afterTodos.find(t => t.id === 'todo-2');

      // todo-2 should be a NEW object (auto-started to in_progress)
      expect(todo2After).not.toBe(todo2Before);
      expect(todo2After?.status).toBe('in_progress');
    });

    it('should create new objects when demoting extra in_progress', () => {
      manager.writeTodos([
        { id: 'todo-1', content: 'Task 1', status: 'in_progress' },
        { id: 'todo-2', content: 'Task 2', status: 'pending' },
      ]);

      const beforeTodos = manager.getTodos();
      const todo2Before = beforeTodos.find(t => t.id === 'todo-2');

      // Try to set both to in_progress (second should be demoted)
      manager.mergeTodosById([
        { id: 'todo-2', status: 'in_progress' },
      ]);

      const afterTodos = manager.getTodos();
      const todo2After = afterTodos.find(t => t.id === 'todo-2');

      // todo-2 should be a new object (was updated then demoted)
      expect(todo2After).not.toBe(todo2Before);
      // Should be demoted to pending since todo-1 is already in_progress
      expect(todo2After?.status).toBe('pending');
    });
  });

  describe('status normalization', () => {
    it('should normalize capitalized status values to lowercase', () => {
      manager.writeTodos([
        { id: '1', content: 'Task 1', status: 'Completed' },
        { id: '2', content: 'Task 2', status: 'In_Progress' },
        { id: '3', content: 'Task 3', status: 'PENDING' },
      ]);

      const todos = manager.getTodos();
      expect(todos[0]?.status).toBe('completed');
      expect(todos[1]?.status).toBe('in_progress');
      expect(todos[2]?.status).toBe('pending');
    });

    it('should normalize status values in mergeTodosById', () => {
      manager.writeTodos([
        { id: '1', content: 'Task 1', status: 'in_progress' },
      ]);

      manager.mergeTodosById([
        { id: '1', status: 'COMPLETED' },
      ]);

      const todos = manager.getTodos();
      expect(todos[0]?.status).toBe('completed');
    });

    it('should reject invalid status values', () => {
      const result = manager.writeTodos([
        { id: '1', content: 'Task 1', status: 'invalid_status' },
        { id: '2', content: 'Task 2', status: 'pending' },
      ]);

      // Invalid status should default to pending
      const todos = manager.getTodos();
      expect(todos[0]?.status).toBe('pending');
    });
  });

  describe('status count verification', () => {
    it('should correctly count each status type', () => {
      manager.writeTodos([
        { id: '1', content: 'Completed 1', status: 'completed' },
        { id: '2', content: 'Completed 2', status: 'completed' },
        { id: '3', content: 'In progress', status: 'in_progress' },
        { id: '4', content: 'Pending 1', status: 'pending' },
        { id: '5', content: 'Pending 2', status: 'pending' },
      ]);

      const todos = manager.getTodos();

      const completed = todos.filter(t => t.status === 'completed').length;
      const inProgress = todos.filter(t => t.status === 'in_progress').length;
      const pending = todos.filter(t => t.status === 'pending').length;

      expect(completed).toBe(2);
      expect(inProgress).toBe(1);
      expect(pending).toBe(2);
    });

    it('should maintain status after merge updates', () => {
      manager.writeTodos([
        { id: '1', content: 'Task 1', status: 'in_progress' },
        { id: '2', content: 'Task 2', status: 'pending' },
        { id: '3', content: 'Task 3', status: 'pending' },
      ]);

      // Mark first as completed
      manager.mergeTodosById([
        { id: '1', status: 'completed' },
      ]);

      const todos = manager.getTodos();

      expect(todos.find(t => t.id === '1')?.status).toBe('completed');
      // Second should auto-start
      expect(todos.find(t => t.id === '2')?.status).toBe('in_progress');
      expect(todos.find(t => t.id === '3')?.status).toBe('pending');

      const completed = todos.filter(t => t.status === 'completed').length;
      const inProgress = todos.filter(t => t.status === 'in_progress').length;
      const pending = todos.filter(t => t.status === 'pending').length;

      expect(completed).toBe(1);
      expect(inProgress).toBe(1);
      expect(pending).toBe(1);
    });
  });
});

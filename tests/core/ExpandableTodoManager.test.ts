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
});

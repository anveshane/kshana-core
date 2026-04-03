/**
 * Tests for TodoList component.
 * Verifies that todo display matches the underlying data correctly.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { TodoList } from '../../src/components/TodoList.js';
import type { ExpandableTodoItem } from '../../src/core/todo/index.js';

// Helper to create todo items
function createTodo(
  content: string,
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'expanded',
  id?: string
): ExpandableTodoItem {
  return {
    id: id ?? `todo-${Math.random().toString(36).slice(2, 9)}`,
    content,
    status,
    visible: true,
    depth: 0,
  };
}

describe('TodoList', () => {
  describe('status icons', () => {
    it('should render pending icon for pending todos', () => {
      const todos = [createTodo('Pending task', 'pending')];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('○');
      expect(lastFrame()).toContain('Pending task');
    });

    it('should render in_progress icon for in_progress todos', () => {
      const todos = [createTodo('Working on this', 'in_progress')];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('●');
      expect(lastFrame()).toContain('Working on this');
    });

    it('should render completed icon for completed todos', () => {
      // Component hides list when ALL todos are completed, so include a pending
      // todo to keep the list visible and verify the completed icon renders.
      const todos = [
        createTodo('Done task', 'completed'),
        createTodo('Still pending', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('✓');
      expect(lastFrame()).toContain('Done task');
    });

    it('should render cancelled icon for cancelled todos', () => {
      const todos = [createTodo('Cancelled task', 'cancelled')];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('⨯');
      expect(lastFrame()).toContain('Cancelled task');
    });

    it('should render expanded icon for expanded todos', () => {
      const todos = [createTodo('Parent task', 'expanded')];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('↳');
      expect(lastFrame()).toContain('Parent task');
    });
  });

  describe('count display', () => {
    it('should show correct completed count in header', () => {
      const todos = [
        createTodo('Task 1', 'completed'),
        createTodo('Task 2', 'completed'),
        createTodo('Task 3', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('(2/3)');
    });

    it('should show correct in_progress count', () => {
      const todos = [
        createTodo('Task 1', 'completed'),
        createTodo('Task 2', 'in_progress'),
        createTodo('Task 3', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('1 in progress');
    });

    it('should show correct pending count', () => {
      const todos = [
        createTodo('Task 1', 'completed'),
        createTodo('Task 2', 'in_progress'),
        createTodo('Task 3', 'pending'),
        createTodo('Task 4', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('2 pending');
    });

    it('should not show in_progress count if none in progress', () => {
      const todos = [
        createTodo('Task 1', 'completed'),
        createTodo('Task 2', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).not.toContain('in progress');
    });

    it('should not show pending count if none pending', () => {
      const todos = [
        createTodo('Task 1', 'completed'),
        createTodo('Task 2', 'in_progress'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).not.toContain('pending');
    });
  });

  describe('count consistency with visual display', () => {
    it('should have matching completed count and checkmark icons', () => {
      const todos = [
        createTodo('Task 1', 'completed'),
        createTodo('Task 2', 'completed'),
        createTodo('Task 3', 'in_progress'),
        createTodo('Task 4', 'pending'),
        createTodo('Task 5', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      const frame = lastFrame() ?? '';

      // Header should show (2/5)
      expect(frame).toContain('(2/5)');

      // Should have exactly 2 checkmarks
      const checkmarkCount = (frame.match(/✓/g) ?? []).length;
      expect(checkmarkCount).toBe(2);

      // Should have exactly 1 filled circle (in_progress)
      const filledCircleCount = (frame.match(/●/g) ?? []).length;
      expect(filledCircleCount).toBe(1);

      // Should have exactly 2 empty circles (pending)
      const emptyCircleCount = (frame.match(/○/g) ?? []).length;
      expect(emptyCircleCount).toBe(2);
    });

    it('should have matching in_progress count and filled circle icons', () => {
      const todos = [
        createTodo('Task 1', 'in_progress'),
        createTodo('Task 2', 'pending'),
        createTodo('Task 3', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      const frame = lastFrame() ?? '';

      // Header should show 1 in progress
      expect(frame).toContain('1 in progress');

      // Should have exactly 1 filled circle
      const filledCircleCount = (frame.match(/●/g) ?? []).length;
      expect(filledCircleCount).toBe(1);
    });

    it('should have matching pending count and empty circle icons', () => {
      const todos = [
        createTodo('Task 1', 'completed'),
        createTodo('Task 2', 'pending'),
        createTodo('Task 3', 'pending'),
        createTodo('Task 4', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      const frame = lastFrame() ?? '';

      // Header should show 3 pending
      expect(frame).toContain('3 pending');

      // Should have exactly 3 empty circles
      const emptyCircleCount = (frame.match(/○/g) ?? []).length;
      expect(emptyCircleCount).toBe(3);
    });
  });

  describe('working on display', () => {
    it('should show "Working on" for in_progress task', () => {
      const todos = [
        createTodo('First task', 'completed'),
        createTodo('Current work', 'in_progress'),
        createTodo('Future task', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('Working on: Current work');
    });

    it('should not show "Working on" when no in_progress task', () => {
      const todos = [
        createTodo('Done', 'completed'),
        createTodo('Later', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).not.toContain('Working on');
    });

    it('should show first in_progress task in "Working on"', () => {
      // If there are multiple in_progress (which shouldn't happen normally),
      // it should show the first one
      const todos = [
        createTodo('First active', 'in_progress'),
        createTodo('Second active', 'in_progress'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('Working on: First active');
    });
  });

  describe('visibility filtering', () => {
    it('should only count visible todos', () => {
      const todos: ExpandableTodoItem[] = [
        { ...createTodo('Visible done', 'completed'), visible: true },
        { ...createTodo('Hidden done', 'completed'), visible: false },
        { ...createTodo('Visible pending', 'pending'), visible: true },
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);

      // Should show (1/2) because hidden todo is not counted
      expect(lastFrame()).toContain('(1/2)');
    });

    it('should not render hidden todos', () => {
      const todos: ExpandableTodoItem[] = [
        { ...createTodo('Visible task', 'pending'), visible: true },
        { ...createTodo('Hidden task', 'pending'), visible: false },
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);

      expect(lastFrame()).toContain('Visible task');
      expect(lastFrame()).not.toContain('Hidden task');
    });

    it('should show hidden todos when showHidden is true', () => {
      const todos: ExpandableTodoItem[] = [
        { ...createTodo('Visible task', 'pending'), visible: true },
        { ...createTodo('Hidden task', 'pending'), visible: false },
      ];
      const { lastFrame } = render(<TodoList todos={todos} showHidden />);

      expect(lastFrame()).toContain('Visible task');
      expect(lastFrame()).toContain('Hidden task');
    });
  });

  describe('empty state', () => {
    it('should render nothing when list is empty', () => {
      const { lastFrame } = render(<TodoList todos={[]} />);
      // Component returns null for empty list (renders nothing)
      expect(lastFrame()).toBe('');
    });

    it('should render nothing when all todos are hidden', () => {
      const todos: ExpandableTodoItem[] = [
        { ...createTodo('Hidden', 'pending'), visible: false },
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      // Component returns null when no visible todos
      expect(lastFrame()).toBe('');
    });
  });

  describe('numbering', () => {
    it('should number todos starting from 1', () => {
      const todos = [
        createTodo('First', 'pending'),
        createTodo('Second', 'pending'),
        createTodo('Third', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} />);
      expect(lastFrame()).toContain('1.');
      expect(lastFrame()).toContain('2.');
      expect(lastFrame()).toContain('3.');
    });
  });

  describe('compact mode', () => {
    it('should not show numbering in compact mode', () => {
      const todos = [
        createTodo('Task', 'pending'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} compact />);
      // In compact mode, no "1." prefix
      expect(lastFrame()).not.toMatch(/\d\./);
    });

    it('should not show "Working on" in compact mode', () => {
      const todos = [
        createTodo('Active task', 'in_progress'),
      ];
      const { lastFrame } = render(<TodoList todos={todos} compact />);
      expect(lastFrame()).not.toContain('Working on');
    });
  });
});

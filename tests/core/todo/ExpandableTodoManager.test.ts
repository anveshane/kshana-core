import { describe, expect, it } from 'vitest';
import { ExpandableTodoManager } from '../../../src/core/todo/ExpandableTodoManager.js';

describe('ExpandableTodoManager', () => {
  it('writeTodos replaces the current list instead of preserving prior completed items', () => {
    const manager = new ExpandableTodoManager();

    manager.writeTodos([
      { id: 'plot', content: 'Create plot outline', status: 'completed' },
      { id: 'story', content: 'Write full story', status: 'in_progress' },
    ]);

    const result = manager.writeTodos([
      { id: 'scene-images', content: 'Generate scene images', status: 'in_progress' },
      { id: 'scene-videos', content: 'Generate scene videos', status: 'pending' },
    ]);

    expect(result.todos).toEqual([
      expect.objectContaining({
        id: 'scene-images',
        content: 'Generate scene images',
        status: 'in_progress',
      }),
      expect.objectContaining({
        id: 'scene-videos',
        content: 'Generate scene videos',
        status: 'pending',
      }),
    ]);
    expect(result.todos.map((todo) => todo.id)).not.toContain('plot');
    expect(result.message).toContain('replaced');
  });

  it('mergeTodosById updates existing items and appends unseen ids', () => {
    const manager = new ExpandableTodoManager();

    manager.writeTodos([
      { id: 'scene-1', content: 'Generate Scene 1', status: 'in_progress' },
      { id: 'scene-2', content: 'Generate Scene 2', status: 'pending' },
    ]);

    const result = manager.mergeTodosById([
      { id: 'scene-1', status: 'completed' },
      { id: 'scene-2', status: 'in_progress' },
      {
        id: 'scene-3',
        content: 'Generate Scene 3',
        activeForm: 'Generating Scene 3',
        status: 'pending',
      },
    ]);

    expect(result.todos).toEqual([
      expect.objectContaining({
        id: 'scene-1',
        content: 'Generate Scene 1',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'scene-2',
        content: 'Generate Scene 2',
        status: 'in_progress',
      }),
      expect.objectContaining({
        id: 'scene-3',
        content: 'Generate Scene 3',
        status: 'pending',
      }),
    ]);
  });
});

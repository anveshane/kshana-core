import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Import the class for testing
import { ContextStore } from '../../src/core/context/ContextStore.js';

const CONTEXT_DIR = join(process.cwd(), '.kshana', 'context');

// Run tests sequentially to avoid race conditions with shared directory
describe('ContextStore', { sequential: true }, () => {
  let store: ContextStore;

  beforeAll(() => {
    // Clean up context directory before all tests
    if (existsSync(CONTEXT_DIR)) {
      rmSync(CONTEXT_DIR, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Create a fresh store instance
    store = new ContextStore();
    // Clear any existing data
    store.clear();
  });

  afterEach(() => {
    // Clean up after tests
    store.clear();
  });

  describe('store()', () => {
    it('should store content and return a variable name', () => {
      const result = store.store('This is test content', 'Test Content');

      expect(result.variableName).toBe('$test_content');
    });

    it('should generate unique variable names for same base', () => {
      const result1 = store.store('Content 1', 'Story');
      const result2 = store.store('Content 2', 'Story');
      const result3 = store.store('Content 3', 'Story');

      expect(result1.variableName).toBe('$story');
      expect(result2.variableName).toBe('$story_2');
      expect(result3.variableName).toBe('$story_3');
    });

    it('should use variableBaseName if provided', () => {
      const result = store.store('Content', 'My Label', {
        variableBaseName: 'custom_name',
      });

      expect(result.variableName).toBe('$custom_name');
    });

    it('should store content with correct source', () => {
      store.store('Content', 'Label', { source: 'user_input' });
      store.store('Content 2', 'Label 2', { source: 'tool' });

      const meta1 = store.getMeta('$label');
      const meta2 = store.getMeta('$label_2');

      expect(meta1?.source).toBe('user_input');
      expect(meta2?.source).toBe('tool');
    });

    it('should save content to .md file', () => {
      store.store('Test content for file', 'File Test');

      const filePath = join(CONTEXT_DIR, 'file_test.md');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toBe('Test content for file');
    });
  });

  describe('get()', () => {
    it('should retrieve stored content by variable name', () => {
      store.store('My stored content', 'Test Label');

      const result = store.get('$test_label');

      expect(result).not.toBeNull();
      expect(result?.content).toBe('My stored content');
      expect(result?.label).toBe('Test Label');
    });

    it('should return null for non-existent variable', () => {
      const result = store.get('$nonexistent');

      expect(result).toBeNull();
    });

    it('should return null if file was deleted but index exists', () => {
      store.store('Content', 'Label');

      // Manually delete the file
      const filePath = join(CONTEXT_DIR, 'label.md');
      if (existsSync(filePath)) {
        rmSync(filePath);
      }

      const result = store.get('$label');
      expect(result).toBeNull();
    });
  });

  describe('getActiveVariables()', () => {
    it('should return all stored variables', () => {
      store.store('Content 1', 'First');
      store.store('Content 2', 'Second');
      store.store('Content 3', 'Third');

      const variables = store.getActiveVariables();

      expect(variables).toHaveLength(3);
      expect(variables.map(v => v.variableName)).toContain('$first');
      expect(variables.map(v => v.variableName)).toContain('$second');
      expect(variables.map(v => v.variableName)).toContain('$third');
    });

    it('should include character counts', () => {
      store.store('Hello', 'Test');

      const variables = store.getActiveVariables();

      expect(variables[0]?.charCount).toBe(5);
    });
  });

  describe('delete()', () => {
    it('should delete stored content', () => {
      store.store('Content', 'To Delete');

      const deleted = store.delete('$to_delete');

      expect(deleted).toBe(true);
      expect(store.get('$to_delete')).toBeNull();
    });

    it('should return false for non-existent variable', () => {
      const deleted = store.delete('$nonexistent');

      expect(deleted).toBe(false);
    });
  });

  describe('list()', () => {
    it('should list all metadata', () => {
      store.store('Content 1', 'Label 1');
      store.store('Content 2', 'Label 2');

      const list = store.list();

      expect(list).toHaveLength(2);
      expect(list.map(m => m.label)).toContain('Label 1');
      expect(list.map(m => m.label)).toContain('Label 2');
    });
  });

  describe('clear()', () => {
    it('should remove all contexts', () => {
      store.store('Content 1', 'Label 1');
      store.store('Content 2', 'Label 2');

      const count = store.clear();

      expect(count).toBe(2);
      expect(store.list()).toHaveLength(0);
    });
  });

  describe('variable naming', () => {
    it('should normalize labels with special characters', () => {
      const result = store.store('Content', 'My Special Label!!!');

      expect(result.variableName).toBe('$my_special_label');
    });

    it('should handle labels with numbers', () => {
      const result = store.store('Content', 'Chapter 1');

      expect(result.variableName).toBe('$chapter_1');
    });

    it('should handle empty or invalid labels gracefully', () => {
      const result = store.store('Content', '!!!');

      // Should fall back to 'context'
      expect(result.variableName).toBe('$context');
    });
  });
});

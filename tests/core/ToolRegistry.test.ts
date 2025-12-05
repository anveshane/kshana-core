import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry, createTool } from '../../src/core/tools/ToolRegistry.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool = createTool('test', 'A test tool', {
        type: 'object',
        properties: {},
      });

      registry.register(tool);

      expect(registry.has('test')).toBe(true);
    });

    it('should allow method chaining', () => {
      const tool1 = createTool('tool1', 'Tool 1', { type: 'object', properties: {} });
      const tool2 = createTool('tool2', 'Tool 2', { type: 'object', properties: {} });

      const result = registry.register(tool1).register(tool2);

      expect(result).toBe(registry);
      expect(registry.size).toBe(2);
    });
  });

  describe('get', () => {
    it('should return registered tool', () => {
      const tool = createTool('test', 'A test tool', {
        type: 'object',
        properties: {},
      });
      registry.register(tool);

      const retrieved = registry.get('test');

      expect(retrieved).toBe(tool);
    });

    it('should return undefined for non-existent tool', () => {
      expect(registry.get('non-existent')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for registered tool', () => {
      const tool = createTool('test', 'A test tool', {
        type: 'object',
        properties: {},
      });
      registry.register(tool);

      expect(registry.has('test')).toBe(true);
    });

    it('should return false for non-existent tool', () => {
      expect(registry.has('non-existent')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all tools as a Map', () => {
      const tool1 = createTool('tool1', 'Tool 1', { type: 'object', properties: {} });
      const tool2 = createTool('tool2', 'Tool 2', { type: 'object', properties: {} });
      registry.register(tool1).register(tool2);

      const all = registry.getAll();

      expect(all).toBeInstanceOf(Map);
      expect(all.size).toBe(2);
    });
  });

  describe('toArray', () => {
    it('should return all tools as an array', () => {
      const tool1 = createTool('tool1', 'Tool 1', { type: 'object', properties: {} });
      const tool2 = createTool('tool2', 'Tool 2', { type: 'object', properties: {} });
      registry.register(tool1).register(tool2);

      const arr = registry.toArray();

      expect(Array.isArray(arr)).toBe(true);
      expect(arr).toHaveLength(2);
    });
  });

  describe('remove', () => {
    it('should remove a tool', () => {
      const tool = createTool('test', 'A test tool', {
        type: 'object',
        properties: {},
      });
      registry.register(tool);

      const removed = registry.remove('test');

      expect(removed).toBe(true);
      expect(registry.has('test')).toBe(false);
    });

    it('should return false for non-existent tool', () => {
      expect(registry.remove('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all tools', () => {
      const tool1 = createTool('tool1', 'Tool 1', { type: 'object', properties: {} });
      const tool2 = createTool('tool2', 'Tool 2', { type: 'object', properties: {} });
      registry.register(tool1).register(tool2);

      registry.clear();

      expect(registry.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return correct count', () => {
      expect(registry.size).toBe(0);

      registry.register(createTool('t1', 'T1', { type: 'object', properties: {} }));
      expect(registry.size).toBe(1);

      registry.register(createTool('t2', 'T2', { type: 'object', properties: {} }));
      expect(registry.size).toBe(2);
    });
  });
});

describe('createTool', () => {
  it('should create a tool with all properties', () => {
    const handler = (args: Record<string, unknown>) => ({ result: args['input'] });
    const tool = createTool(
      'my-tool',
      'My tool description',
      {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      },
      handler
    );

    expect(tool.name).toBe('my-tool');
    expect(tool.description).toBe('My tool description');
    expect(tool.parameters.type).toBe('object');
    expect(tool.handler).toBe(handler);
  });

  it('should create a tool without handler', () => {
    const tool = createTool('no-handler', 'No handler', {
      type: 'object',
      properties: {},
    });

    expect(tool.handler).toBeUndefined();
  });
});

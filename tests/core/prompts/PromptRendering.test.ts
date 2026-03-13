/**
 * Layer 1: Prompt Rendering Tests
 *
 * Tests buildSystemMessage() output for given project states.
 * Verifies prompt assembly, not LLM interpretation.
 * Catches regressions when templates change.
 */
import { describe, it, expect } from 'vitest';
import { buildSystemMessage, buildPlanningPrompt } from '../../../src/core/prompts/index.js';
import type { ToolDefinition } from '../../../src/core/llm/types.js';

// Minimal tool map for testing
function createToolMap(...names: string[]): Map<string, ToolDefinition> {
  const map = new Map<string, ToolDefinition>();
  for (const name of names) {
    map.set(name, {
      name,
      description: `${name} tool`,
      parameters: { type: 'object', properties: {} },
    });
  }
  return map;
}

describe('Prompt Rendering', () => {
  describe('buildSystemMessage', () => {
    it('returns a non-empty string for orchestrator mode', () => {
      const result = buildSystemMessage(false, createToolMap('TodoWrite'));
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(100);
    });

    it('returns a non-empty string for sub-agent mode', () => {
      const result = buildSystemMessage(true, createToolMap('generate_content'));
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(100);
    });

    it('orchestrator and sub-agent prompts differ', () => {
      const tools = createToolMap('TodoWrite');
      const orchestrator = buildSystemMessage(false, tools);
      const subagent = buildSystemMessage(true, tools);
      expect(orchestrator).not.toBe(subagent);
    });

    it('includes custom prompt when provided', () => {
      const customPrompt = 'You are creating a narrative video about dragons.';
      const result = buildSystemMessage(false, createToolMap(), customPrompt);
      expect(result).toContain(customPrompt);
      expect(result).toContain('<custom_instructions>');
    });

    it('omits custom_instructions tag when no custom prompt', () => {
      const result = buildSystemMessage(false, createToolMap());
      expect(result).not.toContain('<custom_instructions>');
    });

    it('includes project state section for orchestrator when provided', () => {
      const projectState = {
        title: 'Test Project',
        templateId: 'narrative',
        currentPhase: 'story',
      };
      const result = buildSystemMessage(false, createToolMap(), undefined, projectState);
      expect(result).toContain('Test Project');
    });

    it('does NOT include project state for sub-agents', () => {
      const projectState = {
        title: 'Test Project',
        templateId: 'narrative',
        currentPhase: 'story',
      };
      const result = buildSystemMessage(true, createToolMap(), undefined, projectState);
      // Sub-agents should not get project state in system message
      expect(result).not.toContain('Test Project');
    });
  });

  describe('buildPlanningPrompt', () => {
    it('includes the task in XML tags', () => {
      const result = buildPlanningPrompt('Create 5 characters');
      expect(result).toContain('<task>');
      expect(result).toContain('Create 5 characters');
      expect(result).toContain('</task>');
    });

    it('includes context when provided', () => {
      const result = buildPlanningPrompt('Create characters', 'Fantasy setting');
      expect(result).toContain('<context>');
      expect(result).toContain('Fantasy setting');
      expect(result).toContain('</context>');
    });

    it('omits context tag when not provided', () => {
      const result = buildPlanningPrompt('Create characters');
      expect(result).not.toContain('<context>');
    });
  });
});

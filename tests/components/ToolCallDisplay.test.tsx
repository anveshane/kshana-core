/**
 * Tests for ToolCallDisplay component.
 * Tests tool display, streaming content, and result content extraction.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { ToolCallDisplay } from '../../src/components/ToolCallDisplay.js';

describe('ToolCallDisplay', () => {
  describe('basic rendering', () => {
    it('should render tool name for executing state', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="test_tool"
          status="executing"
        />
      );
      expect(lastFrame()).toContain('Running test_tool');
    });

    it('should render tool name for completed state', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="test_tool"
          status="completed"
        />
      );
      expect(lastFrame()).toContain('Ran test_tool');
    });

    it('should render tool arguments', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="test_tool"
          args={{ foo: 'bar', count: 42 }}
          status="completed"
        />
      );
      expect(lastFrame()).toContain('foo="bar"');
      expect(lastFrame()).toContain('count=42');
    });

    it('should render agent name when provided', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="test_tool"
          status="completed"
          agentName="Test Agent"
        />
      );
      expect(lastFrame()).toContain('[Test Agent]');
    });

    it('should render duration when provided', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="test_tool"
          status="completed"
          duration={1500}
        />
      );
      expect(lastFrame()).toContain('1.5s');
    });
  });

  describe('streaming content', () => {
    it('should render streaming content during execution', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="executing"
          streamingContent="This is streaming content being generated..."
        />
      );
      expect(lastFrame()).toContain('This is streaming content being generated...');
    });

    it('should render streaming content in compact mode', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="executing"
          streamingContent="Streaming in compact mode"
          compact
        />
      );
      expect(lastFrame()).toContain('Streaming in compact mode');
    });

    it('should NOT render streaming content when undefined', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          streamingContent={undefined}
        />
      );
      // Should just have the tool call info, not streaming content
      expect(lastFrame()).toContain('Ran Task');
    });
  });

  describe('result content extraction for Task tools', () => {
    it('should render result.content for completed Task when no streaming content', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          result={{
            status: 'completed',
            content: 'This is the final content from the task result.',
            task: 'Test task',
          }}
        />
      );
      expect(lastFrame()).toContain('This is the final content from the task result.');
    });

    it('should NOT render result.content when streaming content is present', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          streamingContent="Streaming content takes priority"
          result={{
            status: 'completed',
            content: 'This should not be shown',
          }}
        />
      );
      expect(lastFrame()).toContain('Streaming content takes priority');
      expect(lastFrame()).not.toContain('This should not be shown');
    });

    it('should NOT render result.content during execution', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="executing"
          result={{
            status: 'completed',
            content: 'This should not be shown during execution',
          }}
        />
      );
      expect(lastFrame()).not.toContain('This should not be shown during execution');
    });

    it('should NOT render result.content when result has no content field', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          result={{
            status: 'completed',
            data: 'some data',
          }}
        />
      );
      // Should render without error, just showing the tool info
      expect(lastFrame()).toContain('Ran Task');
    });

    it('should NOT render result.content when content is empty string', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          result={{
            status: 'completed',
            content: '',
          }}
        />
      );
      // Should render without the empty content
      expect(lastFrame()).toContain('Ran Task');
    });

    it('should handle result.content with special characters', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          result={{
            content: 'Title: "The Story"\n\n## Act I\n\nSome *bold* text.',
          }}
        />
      );
      expect(lastFrame()).toContain('Title:');
      expect(lastFrame()).toContain('Act I');
    });
  });

  describe('content display priority', () => {
    it('should show streaming content during execution (not result content)', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="executing"
          streamingContent="Live streaming..."
          result={{ content: 'Final result' }}
        />
      );
      expect(lastFrame()).toContain('Live streaming...');
      expect(lastFrame()).not.toContain('Final result');
    });

    it('should show result content after completion when streaming content is hidden', () => {
      // This simulates the history view where wasStreamed=true causes
      // streamingContent to be undefined
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          streamingContent={undefined}
          result={{ content: 'Final result from task' }}
        />
      );
      expect(lastFrame()).toContain('Final result from task');
    });

    it('should prefer streaming content over result content when both present', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          streamingContent="Streaming wins"
          result={{ content: 'Result loses' }}
        />
      );
      expect(lastFrame()).toContain('Streaming wins');
      expect(lastFrame()).not.toContain('Result loses');
    });
  });

  describe('special tool rendering', () => {
    it('should render think tool specially', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="think"
          args={{ thought: 'I am thinking about this...' }}
          status="completed"
        />
      );
      expect(lastFrame()).toContain('I am thinking about this...');
    });

    it('should render error status with result message', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="test_tool"
          status="error"
          result="Something went wrong"
        />
      );
      expect(lastFrame()).toContain('Error');
      expect(lastFrame()).toContain('Something went wrong');
    });
  });

  describe('compact vs full mode', () => {
    it('should render in compact mode', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="test_tool"
          status="completed"
          compact
        />
      );
      expect(lastFrame()).toContain('Ran test_tool');
    });

    it('should render result content in compact mode', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="completed"
          compact
          result={{ content: 'Compact mode result content' }}
        />
      );
      expect(lastFrame()).toContain('Compact mode result content');
    });

    it('should render streaming content in full mode', () => {
      const { lastFrame } = render(
        <ToolCallDisplay
          toolName="Task"
          status="executing"
          streamingContent="Full mode streaming content"
          compact={false}
        />
      );
      expect(lastFrame()).toContain('Full mode streaming content');
    });
  });
});

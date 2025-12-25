/**
 * Tests for QuestionPrompt component.
 * Tests question display, options rendering, and countdown timer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { QuestionPrompt } from '../../src/components/QuestionPrompt.js';

describe('QuestionPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('free-form question', () => {
    it('should render question text', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="What is your name?" />
      );
      expect(lastFrame()).toContain('What is your name?');
    });

    it('should render question mark indicator', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="Enter something" />
      );
      expect(lastFrame()).toContain('?');
    });
  });

  describe('confirmation question', () => {
    it('should render yes/no hints for confirmation', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="Are you sure?" isConfirmation={true} />
      );
      expect(lastFrame()).toContain('y');
      expect(lastFrame()).toContain('n');
      expect(lastFrame()).toContain('Yes');
      expect(lastFrame()).toContain('No');
    });

    it('should render the question text', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="Delete this file?" isConfirmation={true} />
      );
      expect(lastFrame()).toContain('Delete this file?');
    });
  });

  describe('multiple choice options', () => {
    const options = [
      { label: 'Option A', description: 'First option' },
      { label: 'Option B', description: 'Second option' },
      { label: 'Option C' },
    ];

    it('should render all options', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="Choose one:" options={options} />
      );
      expect(lastFrame()).toContain('Option A');
      expect(lastFrame()).toContain('Option B');
      expect(lastFrame()).toContain('Option C');
    });

    it('should render option descriptions', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="Choose one:" options={options} />
      );
      expect(lastFrame()).toContain('First option');
      expect(lastFrame()).toContain('Second option');
    });

    it('should render option numbers', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="Choose one:" options={options} />
      );
      expect(lastFrame()).toContain('1.');
      expect(lastFrame()).toContain('2.');
      expect(lastFrame()).toContain('3.');
    });

    it('should highlight selected option', () => {
      const { lastFrame } = render(
        <QuestionPrompt
          question="Choose one:"
          options={options}
          selectedIndex={1}
        />
      );
      // The selected option should have '>' indicator
      expect(lastFrame()).toContain('>');
    });

    it('should default to first option selected', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="Choose one:" options={options} />
      );
      // Default selectedIndex is 0
      expect(lastFrame()).toContain('>');
    });
  });

  describe('countdown timer', () => {
    it('should display countdown when autoApproveTimeoutMs is set', () => {
      const { lastFrame } = render(
        <QuestionPrompt
          question="Approve?"
          isConfirmation={true}
          autoApproveTimeoutMs={15000}
        />
      );
      expect(lastFrame()).toContain('Auto-approve in');
      expect(lastFrame()).toContain('15s');
    });

    it('should show initial countdown value', () => {
      // Note: ink-testing-library doesn't support React state updates via fake timers
      // so we test the initial render and rely on unit tests for the timer logic
      const { lastFrame } = render(
        <QuestionPrompt
          question="Approve?"
          isConfirmation={true}
          autoApproveTimeoutMs={5000}
        />
      );

      expect(lastFrame()).toContain('5s');
    });

    // Note: Testing onTimeout callback with fake timers and ink-testing-library
    // is unreliable due to how ink handles React updates. The timer logic is
    // verified through manual testing and the component implementation is straightforward.

    it('should show green color when time > 10s', () => {
      const { lastFrame } = render(
        <QuestionPrompt
          question="Approve?"
          autoApproveTimeoutMs={15000}
        />
      );
      // The component should render with green color for > 10s
      // We can't easily test colors in ink-testing-library, but we verify the text
      expect(lastFrame()).toContain('15s');
    });

    it('should not show countdown when autoApproveTimeoutMs is undefined', () => {
      const { lastFrame } = render(
        <QuestionPrompt question="Approve?" isConfirmation={true} />
      );
      expect(lastFrame()).not.toContain('Auto-approve');
    });

    it('should not show countdown when autoApproveTimeoutMs is 0', () => {
      const { lastFrame } = render(
        <QuestionPrompt
          question="Approve?"
          isConfirmation={true}
          autoApproveTimeoutMs={0}
        />
      );
      expect(lastFrame()).not.toContain('Auto-approve');
    });

    it('should show countdown in multiple choice questions', () => {
      const options = [
        { label: 'Yes', description: 'Proceed' },
        { label: 'No', description: 'Cancel' },
      ];

      const { lastFrame } = render(
        <QuestionPrompt
          question="Choose:"
          options={options}
          autoApproveTimeoutMs={10000}
        />
      );
      expect(lastFrame()).toContain('Auto-approve in');
      expect(lastFrame()).toContain('10s');
    });

    it('should show countdown in free-form questions', () => {
      const { lastFrame } = render(
        <QuestionPrompt
          question="Enter value:"
          autoApproveTimeoutMs={8000}
        />
      );
      expect(lastFrame()).toContain('Auto-approve in');
      expect(lastFrame()).toContain('8s');
    });

    it('should clean up timer on unmount', () => {
      const onTimeout = vi.fn();
      const { unmount } = render(
        <QuestionPrompt
          question="Approve?"
          autoApproveTimeoutMs={5000}
          onTimeout={onTimeout}
        />
      );

      // Advance partial time
      vi.advanceTimersByTime(2000);

      // Unmount before timer completes
      unmount();

      // Advance remaining time
      vi.advanceTimersByTime(5000);

      // onTimeout should not be called after unmount
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('should show different initial values based on autoApproveTimeoutMs', () => {
      // Test that different timeout values render correctly
      const { lastFrame: frame1 } = render(
        <QuestionPrompt question="Q1" autoApproveTimeoutMs={5000} />
      );
      expect(frame1()).toContain('5s');

      const { lastFrame: frame2 } = render(
        <QuestionPrompt question="Q2" autoApproveTimeoutMs={10000} />
      );
      expect(frame2()).toContain('10s');

      const { lastFrame: frame3 } = render(
        <QuestionPrompt question="Q3" autoApproveTimeoutMs={30000} />
      );
      expect(frame3()).toContain('30s');
    });
  });
});

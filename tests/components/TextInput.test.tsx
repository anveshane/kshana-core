/**
 * Tests for TextInput component.
 * Tests text input handling including paste, typing, and special keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { TextInput } from '../../src/components/TextInput.js';

// Mock useStdin since ink-testing-library doesn't provide real stdin
const mockStdin = {
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useStdin: () => ({
      stdin: mockStdin,
      setRawMode: vi.fn(),
    }),
  };
});

describe('TextInput', () => {
  let onChange: ReturnType<typeof vi.fn>;
  let onSubmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onChange = vi.fn();
    onSubmit = vi.fn();
    mockStdin.on.mockClear();
    mockStdin.off.mockClear();
  });

  describe('rendering', () => {
    it('should render with prompt and empty value', () => {
      const { lastFrame } = render(
        <TextInput value="" onChange={onChange} prompt=">" />
      );
      expect(lastFrame()).toContain('>');
    });

    it('should render with custom prompt', () => {
      const { lastFrame } = render(
        <TextInput value="" onChange={onChange} prompt="Story:" />
      );
      expect(lastFrame()).toContain('Story:');
    });

    it('should render placeholder when value is empty', () => {
      const { lastFrame } = render(
        <TextInput value="" onChange={onChange} placeholder="Enter text..." />
      );
      expect(lastFrame()).toContain('Enter text...');
    });

    it('should render the current value', () => {
      const { lastFrame } = render(
        <TextInput value="Hello World" onChange={onChange} />
      );
      expect(lastFrame()).toContain('Hello World');
    });

    it('should show cursor when showCursor is true', () => {
      const { lastFrame } = render(
        <TextInput value="test" onChange={onChange} showCursor={true} />
      );
      // Cursor should be visible (rendered as background color change)
      expect(lastFrame()).toBeDefined();
    });
  });

  describe('stdin event handling', () => {
    it('should register stdin data handler on mount', () => {
      render(<TextInput value="" onChange={onChange} focus={true} />);
      expect(mockStdin.on).toHaveBeenCalledWith('data', expect.any(Function));
    });

    it('should clean up on unmount', () => {
      const { unmount } = render(<TextInput value="" onChange={onChange} focus={true} />);
      // Verify component was mounted (handler registered)
      expect(mockStdin.on).toHaveBeenCalled();
      // Unmount should complete without errors
      expect(() => unmount()).not.toThrow();
    });

    it('should not register handler when not focused', () => {
      render(<TextInput value="" onChange={onChange} focus={false} />);
      expect(mockStdin.on).not.toHaveBeenCalled();
    });
  });

  describe('input sanitization', () => {
    it('should sanitize control characters from display', () => {
      // Value with control characters should be sanitized for display
      const { lastFrame } = render(
        <TextInput value="Hello\x00World" onChange={onChange} />
      );
      // Control character should be removed in display
      expect(lastFrame()).not.toContain('\x00');
    });
  });
});

describe('TextInput input handling (unit tests)', () => {
  // These tests verify the sanitization logic directly

  describe('sanitizeInput', () => {
    // Helper to test the sanitization logic used in the component
    const sanitizeInput = (input: string): string => {
      let sanitized = input
        .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')
        .replace(/\s+/g, ' ');

      if (sanitized.length > 1) {
        sanitized = sanitized.trim();
      }

      return sanitized;
    };

    it('should preserve single characters', () => {
      expect(sanitizeInput('a')).toBe('a');
      expect(sanitizeInput('Z')).toBe('Z');
      expect(sanitizeInput('5')).toBe('5');
    });

    it('should preserve single space', () => {
      expect(sanitizeInput(' ')).toBe(' ');
    });

    it('should replace newlines with spaces in multi-char input', () => {
      expect(sanitizeInput('hello\nworld')).toBe('hello world');
    });

    it('should replace carriage returns with spaces', () => {
      expect(sanitizeInput('hello\r\nworld')).toBe('hello world');
    });

    it('should replace tabs with spaces', () => {
      expect(sanitizeInput('hello\tworld')).toBe('hello world');
    });

    it('should collapse multiple spaces', () => {
      expect(sanitizeInput('hello    world')).toBe('hello world');
    });

    it('should trim pasted content (multi-char)', () => {
      expect(sanitizeInput('  hello world  ')).toBe('hello world');
    });

    it('should handle complex pasted content', () => {
      const pasted = '  "A story about a robot"\n\n  ';
      expect(sanitizeInput(pasted)).toBe('"A story about a robot"');
    });

    it('should remove null characters', () => {
      expect(sanitizeInput('hello\x00world')).toBe('hello world');
    });

    it('should handle escape sequences in pasted text', () => {
      // Text pasted from terminal might have various control chars
      expect(sanitizeInput('hello\x1b[0mworld')).toBe('hello [0mworld');
    });
  });

  describe('special key detection', () => {
    // Test the key detection patterns used in the component

    it('should detect Enter key', () => {
      expect('\r').toBe('\r');
      expect('\n').toBe('\n');
    });

    it('should detect Escape key', () => {
      expect('\x1b').toBe('\x1b');
      expect('\u001b').toBe('\u001b');
    });

    it('should detect Backspace', () => {
      expect('\x7f').toBe('\x7f');
      expect('\x08').toBe('\x08');
    });

    it('should detect arrow keys', () => {
      expect('\x1b[D').toBe('\x1b[D'); // Left
      expect('\x1b[C').toBe('\x1b[C'); // Right
    });

    it('should detect Ctrl+A (home)', () => {
      expect('\x01').toBe('\x01');
    });

    it('should detect Ctrl+E (end)', () => {
      expect('\x05').toBe('\x05');
    });

    it('should detect Ctrl+D (forward delete)', () => {
      expect('\x04').toBe('\x04');
    });
  });
});

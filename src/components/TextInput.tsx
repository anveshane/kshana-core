/**
 * Text input component with cursor support and multi-line display.
 * Supports arrow keys for cursor movement and full text editing.
 * Uses useStdin for raw input to properly handle paste events.
 */
import React from 'react';
import { Text, Box, useStdin } from 'ink';

interface TextInputProps {
  /** Current value */
  value: string;
  /** Called when value changes */
  onChange: (value: string) => void;
  /** Called when Enter is pressed */
  onSubmit?: (value: string) => void;
  /** Prompt/prefix shown before input */
  prompt?: string;
  /** Placeholder when empty */
  placeholder?: string;
  /** Whether the input is focused */
  focus?: boolean;
  /** Show cursor */
  showCursor?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  prompt = '>',
  placeholder = '',
  focus = true,
  showCursor = true,
}: TextInputProps) {
  const [cursorPos, setCursorPos] = React.useState(value.length);
  const [lastEscapeTime, setLastEscapeTime] = React.useState(0);
  const { stdin, setRawMode } = useStdin();

  // Keep cursor in bounds when value changes externally
  React.useEffect(() => {
    if (cursorPos > value.length) {
      setCursorPos(value.length);
    }
  }, [value, cursorPos]);

  // Set raw mode when focused
  React.useEffect(() => {
    if (focus) {
      setRawMode(true);
      return () => setRawMode(false);
    }
  }, [focus, setRawMode]);

  // Handle raw stdin data - receives full paste as single chunk
  React.useEffect(() => {
    if (!focus || !stdin) return;

    const handleData = (data: Buffer) => {
      const input = data.toString();

      // Check for special keys by their escape sequences
      // Escape key
      if (input === '\x1b' || input === '\u001b') {
        const now = Date.now();
        if (now - lastEscapeTime < 500) {
          onChange('');
          setCursorPos(0);
          setLastEscapeTime(0);
        } else {
          setLastEscapeTime(now);
        }
        return;
      }

      // Enter/Return
      if (input === '\r' || input === '\n') {
        onSubmit?.(value);
        return;
      }

      // Left arrow
      if (input === '\x1b[D') {
        setCursorPos(prev => Math.max(0, prev - 1));
        return;
      }

      // Right arrow
      if (input === '\x1b[C') {
        setCursorPos(prev => Math.min(value.length, prev + 1));
        return;
      }

      // Ctrl+A - go to start
      if (input === '\x01') {
        setCursorPos(0);
        return;
      }

      // Ctrl+E - go to end
      if (input === '\x05') {
        setCursorPos(value.length);
        return;
      }

      // Backspace (0x7f or 0x08)
      if (input === '\x7f' || input === '\x08') {
        if (cursorPos > 0) {
          const newValue = value.slice(0, cursorPos - 1) + value.slice(cursorPos);
          onChange(newValue);
          setCursorPos(prev => prev - 1);
        }
        return;
      }

      // Ctrl+D - forward delete
      if (input === '\x04') {
        if (cursorPos < value.length) {
          const newValue = value.slice(0, cursorPos) + value.slice(cursorPos + 1);
          onChange(newValue);
        }
        return;
      }

      // Ctrl+C - exit (let Ink handle this)
      if (input === '\x03') {
        return;
      }

      // Skip other escape sequences (arrows, function keys, etc.)
      if (input.startsWith('\x1b')) {
        return;
      }

      // Regular text input (including paste) - sanitize for single line
      // Replace newlines and control chars with spaces, collapse multiple spaces
      let sanitized = input
        .replace(/[\r\n\t\x00-\x1F\x7F]/g, ' ')  // Replace control chars with space
        .replace(/\s+/g, ' ');  // Collapse multiple spaces

      // Only trim if it's a multi-character paste (preserve single space keystrokes)
      if (sanitized.length > 1) {
        sanitized = sanitized.trim();
      }

      if (sanitized) {
        // Just insert the text directly
        const newValue = value.slice(0, cursorPos) + sanitized + value.slice(cursorPos);
        onChange(newValue);
        setCursorPos(prev => prev + sanitized.length);
      }
    };

    stdin.on('data', handleData);
    return () => {
      stdin.off('data', handleData);
    };
  }, [focus, stdin, value, cursorPos, onChange, onSubmit, lastEscapeTime]);

  // Sanitize value for display - remove any control characters that might have snuck through
  const sanitizeForDisplay = (text: string): string => {
    return text.replace(/[\x00-\x1F\x7F]/g, '');
  };

  // Render the text with cursor
  const renderWithCursor = () => {
    const displayValue = sanitizeForDisplay(value);

    if (!displayValue && placeholder) {
      return (
        <Text dimColor>
          {showCursor && <Text backgroundColor="cyan"> </Text>}
          {placeholder}
        </Text>
      );
    }

    const displayCursorPos = Math.min(cursorPos, displayValue.length);
    const beforeCursor = displayValue.slice(0, displayCursorPos);
    const atCursor = displayValue[displayCursorPos] || ' ';
    const afterCursor = displayValue.slice(displayCursorPos + 1);

    return (
      <Text>
        {beforeCursor}
        {showCursor ? (
          <Text backgroundColor="cyan" color="black">{atCursor}</Text>
        ) : (
          atCursor !== ' ' ? atCursor : ''
        )}
        {afterCursor}
      </Text>
    );
  };

  return (
    <Box>
      <Text color="cyan">{prompt} </Text>
      {renderWithCursor()}
    </Box>
  );
}

/**
 * Simple wrapper that manages its own state.
 */
export function SimpleTextInput({
  onSubmit,
  prompt = '>',
  placeholder,
}: {
  onSubmit: (value: string) => void;
  prompt?: string;
  placeholder?: string;
}) {
  const [value, setValue] = React.useState('');

  const handleSubmit = React.useCallback(
    (val: string) => {
      if (val.trim()) {
        onSubmit(val.trim());
        setValue('');
      }
    },
    [onSubmit]
  );

  return (
    <TextInput
      value={value}
      onChange={setValue}
      onSubmit={handleSubmit}
      prompt={prompt}
      placeholder={placeholder}
    />
  );
}
